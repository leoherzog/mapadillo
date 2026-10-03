import { describe, expect, it, vi } from 'vitest';
import { exportDpi, pageMm, paperFramePadding } from './map-export.js';

describe('paperFramePadding', () => {
  it('pads a landscape frame on a wide view to 85% of the height plus the inset', () => {
    // Letter landscape on 1400x900: frame height 765, width 765 * 279.4 / 215.9.
    const pad = paperFramePadding(1400, 900, 'letter', 'landscape');
    const frameW = 765 * (279.4 / 215.9);
    expect(pad.top).toBeCloseTo((900 - 765) / 2 + 24);
    expect(pad.bottom).toBe(pad.top);
    expect(pad.left).toBeCloseTo((1400 - frameW) / 2 + 24);
    expect(pad.right).toBe(pad.left);
  });

  it('pads a portrait frame on a wide view by its width-limited side', () => {
    const pad = paperFramePadding(400, 1000, 'a4', 'portrait', 0);
    const frameW = 0.85 * 400;
    const [w, h] = pageMm('a4', 'portrait');
    expect(pad.left).toBeCloseTo((400 - frameW) / 2);
    expect(pad.top).toBeCloseTo((1000 - frameW * (h / w)) / 2);
  });
});

describe('exportDpi', () => {
  // The node test environment has no WebGL, so the canvas cap falls back to 4096 px.
  it('reaches 300 DPI when the long side fits the canvas cap', () => {
    expect(exportDpi('letter', 'portrait')).toBe(300);
  });

  it('scales down by the cap on the long side', () => {
    const longPx = (1524 / 25.4) * 300;
    expect(exportDpi('40x60', 'landscape')).toBeCloseTo(300 * (4096 / longPx));
    expect(exportDpi('40x60', 'portrait')).toBe(exportDpi('40x60', 'landscape'));
  });
});

describe('exportDpi with a 16384 px GPU texture limit', () => {
  /** Loads exportDpi in a stub browser whose 2D canvases draw nothing above maxArea pixels. */
  async function exportDpiWithCanvasArea(maxArea: number) {
    vi.resetModules();
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 300,
          height: 150,
          getContext: (type: string) => type === 'webgl2'
            ? { MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => 16384, getExtension: () => null }
            : {
                fillRect: () => {},
                getImageData: () => ({ data: [0, 0, 0, canvas.width * canvas.height <= maxArea ? 255 : 0] }),
              },
        };
        return canvas;
      },
    });
    return (await import('./map-export.js')).exportDpi;
  }

  it('keeps 300 DPI where the browser backs the full-size canvas', async () => {
    const exportDpi = await exportDpiWithCanvasArea(16384 * 16384);
    expect(exportDpi('24x36', 'landscape')).toBe(300);
  });

  it('caps the canvas area where the browser cannot back it, as iOS does above 8192 x 8192', async () => {
    const exportDpi = await exportDpiWithCanvasArea(8192 * 8192);
    expect(exportDpi('a4', 'portrait')).toBe(300);
    expect(exportDpi('24x36', 'landscape')).toBeCloseTo(300 * Math.sqrt((8192 * 8192) / (10800 * 7200)));
    // The 13107 px dimension cap still leaves 40x60 over the area limit.
    expect(exportDpi('40x60', 'portrait')).toBeCloseTo(300 * Math.sqrt((8192 * 8192) / (12000 * 18000)));
  });
});
