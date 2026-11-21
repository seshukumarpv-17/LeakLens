/* LeakLens – reads text in the photo with Tesseract OCR.
   The OCR engine and English language data download once from the jsdelivr CDN;
   the photo itself is processed in the browser and never uploaded. */
(function (root) {
  'use strict';
  const CDN = {
    worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
  };
  let workerPromise = null;
  let onProgress = () => {};

  function getWorker() {
    if (!workerPromise) {
      workerPromise = root.Tesseract.createWorker('eng', 1, {
        workerPath: CDN.worker,
        corePath: CDN.core,
        langPath: CDN.lang,
        logger: m => { if (m.status === 'recognizing text') onProgress(m.progress); },
      }).catch(e => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  function toLines(data) {
    let lines = data.lines;
    if (!lines && data.blocks) {
      lines = [];
      data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => lines.push(l))));
    }
    return (lines || []).map(l => ({
      text: l.text,
      words: (l.words || []).map(w => ({ text: w.text, bbox: w.bbox, confidence: w.confidence })),
    }));
  }

  /** Reads the photo twice: once as a normal page (mode 3) and once looking for scattered
   *  text such as signs, plates and labels (mode 11). Returns all lines:
   *  [{ text, words:[{ text, bbox, confidence }] }] in canvas pixels. */
  async function readText(canvas, progress) {
    const report = progress || (() => {});
    const worker = await getWorker();
    const all = [];
    const modes = ['3', '11'];
    for (let i = 0; i < modes.length; i++) {
      onProgress = p => report((i + p) / modes.length);
      await worker.setParameters({ tessedit_pageseg_mode: modes[i] });
      const { data } = await worker.recognize(canvas);
      all.push(...toLines(data));
    }
    report(1);
    return all;
  }

  root.LL = root.LL || {};
  root.LL.ocr = { readText, warmUp: getWorker };
})(window);
