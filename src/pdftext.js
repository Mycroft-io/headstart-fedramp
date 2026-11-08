// Extracts text per page from a PDF in the browser with pdf.js. The worker runs from an inline blob so
// the page needs no network. Returns an array of page strings. Scanned PDFs yield empty strings.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?text';
let workerUrl = null;
export async function pdfToPages(bytes, onProgress) {
  if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // rebuild lines from text items: a new line when y changes by more than a few units
    let lastY = null, line = [], lines = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 3) { lines.push(line.join(' ')); line = []; }
      line.push(it.str); lastY = y;
      if (it.hasEOL) { lines.push(line.join(' ')); line = []; lastY = null; }
    }
    if (line.length) lines.push(line.join(' '));
    pages.push(lines.join('\n'));
    onProgress?.(i, doc.numPages);
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}
