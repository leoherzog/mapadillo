/**
 * Map export module — renders a MapLibre map to PNG, JPEG, or decorative PDF.
 *
 * Uses `@watergis/maplibre-gl-export`'s `MapGeneratorBase` for high-resolution
 * canvas capture, then converts to the desired format.
 */
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { jsPDF } from 'jspdf';
import { MapGeneratorBase, DPI, Size, Unit } from '@watergis/maplibre-gl-export';
import type { DPIType } from '@watergis/maplibre-gl-export';
import type { MapData, Stop } from '../services/maps.js';
import { formatDistance, haversineDistance, sanitizeFilename } from '../utils/geo.js';
import { renderMarkerCanvas } from './map-controller.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DPI: DPIType = DPI[200];
const MAX_CANVAS_DIM = 5400;
const RENDER_TIMEOUT_MS = 30_000;
const RENDER_ERROR_MSG = 'Unable to render map at this resolution. Try on a desktop browser.';

/** Paper dimensions in mm (portrait: width × height). */
const PAPER_SIZES: Record<string, [number, number]> = {
  letter: [215.9, 279.4],
  a4: [210, 297],
  a3: [297, 420],
  tabloid: [279.4, 431.8],
};

// ── MapExporter (subclass of MapGeneratorBase) ──────────────────────────────

class MapExporter extends MapGeneratorBase {
  constructor(
    map: maplibregl.Map,
    dpi: DPIType = DEFAULT_DPI,
    paperSize: PaperSize = 'auto',
    orientation: Orientation = 'landscape',
  ) {
    super(map, Size.A3, dpi, 'png' as never, Unit.mm, 'map');

    let w: number;
    let h: number;

    if (paperSize === 'auto') {
      // Use viewport dimensions scaled by DPI
      const scaleFactor = dpi / 96;
      const container = map.getContainer();
      w = Math.round(container.clientWidth * scaleFactor);
      h = Math.round(container.clientHeight * scaleFactor);
    } else {
      // Compute pixel dimensions from paper size at export DPI
      const [pw, ph] = PAPER_SIZES[paperSize];
      const mmW = orientation === 'landscape' ? ph : pw;
      const mmH = orientation === 'landscape' ? pw : ph;
      w = Math.round((mmW / 25.4) * dpi);
      h = Math.round((mmH / 25.4) * dpi);
    }

    // Cap max canvas dimension — scale down proportionally if either exceeds limit
    if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
      const ratio = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    this.width = w;
    this.height = h;
  }

  protected getRenderedMap(container: HTMLElement, style: StyleSpecification): maplibregl.Map {
    const sourceMap = this.map as maplibregl.Map;

    // The export container is larger than the source (DPI scaling). At the same
    // zoom a bigger container shows more geographic area, appearing "zoomed out".
    // Increase zoom to compensate so the exported extent matches the live view.
    const srcContainer = sourceMap.getContainer();
    const scaleFactor = Math.min(this.width / srcContainer.clientWidth, this.height / srcContainer.clientHeight);
    const zoomAdjust = Math.log2(scaleFactor);

    return new maplibregl.Map({
      container,
      style,
      center: sourceMap.getCenter(),
      zoom: sourceMap.getZoom() + zoomAdjust,
      bearing: sourceMap.getBearing(),
      pitch: sourceMap.getPitch(),
      pixelRatio: 1, // Prevent HiDPI doubling — container dimensions ARE the pixel dimensions
      canvasContextAttributes: { preserveDrawingBuffer: true },
      interactive: false,
      attributionControl: false,
    });
  }

  /**
   * Render the current map view at high resolution into a canvas with
   * custom markers drawn on top.
   */
  renderCanvas(markerFeatures: GeoJSON.Feature<GeoJSON.Point>[]): Promise<HTMLCanvasElement> {
    const sourceMap = this.map as maplibregl.Map;

    return new Promise<HTMLCanvasElement>((resolve, reject) => {
      // Create hidden container at computed pixel dimensions
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-99999px';
      container.style.top = '-99999px';
      container.style.width = `${this.width}px`;
      container.style.height = `${this.height}px`;
      container.style.visibility = 'hidden';
      document.body.appendChild(container);

      let tempMap: maplibregl.Map | null = null;
      let settled = false;

      const cleanup = () => {
        if (tempMap) {
          tempMap.remove();
          tempMap = null;
        }
        container.remove();
      };

      // Timeout to prevent the promise from hanging indefinitely
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('Map rendering timed out. Please try again.'));
        }
      }, RENDER_TIMEOUT_MS);

      try {
        const style = sourceMap.getStyle();
        tempMap = this.getRenderedMap(container, style);

        tempMap.once('idle', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          try {
            const canvas = tempMap!.getCanvas();
            if (!canvas || canvas.width === 0 || canvas.height === 0) {
              cleanup();
              reject(new Error(RENDER_ERROR_MSG));
              return;
            }

            // Clone the canvas data so we can destroy the temp map
            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = canvas.width;
            outputCanvas.height = canvas.height;
            const ctx = outputCanvas.getContext('2d');
            if (!ctx) {
              cleanup();
              reject(new Error(RENDER_ERROR_MSG));
              return;
            }
            ctx.drawImage(canvas, 0, 0);

            // Draw composite marker images onto the output canvas (they are not part of the style)
            drawMarkersOnCanvas(ctx, tempMap!, outputCanvas.width, outputCanvas.height, markerFeatures)
              .then(() => { cleanup(); resolve(outputCanvas); })
              .catch(() => { cleanup(); reject(new Error(RENDER_ERROR_MSG)); });
          } catch {
            cleanup();
            reject(new Error(RENDER_ERROR_MSG));
          }
        });

        tempMap.once('error', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(new Error(RENDER_ERROR_MSG));
        });
      } catch {
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error(RENDER_ERROR_MSG));
      }
    });
  }
}

// ── Marker rendering ────────────────────────────────────────────────────────

/**
 * Draw composite marker images onto the export canvas. Pre-renders each unique
 * icon via renderMarkerCanvas (same images as the live map), then draws them
 * at the projected offset coordinates.
 */
async function drawMarkersOnCanvas(
  ctx: CanvasRenderingContext2D,
  tempMap: maplibregl.Map,
  canvasW: number,
  canvasH: number,
  markerFeatures: GeoJSON.Feature<GeoJSON.Point>[],
): Promise<void> {
  const markerSize = Math.max(24, Math.round(canvasW / 60));
  const halfSize = markerSize / 2;

  // Pre-render each unique icon once
  const iconCanvases = new Map<string, HTMLCanvasElement>();
  const uniqueIcons = new Set<string>();
  for (const f of markerFeatures) {
    const iconId = f.properties?.icon as string | undefined;
    const iconName = iconId?.replace(/^marker-/, '') ?? 'location-dot';
    uniqueIcons.add(iconName);
  }
  await Promise.all([...uniqueIcons].map(async (name) => {
    iconCanvases.set(name, await renderMarkerCanvas(name, markerSize));
  }));

  for (const feature of markerFeatures) {
    const [lng, lat] = feature.geometry.coordinates;
    const tempPt = tempMap.project([lng, lat]);

    if (tempPt.x < -halfSize || tempPt.y < -halfSize || tempPt.x > canvasW + halfSize || tempPt.y > canvasH + halfSize) continue;

    const iconId = feature.properties?.icon as string | undefined;
    const iconName = iconId?.replace(/^marker-/, '') ?? 'location-dot';
    const iconCanvas = iconCanvases.get(iconName);
    if (iconCanvas) {
      ctx.drawImage(iconCanvas, tempPt.x - halfSize, tempPt.y - halfSize, markerSize, markerSize);
    }
  }
}

// ── File download helper ─────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Clean up after a tick to allow the download to start
  requestAnimationFrame(() => {
    a.remove();
    URL.revokeObjectURL(url);
  });
}

// ── Canvas → Blob helper ────────────────────────────────────────────────────

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert canvas to blob'));
      },
      type,
      quality,
    );
  });
}

// ── Attribution overlay for raster exports ───────────────────────────────────

function drawAttribution(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const text = '\u00A9 OpenStreetMap contributors';
  const fontSize = Math.max(12, Math.round(canvas.width / 120));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const padding = fontSize * 0.5;
  const metrics = ctx.measureText(text);
  const bgX = canvas.width - metrics.width - padding * 3;
  const bgY = canvas.height - fontSize - padding * 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(bgX, bgY, canvas.width - bgX, canvas.height - bgY);
  ctx.fillStyle = '#333';
  ctx.fillText(text, canvas.width - padding, canvas.height - padding);
}

// ── Raster export (PNG / JPEG) ───────────────────────────────────────────────

async function downloadRaster(
  map: maplibregl.Map, markerFeatures: GeoJSON.Feature<GeoJSON.Point>[], paperSize: PaperSize, orientation: Orientation,
  mimeType: string, filename: string, quality?: number,
): Promise<void> {
  const exporter = new MapExporter(map, DEFAULT_DPI, paperSize, orientation);
  const canvas = await exporter.renderCanvas(markerFeatures);
  drawAttribution(canvas);
  const blob = await canvasToBlob(canvas, mimeType, quality);
  triggerDownload(blob, filename);
}

async function downloadPNG(
  map: maplibregl.Map, markerFeatures: GeoJSON.Feature<GeoJSON.Point>[], paperSize: PaperSize, orientation: Orientation,
  filename = 'mapadillo-map.png',
): Promise<void> {
  return downloadRaster(map, markerFeatures, paperSize, orientation, 'image/png', filename);
}

async function downloadJPEG(
  map: maplibregl.Map, markerFeatures: GeoJSON.Feature<GeoJSON.Point>[], paperSize: PaperSize, orientation: Orientation,
  filename = 'mapadillo-map.jpg',
): Promise<void> {
  return downloadRaster(map, markerFeatures, paperSize, orientation, 'image/jpeg', filename, 0.92);
}

// ── PDF export (decorative layout) ──────────────────────────────────────────

async function downloadPDF(
  map: maplibregl.Map,
  mapData: MapData,
  stops: Stop[],
  markerFeatures: GeoJSON.Feature<GeoJSON.Point>[],
  units: string,
  paperSize: PaperSize,
  orientation: Orientation,
  routeDistances?: Map<string, number>,
): Promise<void> {
  const exporter = new MapExporter(map, DEFAULT_DPI, paperSize, orientation);
  const canvas = await exporter.renderCanvas(markerFeatures);
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  const pdfFormat = paperSize === 'auto' ? 'a3' : paperSize;
  const pdfOrientation = paperSize === 'auto' ? 'landscape' : orientation;
  const pdf = new jsPDF({ orientation: pdfOrientation, unit: 'mm', format: pdfFormat });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const innerW = pageW - margin * 2;
  const innerH = pageH - margin * 2;

  // ── Decorative border ────────────────────────────────────────────────────
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.5);
  pdf.roundedRect(margin, margin, innerW, innerH, 6, 6, 'S');

  // ── Layout: left 2/3 = map, right 1/3 = info panel ──────────────────────
  const contentMargin = margin + 8;
  const mapAreaW = (innerW * 2) / 3 - 12;
  const panelX = contentMargin + mapAreaW + 8;
  const panelW = innerW / 3 - 4;
  const contentTop = contentMargin;
  const footerH = 12;
  const contentBottom = pageH - margin - footerH;
  const mapAreaH = contentBottom - contentTop;

  // ── Map image (maintain aspect ratio, fill left area) ────────────────────
  const canvasAspect = canvas.width / canvas.height;
  const areaAspect = mapAreaW / mapAreaH;

  let imgW: number;
  let imgH: number;
  let imgX: number;
  let imgY: number;

  if (canvasAspect > areaAspect) {
    // Canvas is wider — fit to width
    imgW = mapAreaW;
    imgH = mapAreaW / canvasAspect;
    imgX = contentMargin;
    imgY = contentTop + (mapAreaH - imgH) / 2;
  } else {
    // Canvas is taller — fit to height
    imgH = mapAreaH;
    imgW = mapAreaH * canvasAspect;
    imgX = contentMargin + (mapAreaW - imgW) / 2;
    imgY = contentTop;
  }

  pdf.addImage(imgData, 'JPEG', imgX, imgY, imgW, imgH);

  // ── Info panel ───────────────────────────────────────────────────────────
  let cursorY = contentTop + 4;

  // Trip title
  pdf.setFontSize(22);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(224, 94, 0); // ORANGE
  const titleLines = pdf.splitTextToSize(mapData.name, panelW - 4);
  pdf.text(titleLines, panelX, cursorY + 6);
  cursorY += titleLines.length * 8 + 4;

  // Family name
  if (mapData.family_name) {
    pdf.setFontSize(13);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(120, 120, 120);
    pdf.text(mapData.family_name, panelX, cursorY + 4);
    cursorY += 8;
  }

  // Horizontal rule
  cursorY += 4;
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.line(panelX, cursorY, panelX + panelW - 4, cursorY);
  cursorY += 6;

  // ── Stops list ───────────────────────────────────────────────────────────
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(60, 60, 60);
  pdf.text('Stops', panelX, cursorY + 4);
  cursorY += 10;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 80);

  const maxStopY = contentBottom - 50; // Reserve space for stats

  const points = stops.filter((s) => s.type === 'point');
  const routes = stops.filter((s) => s.type === 'route');

  for (const stop of stops) {
    if (cursorY > maxStopY) {
      pdf.text('...', panelX + 2, cursorY + 3);
      cursorY += 6;
      break;
    }

    let label: string;
    if (stop.type === 'route') {
      const endName = stop.dest_name ?? 'Destination';
      label = `${stop.name} \u2192 ${endName}`;
    } else {
      const iconPrefix = stop.icon ? `${stop.icon}  ` : '';
      label = iconPrefix + stop.name;
    }

    const stopLines = pdf.splitTextToSize(`\u2022 ${label}`, panelW - 8);
    for (const line of stopLines) {
      if (cursorY > maxStopY) break;
      pdf.text(line as string, panelX + 2, cursorY + 3);
      cursorY += 5;
    }
    cursorY += 1;
  }

  // Horizontal rule before stats
  cursorY += 2;
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.line(panelX, cursorY, panelX + panelW - 4, cursorY);
  cursorY += 6;

  // ── Road trip stats ──────────────────────────────────────────────────────
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(60, 60, 60);
  pdf.text('Trip Stats', panelX, cursorY + 4);
  cursorY += 10;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 80);

  // Use routed distances when available, fall back to straight-line haversine
  let totalMeters = 0;
  if (routeDistances && routeDistances.size > 0) {
    for (const d of routeDistances.values()) totalMeters += d;
  } else {
    for (const stop of routes) {
      if (stop.dest_latitude != null && stop.dest_longitude != null) {
        totalMeters += haversineDistance(
          [stop.longitude, stop.latitude],
          [stop.dest_longitude, stop.dest_latitude],
        );
      }
    }
  }

  const distStr = formatDistance(totalMeters, units);
  pdf.text(`Total distance: ${distStr}`, panelX + 2, cursorY + 3);
  cursorY += 6;
  pdf.text(`Stops: ${points.length}`, panelX + 2, cursorY + 3);
  cursorY += 6;
  pdf.text(`Routes: ${routes.length}`, panelX + 2, cursorY + 3);

  // ── Footer ───────────────────────────────────────────────────────────────
  const footerY = pageH - margin - 4;

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'italic');
  pdf.setTextColor(160, 160, 160);
  pdf.text('Made with Mapadillo', contentMargin, footerY);

  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.text(
    'Map data \u00A9 OpenStreetMap contributors',
    pageW - contentMargin,
    footerY,
    { align: 'right' },
  );

  // Trigger download (jsPDF v4 save() returns a promise)
  await pdf.save(`${sanitizeFilename(mapData.name)}.pdf`);
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export type ExportFormat = 'png' | 'jpeg' | 'pdf';
export type PaperSize = 'auto' | 'letter' | 'a4' | 'a3' | 'tabloid';
export type Orientation = 'landscape' | 'portrait';

export async function exportMap(
  map: maplibregl.Map,
  format: ExportFormat,
  mapData: MapData,
  stops: Stop[],
  markerFeatures: GeoJSON.Feature<GeoJSON.Point>[],
  units: string,
  paperSize: PaperSize,
  orientation: Orientation,
  routeDistances?: Map<string, number>,
): Promise<void> {
  const baseName = sanitizeFilename(mapData.name);

  switch (format) {
    case 'png':
      return downloadPNG(map, markerFeatures, paperSize, orientation, `${baseName}.png`);
    case 'jpeg':
      return downloadJPEG(map, markerFeatures, paperSize, orientation, `${baseName}.jpg`);
    case 'pdf':
      return downloadPDF(map, mapData, stops, markerFeatures, units, paperSize, orientation, routeDistances);
    default:
      throw new Error(`Unsupported export format: ${format as string}`);
  }
}
