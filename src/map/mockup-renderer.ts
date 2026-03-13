/**
 * Canvas 2D mockup renderer — draws a "partially unrolled poster on a table"
 * viewed from an angled perspective. Zero dependencies, Canvas 2D only.
 *
 * The entire poster (flat + curl) is rendered strip-by-strip with trapezoidal
 * perspective: the bottom edge (nearest to viewer) is wider, the top edge
 * (farther away) is narrower, simulating a camera looking down at ~20°.
 */

export interface MockupOptions {
  /** Fraction of the image that curls (0–0.5). Default: 0.25 */
  curlFraction?: number;
  /** Surface background color. Default: '#f0ebe3' */
  surfaceColor?: string;
  /** How much the far edge shrinks relative to the near edge (0–1). Default: 0.25 */
  perspectiveShrink?: number;
}

/**
 * Render a "partially unrolled poster on a table" mockup with angled perspective.
 */
export function renderMockup(
  source: HTMLImageElement | HTMLCanvasElement,
  target: HTMLCanvasElement,
  options?: MockupOptions,
): void {
  const curlFraction = options?.curlFraction ?? 0.25;
  const surfaceColor = options?.surfaceColor ?? '#f0ebe3';
  const shrink = options?.perspectiveShrink ?? 0.25;

  const ctx = target.getContext('2d')!;
  const tw = target.width;
  const th = target.height;

  const srcW = (source as HTMLImageElement).naturalWidth || source.width;
  const srcH = (source as HTMLImageElement).naturalHeight || source.height;
  if (!srcW || !srcH || !tw || !th) return;

  // ── 1. Surface background ──────────────────────────────────────────────
  ctx.fillStyle = surfaceColor;
  ctx.fillRect(0, 0, tw, th);

  // Subtle warm gradient (light from upper-left)
  const surfGrad = ctx.createLinearGradient(0, 0, tw, th);
  surfGrad.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
  surfGrad.addColorStop(1, 'rgba(0, 0, 0, 0.05)');
  ctx.fillStyle = surfGrad;
  ctx.fillRect(0, 0, tw, th);

  // ── 2. Poster sizing ──────────────────────────────────────────────────
  const padX = 0.06;
  const padTop = 0.10;  // extra room for the curl
  const padBot = 0.04;
  const availW = tw * (1 - padX * 2);
  const availH = th * (1 - padTop - padBot);
  const aspect = srcW / srcH;

  let posterW: number;
  let posterH: number;
  if (aspect > availW / availH) {
    posterW = availW;
    posterH = posterW / aspect;
  } else {
    posterH = availH;
    posterW = posterH * aspect;
  }

  // The poster's "near edge" (bottom) center and its total height on screen.
  // Perspective compresses vertical spacing toward the top, so the effective
  // screen height is less than posterH. We compute actual screen extents so
  // we can center the result properly.
  const flatFraction = 1 - curlFraction;
  const flatSrcH = Math.round(srcH * flatFraction);
  const curlSrcH = srcH - flatSrcH;
  const flatDestH = posterH * flatFraction;

  // Curl geometry
  const curlDestH = posterH * curlFraction;
  const totalArc = Math.PI * 0.82;
  const R = curlDestH / totalArc;

  // Estimate total screen height (flat + curl peak) for centering.
  // Curl peak = R * sin(totalArc) above the flat top.
  const curlPeakH = R * Math.sin(totalArc);
  const totalVisualH = flatDestH + curlPeakH;

  // Bottom-center of the poster on the canvas
  const centerX = tw / 2;
  const bottomY = th * (1 - padBot) - (availH - totalVisualH) * 0.3;

  // ── 3. Perspective helpers ────────────────────────────────────────────
  // t=0 at bottom (near), t=1 at the flat top. Width shrinks linearly.
  // Vertical position is compressed: dy_screen = dy * (1 - t*shrink*0.5)
  // This simulates foreshortening from a viewing angle.

  const widthAt = (t: number) => posterW * (1 - t * shrink);
  const yCompress = (t: number) => 1 - t * shrink * 0.5;
  // Slight shading: far strips are subtly darker (less light reaches them)
  const flatShade = (t: number) => t * 0.08;

  // ── 4. Drop shadow (trapezoidal) ─────────────────────────────────────
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.20)';
  ctx.shadowBlur = posterW * 0.03;
  ctx.shadowOffsetX = posterW * 0.006;
  ctx.shadowOffsetY = posterW * 0.01;
  // Draw a trapezoid shape for the shadow
  const botW = widthAt(0);
  const topW = widthAt(1);
  const topY = bottomY - flatDestH * yCompress(1);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(centerX - botW / 2, bottomY);
  ctx.lineTo(centerX + botW / 2, bottomY);
  ctx.lineTo(centerX + topW / 2, topY);
  ctx.lineTo(centerX - topW / 2, topY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ── 5. Draw flat portion (strip-by-strip with perspective) ────────────
  const flatStrips = Math.max(flatSrcH, 1);
  let curY = bottomY;

  for (let i = 0; i < flatStrips; i++) {
    // t: 0 at bottom (near), 1 at top (far)
    const t = i / flatStrips;
    const srcY = srcH - 1 - i; // read source from bottom up

    const w = widthAt(t);
    const x = centerX - w / 2;

    // Vertical step is compressed by perspective
    const stepH = (flatDestH / flatStrips) * yCompress(t);
    curY -= stepH;

    ctx.drawImage(source, 0, srcY, srcW, 1, x, curY, w, stepH + 0.5);

    // Subtle perspective shading
    const shade = flatShade(t);
    if (shade > 0.005) {
      ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
      ctx.fillRect(x, curY, w, stepH + 0.5);
    }
  }

  const flatTopScreenY = curY; // where the flat portion ends on screen
  const flatTopT = 1;          // t-value at the flat top

  // ── 6. Draw curl (strip-by-strip on cylinder arc) ─────────────────────
  const numCurlStrips = Math.max(curlSrcH, 1);
  const srcScale = flatDestH / flatSrcH;

  for (let i = 0; i < numCurlStrips; i++) {
    const ct = i / numCurlStrips; // 0 at curl base, 1 at roll top
    const theta = ct * totalArc;

    const srcY = curlSrcH - 1 - i;

    // Height above the flat surface on the cylinder
    const dy = R * Math.sin(theta);
    const depth = R * (1 - Math.cos(theta));

    // Screen Y: flat top minus the arc height, with perspective compression
    // The curl is "further away" than the flat top, so it gets additional shrink
    const curlT = flatTopT + (depth / posterH) * 0.5; // effective t for perspective
    const stripY = flatTopScreenY - dy * yCompress(curlT);

    // Foreshortening from the cylinder curvature
    const stripH = Math.max(0.4, srcScale * Math.abs(Math.cos(theta)) * yCompress(curlT));

    // Width: continues the perspective taper, plus additional depth shrink
    const wBase = widthAt(flatTopT);
    const depthShrink = 1 - depth / (posterH * 1.5);
    const stripW = wBase * depthShrink;
    const stripX = centerX - stripW / 2;

    // Shading: front-lit → edge → back-facing
    let brightness: number;
    if (theta <= Math.PI / 2) {
      brightness = 1.0 - (theta / (Math.PI / 2)) * 0.3;
    } else {
      brightness = 0.7 - ((theta - Math.PI / 2) / (Math.PI / 2)) * 0.4;
    }
    // Add the base perspective shading
    brightness -= flatShade(flatTopT);

    ctx.drawImage(source, 0, srcY, srcW, 1, stripX, stripY, stripW, stripH);

    if (brightness < 1) {
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, 1 - brightness)})`;
      ctx.fillRect(stripX, stripY, stripW, stripH);
    }
  }

  // ── 7. Shadow at curl/flat transition ─────────────────────────────────
  const shadowH = posterH * 0.03;
  const shadowW = widthAt(flatTopT);
  const shadowGrad = ctx.createLinearGradient(0, flatTopScreenY - shadowH, 0, flatTopScreenY + shadowH * 0.4);
  shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  shadowGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.10)');
  shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(centerX - shadowW / 2, flatTopScreenY - shadowH, shadowW, shadowH * 1.4);

  // ── 8. Paper edge highlight at roll apex ──────────────────────────────
  const topTheta = totalArc;
  const topDy = R * Math.sin(topTheta);
  const topDepth = R * (1 - Math.cos(topTheta));
  const edgeCurlT = flatTopT + (topDepth / posterH) * 0.5;
  const edgeY = flatTopScreenY - topDy * yCompress(edgeCurlT);
  const edgeDepthShrink = 1 - topDepth / (posterH * 1.5);
  const edgeW = widthAt(flatTopT) * edgeDepthShrink;
  const edgeX = centerX - edgeW / 2;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = Math.max(1, posterW * 0.003);
  ctx.beginPath();
  ctx.moveTo(edgeX, edgeY);
  ctx.lineTo(edgeX + edgeW, edgeY);
  ctx.stroke();

  // Shadow line below edge
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.lineWidth = Math.max(1, posterW * 0.002);
  ctx.beginPath();
  ctx.moveTo(edgeX, edgeY + ctx.lineWidth * 2);
  ctx.lineTo(edgeX + edgeW, edgeY + ctx.lineWidth * 2);
  ctx.stroke();
}
