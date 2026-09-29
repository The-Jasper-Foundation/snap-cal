// Reads text from a photo in the browser with tesseract.js. The image never
// leaves the device: the engine and English data are served from /ocr/.
import { PSM, createWorker, type Worker } from 'tesseract.js';
import type { OcrLine } from './parse';

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

export type Progress = (status: string, fraction: number) => void;

let workerPromise: Promise<Worker> | null = null;
let onProgress: Progress = () => {};

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const base = new URL('ocr/', document.baseURI).href;
    workerPromise = createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base.replace(/\/$/, ''),
      logger: (m) => onProgress(describe(m.status), m.progress),
    }).then(async (worker) => {
      // The default mode assumes one uniform block of text and drops big,
      // isolated headline words. Sparse mode is made for posters and signs.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      return worker;
    });
    // Let a later scan try again if loading failed (e.g. first visit while offline).
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

function describe(status: string): string {
  if (status.includes('recognizing')) return 'Reading the poster…';
  if (status.includes('traineddata') || status.includes('core')) return 'Loading the text reader (first time only)…';
  return 'Getting ready…';
}

export async function readPoster(image: Blob, progress: Progress): Promise<OcrResult> {
  onProgress = progress;
  progress('Preparing the image…', 0);
  const canvas = await prepareImage(image);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });

  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const text = line.text.trim();
        if (!text) continue;
        lines.push({
          text,
          height: line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0,
          confidence: line.confidence,
        });
      }
    }
  }
  // tesseract's plain-text output can drop short, isolated headline words
  // that the line-level output keeps, so rebuild the text from the lines.
  return { text: lines.length > 0 ? lines.map((l) => l.text).join('\n') : data.text, lines };
}

/**
 * Scales the photo to a size tesseract handles well and converts it to
 * grayscale with stretched contrast, which helps with coloured posters.
 * Also applies the photo's EXIF rotation so phone pictures aren't sideways.
 */
async function prepareImage(image: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(Math.max(longest, 1600), 2400) / longest;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(max - min, 1);
  for (let i = 0; i < px.length; i += 4) {
    const g = ((px[i] - min) * 255) / range;
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** A small JPEG preview for the history list. */
export async function thumbnail(image: Blob, size = 160): Promise<string> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  const scale = size / Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}
