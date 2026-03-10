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

const DEFAULT_DPI: DPIType = DPI[300];
const RENDER_TIMEOUT_MS = 30_000;

/** Query the GPU's max texture size once, with a conservative fallback. */
const MAX_CANVAS_DIM = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      // Leave ~20% headroom — MapLibre uses multiple framebuffers internally
      return Math.floor(max * 0.8);
    }
  } catch { /* fall through */ }
  return 4096;
})();
const RENDER_ERROR_MSG = 'Unable to render map at this resolution. Try on a desktop browser.';

/** Paper dimensions in mm (portrait: width × height). */
export const PAPER_SIZES: Record<string, [number, number]> = {
  letter: [215.9, 279.4],
  a4: [210, 297],
  a3: [297, 420],
  tabloid: [279.4, 431.8],
  '18x24': [457.2, 609.6],
  '24x36': [609.6, 914.4],
  a2: [420, 594],
  a1: [594, 841],
};

// ── MapExporter (subclass of MapGeneratorBase) ──────────────────────────────

class MapExporter extends MapGeneratorBase {
  /**
   * CSS pixel dimensions for the offscreen render container.
   * Matches the paper frame's on-screen size (or the full viewport for 'auto')
   * so that MapLibre style elements (line widths, text, icons) render at the
   * same visual proportions as the live preview.
   */
  private _cssWidth: number;
  private _cssHeight: number;

  /** Ratio of export canvas pixels to CSS pixels — drives MapLibre's internal scaling. */
  private _renderPixelRatio: number;

  constructor(
    map: maplibregl.Map,
    dpi: DPIType = DEFAULT_DPI,
    paperSize: PaperSize = 'auto',
    orientation: Orientation = 'landscape',
  ) {
    super(map, Size.A3, dpi, 'png' as never, Unit.mm, 'map');

    const srcContainer = map.getContainer();
    const cw = srcContainer.clientWidth;
    const ch = srcContainer.clientHeight;

    let w: number;
    let h: number;

    if (paperSize === 'auto') {
      const scaleFactor = dpi / 96;
      w = Math.round(cw * scaleFactor);
      h = Math.round(ch * scaleFactor);
      this._cssWidth = cw;
      this._cssHeight = ch;
    } else {
      // Compute pixel dimensions from paper size at export DPI
      const [pw, ph] = PAPER_SIZES[paperSize];
      const mmW = orientation === 'landscape' ? ph : pw;
      const mmH = orientation === 'landscape' ? pw : ph;
      w = Math.round((mmW / 25.4) * dpi);
      h = Math.round((mmH / 25.4) * dpi);

      // Match the paper frame's on-screen CSS pixel size (see map-preview-page.ts).
      // CSS: width: min(85cqw, 85cqh * pw / ph); aspect-ratio: pw / ph
      const exportAspect = w / h;
      const frameW = Math.min(0.85 * cw, 0.85 * ch * exportAspect);
      this._cssWidth = frameW;
      this._cssHeight = frameW / exportAspect;
    }

    // Cap max canvas dimension — scale down proportionally if either exceeds limit
    if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
      const ratio = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    this.width = w;
    this.height = h;
    this._renderPixelRatio = this.width / this._cssWidth;
  }

  protected getRenderedMap(container: HTMLElement, style: StyleSpecification): maplibregl.Map {
    const sourceMap = this.map as maplibregl.Map;

    // The container is sized to match the paper frame's on-screen CSS pixels.
    // pixelRatio tells MapLibre to render a canvas that's _renderPixelRatio×
    // larger, producing the high-res output while keeping all style elements
    // (line widths, text sizes, icons) at the same visual proportions as the
    // live preview. No zoom adjustment is needed.
    return new maplibregl.Map({
      container,
      style,
      center: sourceMap.getCenter(),
      zoom: sourceMap.getZoom(),
      bearing: sourceMap.getBearing(),
      pitch: sourceMap.getPitch(),
      pixelRatio: this._renderPixelRatio,
      // MapLibre v5 defaults maxCanvasSize to [4096, 4096] and silently
      // clamps pixelRatio to fit.  Override to match our intended export
      // dimensions so the canvas is not downscaled behind our back.
      maxCanvasSize: [this.width, this.height] as [number, number],
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
      // Create hidden container at the paper frame's CSS pixel size.
      // MapLibre's pixelRatio will scale the internal canvas up to the
      // full export resolution (this.width × this.height).
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-99999px';
      container.style.top = '-99999px';
      container.style.width = `${this._cssWidth}px`;
      container.style.height = `${this._cssHeight}px`;
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

        // Hide marker icons in the MapLibre render (they'll be drawn manually
        // at full export resolution), but keep them in the layout so MapLibre
        // correctly positions text labels with text-radial-offset around icons.
        for (const layer of style.layers ?? []) {
          if (layer.type === 'symbol' && layer.id.endsWith('-markers-symbol')) {
            (layer as Record<string, unknown>).paint = {
              ...((layer as Record<string, unknown>).paint as object),
              'icon-opacity': 0,
            };
          }
        }

        tempMap = this.getRenderedMap(container, style);

        // Supply marker images on demand so MapLibre can compute correct
        // text label positioning (even though the icons are invisible).
        tempMap.on('styleimagemissing', ({ id }: { id: string }) => {
          if (id.startsWith('marker-')) {
            const img = sourceMap.getImage(id);
            if (img) tempMap!.addImage(id, img.data);
          }
        });

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

            // Draw composite marker images onto the output canvas (they are not part of the style).
            // tempMap.project() returns CSS pixel coords — scale by pixelRatio for canvas coords.
            // Use the actual canvas-to-CSS ratio rather than the pre-computed _renderPixelRatio
            // in case MapLibre clamped the pixel ratio (e.g. due to GPU limits).
            const actualPixelRatio = canvas.width / container.clientWidth;
            drawMarkersOnCanvas(ctx, tempMap!, outputCanvas.width, outputCanvas.height, markerFeatures, actualPixelRatio)
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
  pixelRatio: number,
): Promise<void> {
  // Match the live preview: MapController registers 48px icons at icon-size 0.5 = 24 CSS px.
  // Scale by pixelRatio to convert to canvas pixels.
  const markerSize = Math.round(24 * pixelRatio);
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
    // project() returns CSS pixel coords — scale to canvas pixel coords
    const tempPt = tempMap.project([lng, lat]);
    const x = tempPt.x * pixelRatio;
    const y = tempPt.y * pixelRatio;

    if (x < -halfSize || y < -halfSize || x > canvasW + halfSize || y > canvasH + halfSize) continue;

    const iconId = feature.properties?.icon as string | undefined;
    const iconName = iconId?.replace(/^marker-/, '') ?? 'location-dot';
    const iconCanvas = iconCanvases.get(iconName);
    if (iconCanvas) {
      ctx.drawImage(iconCanvas, x - halfSize, y - halfSize, markerSize, markerSize);
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

// ── PDF helpers ──────────────────────────────────────────────────────────────

/** Build an ordered itinerary of unique waypoint names from the stops list. */
function buildItinerary(stops: Stop[]): string[] {
  const names: string[] = [];
  for (const stop of stops) {
    if (stop.type === 'route') {
      if (!names.length || names[names.length - 1] !== stop.name) names.push(stop.name);
      const dest = stop.dest_name ?? 'Destination';
      if (names[names.length - 1] !== dest) names.push(dest);
    } else {
      if (!names.length || names[names.length - 1] !== stop.name) names.push(stop.name);
    }
  }
  return names;
}

/** Word-wrap text to fit within maxWidth using the current canvas font. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Trace a rounded rectangle path (caller must stroke/fill). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Draw poster overlays onto the composited canvas: gradient banners with
 * title, itinerary, stats, and attribution rendered via Canvas 2D text
 * (bypasses jsPDF font encoding limitations).
 */
function drawPosterOverlays(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  pxPerMm: number,
  title: string,
  familyName: string | null | undefined,
  itinerary: string[],
  distStr: string,
  pointCount: number,
  routeCount: number,
): void {
  const mm = (v: number) => Math.round(v * pxPerMm);
  const FONT = "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, Manjari, 'Arial Rounded MT', 'Arial Rounded MT Bold', Calibri, source-sans-pro, system-ui, sans-serif";

  // ── Thin inset border ──────────────────────────────────────────────────
  const b = mm(4);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = mm(0.4);
  roundedRect(ctx, b, b, w - b * 2, h - b * 2, mm(3));
  ctx.stroke();

  // ── Top gradient banner ────────────────────────────────────────────────
  // Dark orange tint from --wa-color-brand-60 (#e05e00) blended into black
  const topH = mm(36);
  const topGrad = ctx.createLinearGradient(0, 0, 0, topH);
  topGrad.addColorStop(0, 'rgba(56, 24, 0, 0.75)');
  topGrad.addColorStop(0.6, 'rgba(40, 17, 0, 0.25)');
  topGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, w, topH);

  // Title (with text shadow for readability over map)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = mm(2);

  const titleSize = mm(9);
  ctx.font = `bold ${titleSize}px ${FONT}`;
  ctx.fillStyle = '#FFFFFF';
  const titleMaxW = w - mm(24);
  const titleLines = wrapText(ctx, title, titleMaxW);
  let titleY = mm(7);
  for (const line of titleLines.slice(0, 2)) {
    ctx.fillText(line, w / 2, titleY, titleMaxW);
    titleY += titleSize * 1.3;
  }

  // Family name
  if (familyName) {
    const famSize = mm(4.5);
    ctx.font = `${famSize}px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(familyName, w / 2, titleY + mm(1), titleMaxW);
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // ── Bottom gradient banner ─────────────────────────────────────────────
  const botH = mm(42);
  const botGrad = ctx.createLinearGradient(0, h - botH, 0, h);
  botGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  botGrad.addColorStop(0.3, 'rgba(40, 17, 0, 0.25)');
  botGrad.addColorStop(1, 'rgba(56, 24, 0, 0.75)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, h - botH, w, botH);

  // Itinerary (compact flow of waypoint names)
  if (itinerary.length > 0) {
    const itinSize = mm(3.2);
    ctx.font = `${itinSize}px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = mm(1);

    const itinText = itinerary.join('  \u00B7  ');
    const itinMaxW = w - mm(20);
    const itinLines = wrapText(ctx, itinText, itinMaxW);
    let itinY = h - mm(22);
    for (const line of itinLines.slice(0, 2)) {
      ctx.fillText(line, w / 2, itinY, itinMaxW);
      itinY += itinSize * 1.6;
    }
    if (itinLines.length > 2) {
      ctx.fillText('\u2026', w / 2, itinY, itinMaxW);
    }

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  // Stats line
  const parts: string[] = [];
  if (distStr) parts.push(distStr);
  if (pointCount > 0) parts.push(`${pointCount} stop${pointCount !== 1 ? 's' : ''}`);
  if (routeCount > 0) parts.push(`${routeCount} route${routeCount !== 1 ? 's' : ''}`);
  if (parts.length > 0) {
    const statsSize = mm(2.8);
    ctx.font = `600 ${statsSize}px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(parts.join('  \u00B7  '), w / 2, h - mm(11), w - mm(20));
  }

  // Footer
  const footerSize = mm(2.2);
  const footerY = h - mm(5);
  ctx.textBaseline = 'top';
  ctx.font = `italic ${footerSize}px ${FONT}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.textAlign = 'left';
  ctx.fillText('Made with Mapadillo', mm(8), footerY);
  ctx.textAlign = 'right';
  ctx.font = `${footerSize}px ${FONT}`;
  ctx.fillText('Map data \u00A9 OpenStreetMap contributors', w - mm(8), footerY);
}

// ── PDF export (poster layout) ──────────────────────────────────────────────

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
  // 1. Render the map at high resolution
  const exporter = new MapExporter(map, DEFAULT_DPI, paperSize, orientation);
  const mapCanvas = await exporter.renderCanvas(markerFeatures);

  // 2. Compute page dimensions in mm (pass explicitly — jsPDF doesn't know custom sizes like '18x24')
  const effectiveSize = paperSize === 'auto' ? 'a3' : paperSize;
  const pdfOrientation: Orientation = paperSize === 'auto' ? 'landscape' : orientation;
  const [pw, ph] = PAPER_SIZES[effectiveSize];
  const pageW_mm = pdfOrientation === 'landscape' ? Math.max(pw, ph) : Math.min(pw, ph);
  const pageH_mm = pdfOrientation === 'landscape' ? Math.min(pw, ph) : Math.max(pw, ph);
  const pdf = new jsPDF({ unit: 'mm', format: [pageW_mm, pageH_mm] });

  // 3. Create poster canvas at exact page dimensions (200 DPI)
  const pxPerMm = DEFAULT_DPI / 25.4;
  const posterW = Math.round(pageW_mm * pxPerMm);
  const posterH = Math.round(pageH_mm * pxPerMm);

  const posterCanvas = document.createElement('canvas');
  posterCanvas.width = posterW;
  posterCanvas.height = posterH;
  const ctx = posterCanvas.getContext('2d')!;

  // 4. Dark background (visible only if map doesn't fill the page, e.g. 'auto')
  ctx.fillStyle = '#1C1C1E';
  ctx.fillRect(0, 0, posterW, posterH);

  // 5. Draw map canvas fitted into the poster (preserving aspect ratio)
  const mapAspect = mapCanvas.width / mapCanvas.height;
  const posterAspect = posterW / posterH;
  let mw: number, mh: number, mx: number, my: number;
  if (mapAspect > posterAspect) {
    mw = posterW; mh = posterW / mapAspect;
    mx = 0; my = (posterH - mh) / 2;
  } else {
    mh = posterH; mw = posterH * mapAspect;
    mx = (posterW - mw) / 2; my = 0;
  }
  ctx.drawImage(mapCanvas, mx, my, mw, mh);

  // 6. Compute trip stats
  const routes = stops.filter((s) => s.type === 'route');
  const points = stops.filter((s) => s.type === 'point');
  let totalMeters = 0;
  if (routeDistances?.size) {
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

  // 7. Draw poster overlays (title, itinerary, stats, attribution)
  drawPosterOverlays(
    ctx, posterW, posterH, pxPerMm,
    mapData.name,
    mapData.family_name,
    buildItinerary(stops),
    totalMeters > 0 ? formatDistance(totalMeters, units) : '',
    points.length,
    routes.length,
  );

  // 8. Embed composited poster in PDF and trigger download
  const imgData = posterCanvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', 0, 0, pageW_mm, pageH_mm);
  await pdf.save(`${sanitizeFilename(mapData.name)}.pdf`);
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export type ExportFormat = 'png' | 'jpeg' | 'pdf';
export type PaperSize = 'auto' | 'letter' | 'a4' | 'a3' | 'tabloid' | '18x24' | '24x36' | 'a2' | 'a1';
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
