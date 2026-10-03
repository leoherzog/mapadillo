/**
 * Map export module: renders a MapLibre map to PNG, JPEG, or decorative PDF.
 *
 * Renders an offscreen MapLibre map at print resolution, draws markers and
 * poster overlays with Canvas 2D, then encodes with `canvas.toBlob` or jsPDF.
 */
import * as maplibregl from 'maplibre-gl';
import { jsPDF } from 'jspdf';
import type { MapData, Stop } from '../services/maps.js';
import type { PaperSize, Orientation } from '../../shared/paper.js';
import { formatDistance, haversineDistance, sanitizeFilename } from '../utils/geo.js';
import { DEFAULT_ICON } from '../../shared/icons.js';
import { renderMarkerCanvas } from './map-controller.js';

export type { PaperSize, Orientation };

// ── Constants ────────────────────────────────────────────────────────────────

const EXPORT_DPI = 300;
const RENDER_TIMEOUT_MS = 30_000;

/** Query the GPU's max texture size once, with a conservative fallback. */
const MAX_CANVAS_DIM = (() => {
  try {
    const canvas = document.createElement('canvas');
    // MapLibre v6 renders on WebGL2 only, so query the limit from the same
    // context type it will actually use.
    const gl = canvas.getContext('webgl2');
    if (gl) {
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      // Release the WebGL context — they are a limited resource
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      // Leave ~20% headroom — MapLibre uses multiple framebuffers internally
      return Math.floor(max * 0.8);
    }
  } catch { /* fall through */ }
  return 4096;
})();
const RENDER_ERROR_MSG = 'Unable to render map at this resolution. Try on a desktop browser.';
const RENDER_TIMEOUT_MSG = 'Map rendering timed out. Please try again.';

/** Paper dimensions in mm (portrait: width × height). */
const PAPER_SIZES: Record<PaperSize, [number, number]> = {
  letter: [215.9, 279.4],
  a4: [210, 297],
  a3: [297, 420],
  tabloid: [279.4, 431.8],
  '18x24': [457.2, 609.6],
  '24x36': [609.6, 914.4],
  '40x60': [1016, 1524],
  a2: [420, 594],
  a1: [594, 841],
};

/** Page dimensions in mm as [width, height] for the given orientation. */
export function pageMm(paperSize: PaperSize, orientation: Orientation): [number, number] {
  const [pw, ph] = PAPER_SIZES[paperSize];
  const short = Math.min(pw, ph);
  const long = Math.max(pw, ph);
  return orientation === 'landscape' ? [long, short] : [short, long];
}

// ── High-resolution map render ──────────────────────────────────────────────

/**
 * Render the map's current view for a paper size at EXPORT_DPI in an
 * offscreen MapLibre map, with custom markers drawn on top.
 */
async function renderMapCanvas(
  map: maplibregl.Map,
  paperSize: PaperSize,
  orientation: Orientation,
  markerFeatures: GeoJSON.Feature<GeoJSON.Point>[],
): Promise<HTMLCanvasElement> {
  const [mmW, mmH] = pageMm(paperSize, orientation);
  let width = Math.round((mmW / 25.4) * EXPORT_DPI);
  let height = Math.round((mmH / 25.4) * EXPORT_DPI);

  // Size the render container to the paper frame's on-screen CSS pixels so
  // line widths, text and icons keep the live preview's proportions.
  // Frame CSS in map-preview-page.ts: width: min(85cqw, 85cqh * pw / ph); aspect-ratio: pw / ph
  const srcContainer = map.getContainer();
  const exportAspect = width / height;
  const cssWidth = Math.min(0.85 * srcContainer.clientWidth, 0.85 * srcContainer.clientHeight * exportAspect);
  const cssHeight = cssWidth / exportAspect;

  // Cap max canvas dimension — scale down proportionally if either exceeds limit
  if (width > MAX_CANVAS_DIM || height > MAX_CANVAS_DIM) {
    const ratio = Math.min(MAX_CANVAS_DIM / width, MAX_CANVAS_DIM / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const renderPixelRatio = width / cssWidth;

  // Hidden container at the paper frame's CSS pixel size. MapLibre's
  // pixelRatio scales the internal canvas up to width × height.
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '-99999px';
  container.style.width = `${cssWidth}px`;
  container.style.height = `${cssHeight}px`;
  container.style.visibility = 'hidden';
  document.body.appendChild(container);

  let renderMap: maplibregl.Map | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const style = map.getStyle();

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

    renderMap = new maplibregl.Map({
      container,
      style,
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      pixelRatio: renderPixelRatio,
      // MapLibre defaults maxCanvasSize to [4096, 4096] and silently clamps
      // pixelRatio to fit, which would downscale the export.
      maxCanvasSize: [width, height],
      canvasContextAttributes: { preserveDrawingBuffer: true },
      interactive: false,
      attributionControl: false,
    });

    // Supply marker images on demand so MapLibre can compute correct
    // text label positioning (even though the icons are invisible).
    renderMap.setMissingStyleImageResolver((id: string) => {
      if (id.startsWith('marker-')) {
        const img = map.getImage(id);
        if (img) renderMap?.addImage(id, img.data);
      }
    });

    const failed = renderMap.once('error').then(() => { throw new Error(RENDER_ERROR_MSG); });
    // A tile or glyph error after 'idle' wins must not surface as an unhandled rejection.
    failed.catch(() => {});
    await Promise.race([
      renderMap.once('idle'),
      failed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(RENDER_TIMEOUT_MSG)), RENDER_TIMEOUT_MS);
      }),
    ]);

    const canvas = renderMap.getCanvas();
    if (!canvas || canvas.width === 0 || canvas.height === 0) throw new Error(RENDER_ERROR_MSG);

    // Clone the canvas data so the temp map can be destroyed
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = canvas.width;
    outputCanvas.height = canvas.height;
    const ctx = outputCanvas.getContext('2d');
    if (!ctx) throw new Error(RENDER_ERROR_MSG);
    ctx.drawImage(canvas, 0, 0);

    // Draw composite marker images onto the output canvas (they are not part of the style).
    // renderMap.project() returns CSS pixel coords — scale by pixelRatio for canvas coords.
    // Use the actual canvas-to-CSS ratio rather than the pre-computed renderPixelRatio
    // in case MapLibre clamped the pixel ratio (e.g. due to GPU limits).
    const actualPixelRatio = canvas.width / container.clientWidth;
    await drawMarkersOnCanvas(ctx, renderMap, outputCanvas.width, outputCanvas.height, markerFeatures, actualPixelRatio);
    return outputCanvas;
  } catch (err) {
    throw err instanceof Error && err.message === RENDER_TIMEOUT_MSG ? err : new Error(RENDER_ERROR_MSG);
  } finally {
    clearTimeout(timer);
    renderMap?.remove();
    container.remove();
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
    const iconName = iconId?.replace(/^marker-/, '') ?? DEFAULT_ICON;
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
    const iconName = iconId?.replace(/^marker-/, '') ?? DEFAULT_ICON;
    const iconCanvas = iconCanvases.get(iconName);
    if (iconCanvas) {
      ctx.drawImage(iconCanvas, x - halfSize, y - halfSize, markerSize, markerSize);
    }
  }
}

// ── File download helper ─────────────────────────────────────────────────────

export function triggerDownload(blob: Blob, filename: string): void {
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

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
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

// ── Trip details overlay (shared by raster + PDF) ────────────────────────────

/** Data needed to draw poster overlays on any export format. */
export interface TripDetails {
  mapData: MapData;
  stops: Stop[];
  units: string;
  routeDistances?: Map<string, number>;
}

/**
 * Composite a rendered map canvas with poster overlays (title, itinerary,
 * stats, attribution) onto a new canvas at the paper's DPI dimensions.
 * Used for PNG/JPEG exports with "Include trip details" enabled.
 */
function compositeWithOverlays(
  mapCanvas: HTMLCanvasElement,
  paperSize: PaperSize,
  orientation: Orientation,
  details: TripDetails,
): HTMLCanvasElement {
  const [pageW_mm, pageH_mm] = pageMm(paperSize, orientation);

  // Compute poster pixel dimensions. Cap to MAX_CANVAS_DIM so browsers
  // don't silently fail on huge canvases (e.g. 40×60" at 300 DPI = 12000×18000).
  const pxPerMm = EXPORT_DPI / 25.4;
  let posterW = Math.round(pageW_mm * pxPerMm);
  let posterH = Math.round(pageH_mm * pxPerMm);
  let effectivePxPerMm = pxPerMm;

  if (posterW > MAX_CANVAS_DIM || posterH > MAX_CANVAS_DIM) {
    const ratio = Math.min(MAX_CANVAS_DIM / posterW, MAX_CANVAS_DIM / posterH);
    posterW = Math.round(posterW * ratio);
    posterH = Math.round(posterH * ratio);
    effectivePxPerMm = pxPerMm * ratio;
  }

  const posterCanvas = document.createElement('canvas');
  posterCanvas.width = posterW;
  posterCanvas.height = posterH;
  const ctx = posterCanvas.getContext('2d')!;

  // Dark background
  ctx.fillStyle = '#1C1C1E';
  ctx.fillRect(0, 0, posterW, posterH);

  // Draw map fitted into poster
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

  // Compute stats and draw overlays
  const { mapData, stops, units, routeDistances } = details;
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

  drawPosterOverlays(
    ctx, posterW, posterH, effectivePxPerMm,
    mapData.name,
    mapData.family_name,
    buildItinerary(stops),
    totalMeters > 0 ? formatDistance(totalMeters, units) : '',
    points.length,
    routes.length,
  );

  return posterCanvas;
}

// ── Raster export (PNG / JPEG) ───────────────────────────────────────────────

async function downloadRaster(
  map: maplibregl.Map, markerFeatures: GeoJSON.Feature<GeoJSON.Point>[], paperSize: PaperSize, orientation: Orientation,
  mimeType: string, filename: string, quality?: number,
  tripDetails?: TripDetails,
): Promise<void> {
  const mapCanvas = await renderMapCanvas(map, paperSize, orientation, markerFeatures);

  let outputCanvas: HTMLCanvasElement;
  if (tripDetails) {
    outputCanvas = compositeWithOverlays(mapCanvas, paperSize, orientation, tripDetails);
  } else {
    drawAttribution(mapCanvas);
    outputCanvas = mapCanvas;
  }

  const blob = await canvasToBlob(outputCanvas, mimeType, quality);
  triggerDownload(blob, filename);
}

async function downloadPNG(
  map: maplibregl.Map, markerFeatures: GeoJSON.Feature<GeoJSON.Point>[], paperSize: PaperSize, orientation: Orientation,
  filename = 'mapadillo-map.png', tripDetails?: TripDetails,
): Promise<void> {
  return downloadRaster(map, markerFeatures, paperSize, orientation, 'image/png', filename, undefined, tripDetails);
}

async function downloadJPEG(
  map: maplibregl.Map, markerFeatures: GeoJSON.Feature<GeoJSON.Point>[], paperSize: PaperSize, orientation: Orientation,
  filename = 'mapadillo-map.jpg', tripDetails?: TripDetails,
): Promise<void> {
  return downloadRaster(map, markerFeatures, paperSize, orientation, 'image/jpeg', filename, 0.92, tripDetails);
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
  ctx.beginPath();
  ctx.roundRect(b, b, w - b * 2, h - b * 2, mm(3));
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
  markerFeatures: GeoJSON.Feature<GeoJSON.Point>[],
  paperSize: PaperSize,
  orientation: Orientation,
  filename: string,
  tripDetails?: TripDetails,
): Promise<void> {
  // 1. Render the map at high resolution
  const mapCanvas = await renderMapCanvas(map, paperSize, orientation, markerFeatures);

  // 2. Compute page dimensions in mm
  const [pageW_mm, pageH_mm] = pageMm(paperSize, orientation);
  const pdf = new jsPDF({ unit: 'mm', format: [pageW_mm, pageH_mm], orientation });

  let outputCanvas: HTMLCanvasElement;

  if (tripDetails) {
    // Poster layout with overlays (no DPI cap — jsPDF handles encoding)
    outputCanvas = compositeWithOverlays(mapCanvas, paperSize, orientation, tripDetails);
  } else {
    // Plain map, just add attribution
    drawAttribution(mapCanvas);
    outputCanvas = mapCanvas;
  }

  // Embed in PDF and trigger download
  pdf.addImage(outputCanvas, 'PNG', 0, 0, pageW_mm, pageH_mm);
  await pdf.save(filename);
}

// ── Render to Blob (for print ordering) ──────────────────────────────────────

export async function renderToBlob(
  map: maplibregl.Map,
  markerFeatures: GeoJSON.Feature<GeoJSON.Point>[],
  paperSize: PaperSize,
  orientation: Orientation,
): Promise<Blob> {
  const canvas = await renderMapCanvas(map, paperSize, orientation, markerFeatures);
  drawAttribution(canvas);
  return canvasToBlob(canvas, 'image/png');
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export type ExportFormat = 'png' | 'jpeg' | 'pdf';

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
  includeTripDetails = false,
): Promise<void> {
  const baseName = sanitizeFilename(mapData.name);
  const tripDetails: TripDetails | undefined = includeTripDetails
    ? { mapData, stops, units, routeDistances }
    : undefined;

  switch (format) {
    case 'png':
      return downloadPNG(map, markerFeatures, paperSize, orientation, `${baseName}.png`, tripDetails);
    case 'jpeg':
      return downloadJPEG(map, markerFeatures, paperSize, orientation, `${baseName}.jpg`, tripDetails);
    case 'pdf':
      return downloadPDF(map, markerFeatures, paperSize, orientation, `${baseName}.pdf`, tripDetails);
    default:
      throw new Error(`Unsupported export format: ${format as string}`);
  }
}
