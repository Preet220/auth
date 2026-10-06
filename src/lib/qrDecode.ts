/**
 * Multi-stage QR decoding pipeline for low-quality phone images.
 *
 * Pipeline order (stops at first success):
 *  1. Original image as-is
 *  2. Upscaled small images to ~800px
 *  3. Grayscale
 *  4. Contrast enhancement (histogram stretch)
 * 5. Sharpening (unsharp mask)
 *  6. Adaptive thresholding (binarization)
 *  7. Region-crop for small QR codes (quadrant + center crops)
 *  8. Rotation sweeps (90/180/270 + ±15° micro-rotations)
 *
 * Each stage runs on the best candidate from the previous
 * round. The moment a valid QR is found, the pipeline exits.
 */

import { BrowserQRCodeReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';

let _reader: BrowserQRCodeReader | null = null;

function getReader(): BrowserQRCodeReader {
  if (_reader) return _reader;
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  _reader = new BrowserQRCodeReader(hints);
  return _reader;
}

/* ---------- canvas helpers ---------- */

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function drawImageToCanvas(img: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): HTMLCanvasElement {
  const c = makeCanvas(img.width || (img as HTMLVideoElement).videoWidth, img.height || (img as HTMLVideoElement).videoHeight);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return c;
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  return c;
}

/* ---------- preprocessing stages ---------- */

/** Convert to grayscale, return ImageData */
function toGrayscaleData(src: HTMLCanvasElement): ImageData {
  const ctx = src.getContext('2d')!;
  const data = ctx.getImageData(0, 0, src.width, src.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const gray = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = px[i + 1] = px[i + 2] = gray;
  }
  return data;
}

/** Stretch histogram to enhance contrast on a grayscale canvas */
function enhanceContrast(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext('2d')!;
  const imgData = ctx.getImageData(0, 0, src.width, src.height);
  const px = imgData.data;
  let min = 255, max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range < 10 || range > 245) return src; // already good or too uniform
  const scale = 255 / range;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i + 1] = px[i + 2] = Math.min(255, Math.max(0, ((px[i] - min) * scale) | 0));
  }
  ctx.putImageData(imgData, 0, 0);
  return src;
}

/** Unsharp mask — subtract a blurred version to sharpen edges */
function sharpen(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const blurred = makeCanvas(w, h);
  const bctx = blurred.getContext('2d')!;
  bctx.filter = 'blur(1px)';
  bctx.drawImage(src, 0, 0);
  bctx.filter = 'none';

  const out = makeCanvas(w, h);
  const octx = out.getContext('2d')!;
  const sData = src.getContext('2d')!.getImageData(0, 0, w, h);
  const bData = bctx.getImageData(0, 0, w, h);
  const oData = octx.createImageData(w, h);
  const amount = 1.5;
  for (let i = 0; i < sData.data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const idx = i + ch;
      const diff = sData.data[idx] - bData.data[idx];
      oData.data[idx] = Math.min(255, Math.max(0, sData.data[idx] + diff * amount));
    }
    oData.data[i + 3] = sData.data[i + 3];
  }
  octx.putImageData(oData, 0, 0);
  return out;
}

/** Adaptive threshold using local mean over a tile — good for uneven lighting */
function adaptiveThreshold(src: HTMLCanvasElement, tileSize = 15): HTMLCanvasElement {
  const ctx = src.getContext('2d')!;
  const w = src.width, h = src.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;
  // Build grayscale luminance array
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    lum[j] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
  }
  // Compute integral image for fast local mean
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += lum[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + rowSum;
    }
  }
  const half = (tileSize / 2) | 0;
  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - half), y1 = Math.max(0, y - half);
      const x2 = Math.min(w, x + half), y2 = Math.min(h, y + half);
      const count = (x2 - x1) * (y2 - y1);
      const sum = integral[y2 * (w + 1) + x2] - integral[y1 * (w + 1) + x2] - integral[y2 * (w + 1) + x1] + integral[y1 * (w + 1) + x1];
      const mean = sum / count;
      const val = lum[y * w + x] > mean - 10 ? 255 : 0;
      const idx = (y * w + x) * 4;
      out.data[idx] = out.data[idx + 1] = out.data[idx + 2] = val;
      out.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return src;
}

/** Resize canvas so its longest edge equals targetSize (only upscaling small images) */
function resizeTo(src: HTMLCanvasElement, targetSize: number): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const longest = Math.max(w, h);
  if (longest >= targetSize) return src; // don't downscale
  const scale = targetSize / longest;
  const c = makeCanvas((w * scale) | 0, (h * scale) | 0);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Rotate canvas by angle (degrees), expanding canvas to fit */
function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180;
  const w = src.width, h = src.height;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const nw = Math.ceil(w * cos + h * sin);
  const nh = Math.ceil(w * sin + h * cos);
  const c = makeCanvas(nw, nh);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, nw, nh);
  ctx.translate(nw / 2, nh / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -w / 2, -h / 2);
  return c;
}

/** Crop a sub-region of the canvas */
function cropCanvas(src: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

/* ---------- decode single canvas ---------- */

function tryDecode(canvas: HTMLCanvasElement): string | null {
  try {
    const result = getReader().decodeFromCanvas(canvas);
    if (result && result.getText()) return result.getText();
  } catch {
    // not found in this variant
  }
  return null;
}

/* ---------- main pipeline ---------- */

/**
 * Multi-stage QR decode from any image source (canvas, image, video frame).
 * Returns the decoded text or null.
 */
export function decodeQrFromCanvas(source: HTMLCanvasElement): string | null {
  // Stage 1: original as-is
  let result = tryDecode(source);
  if (result) return result;

  // Stage 2: upscale if small
  const longest = Math.max(source.width, source.height);
  if (longest < 800) {
    const upscaled = resizeTo(cloneCanvas(source), 800);
    result = tryDecode(upscaled);
    if (result) return result;
  }

  // Stage 3: grayscale + contrast
  const gray = cloneCanvas(source);
  toGrayscaleData(gray);
  result = tryDecode(gray);
  if (result) return result;

  const contrasted = enhanceContrast(cloneCanvas(gray));
  result = tryDecode(contrasted);
  if (result) return result;

  // Stage 4: sharpening on the contrasted grayscale
  const sharpened = sharpen(cloneCanvas(contrasted));
  result = tryDecode(sharpened);
  if (result) return result;

  // Stage 5: adaptive threshold on grayscale
  const binary = adaptiveThreshold(cloneCanvas(gray));
  result = tryDecode(binary);
  if (result) return result;

  // Stage 6: adaptive threshold on sharpened
  const binarySharp = adaptiveThreshold(cloneCanvas(sharpened));
  result = tryDecode(binarySharp);
  if (result) return result;

  // Stage 7: region crops for small QR codes
  const w = source.width, h = source.height;
  const crops: Array<[number, number, number, number]> = [
    [0, 0, (w * 0.5) | 0, (h * 0.5) | 0],         // top-left
    [(w * 0.5) | 0, 0, (w * 0.5) | 0, (h * 0.5) | 0], // top-right
    [0, (h * 0.5) | 0, (w * 0.5) | 0, (h * 0.5) | 0], // bottom-left
    [(w * 0.5) | 0, (h * 0.5) | 0, (w * 0.5) | 0, (h * 0.5) | 0], // bottom-right
    [(w * 0.25) | 0, (h * 0.25) | 0, (w * 0.5) | 0, (h * 0.5) | 0], // center
  ];
  for (const [cx, cy, cw, ch] of crops) {
    const cropped = cropCanvas(source, cx, cy, cw, ch);
    result = tryDecode(cropped);
    if (result) return result;
    // Try enhanced contrast on the crop
    const enhanced = enhanceContrast(cloneCanvas(cropped));
    result = tryDecode(enhanced);
    if (result) return result;
    // Try adaptive threshold on the crop
    const binCrop = adaptiveThreshold(cloneCanvas(cropped));
    result = tryDecode(binCrop);
    if (result) return result;
  }

  // Stage 8: rotation sweeps on the best base (contrasted grayscale)
  const rotationBase = contrasted;
  for (const deg of [90, 180, 270, -15, 15]) {
    const rotated = rotateCanvas(rotationBase, deg);
    result = tryDecode(rotated);
    if (result) return result;
  }

  return null;
}

/**
 * Decode a QR from a video frame by capturing it to a canvas first.
 */
export function decodeQrFromVideo(video: HTMLVideoElement): string | null {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(video, 0, 0, w, h);
  return decodeQrFromCanvas(c);
}
