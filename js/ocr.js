// On-device receipt reading. The OCR engine and English model ship inside the app (vendor/tesseract),
// so a receipt photo never leaves the PC and this works with no internet at all.
const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let workerP, loading;

function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  return (loading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = BASE + 'tesseract.min.js';
    s.onload = res; s.onerror = () => rej(new Error('ocr-missing'));
    document.head.append(s);
  }));
}

let progressCb = () => {};
async function getWorker() {
  await loadScript();
  return (workerP ||= window.Tesseract.createWorker('eng', 1, {
    workerPath: BASE + 'worker.min.js', corePath: BASE, langPath: BASE + 'lang/', gzip: true, cacheMethod: 'none',
    logger: (m) => { if (m.status === 'recognizing text') progressCb(m.progress); },
  }));
}
/** Warm the engine while the app is idle so the first scan feels instant. */
export function warmUp() { (window.requestIdleCallback || setTimeout)(() => { getWorker().catch(() => { workerP = null; }); }, { timeout: 4000 }); }

/** Decodes, downsizes and boosts contrast. Returns {ocr: canvas, photo: Blob(jpeg)}. */
export async function prepare(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const fit = (max) => { const k = Math.min(1, max / Math.max(bmp.width, bmp.height)); return [Math.round(bmp.width * k), Math.round(bmp.height * k)]; };
  const [pw, ph] = fit(1600);
  const photo = document.createElement('canvas'); photo.width = pw; photo.height = ph;
  photo.getContext('2d').drawImage(bmp, 0, 0, pw, ph);
  const [ow, oh] = fit(2200);
  const c = document.createElement('canvas'); c.width = ow; c.height = oh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, ow, oh);
  const img = g.getImageData(0, 0, ow, oh), d = img.data;
  let lo = 255, hi = 0;
  const gray = new Uint8Array(ow * oh);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { const v = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0; gray[p] = v; }
  const hist = new Uint32Array(256); gray.forEach((v) => hist[v]++);
  const total = gray.length; let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01 && lo === 255) lo = v; if (acc > total * 0.99) { hi = v; break; } }
  const span = Math.max(40, hi - lo);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { const v = Math.max(0, Math.min(255, ((gray[p] - lo) * 255) / span)) | 0; d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(img, 0, 0);
  bmp.close?.();
  const blob = await new Promise((r) => photo.toBlob(r, 'image/jpeg', 0.78));
  return { ocr: c, photo: blob };
}

export async function readReceipt(canvas, onProgress) {
  progressCb = onProgress || (() => {});
  const w = await getWorker();
  const { data } = await w.recognize(canvas);
  return data.text || '';
}
