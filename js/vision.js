/* LeakLens – on-device AI for images:
   1) face detection (face-api.js, SSD MobileNet + 68-point landmarks)
   2) optional school logo / uniform detector trained by the team in Teachable Machine
   Everything runs in the browser with TensorFlow.js. */
(function (root) {
  'use strict';
  const faceapi = root.faceapi;
  let facesReady = null;
  let logoModel = null, logoLabels = [];

  // Face detection models (downloaded once from the jsdelivr CDN, then cached by the browser).
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';

  function loadFaceModels() {
    if (!facesReady) {
      facesReady = Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      ]).catch(e => { facesReady = null; throw e; });
    }
    return facesReady;
  }

  /** Is the face looking at the camera? Compares nose position with the eyes. */
  function isFrontal(landmarks) {
    const pts = landmarks.positions;
    const leftEye = pts.slice(36, 42), rightEye = pts.slice(42, 48);
    const avg = arr => arr.reduce((a, p) => a + p.x, 0) / arr.length;
    const lx = avg(leftEye), rx = avg(rightEye), nose = pts[30].x;
    const eyeDist = Math.abs(rx - lx);
    if (eyeDist < 1) return false;
    const offset = Math.abs(nose - (lx + rx) / 2) / eyeDist;
    return offset < 0.18;
  }

  /** Detect faces on a canvas. Returns [{ bbox, score, area, frontal }] sorted biggest first. */
  async function detectFaces(canvas) {
    await loadFaceModels();
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
    const results = await faceapi.detectAllFaces(canvas, opts).withFaceLandmarks(true);
    const imgArea = canvas.width * canvas.height;
    return results.map(r => {
      const b = r.detection.box;
      // Grow the box a little so the blur covers hair and chin too.
      const padX = b.width * 0.18, padY = b.height * 0.25;
      const bbox = {
        x0: Math.max(0, b.x - padX), y0: Math.max(0, b.y - padY),
        x1: Math.min(canvas.width, b.x + b.width + padX), y1: Math.min(canvas.height, b.y + b.height + padY * 0.6),
      };
      return { bbox, score: r.detection.score, area: (b.width * b.height) / imgArea, frontal: isFrontal(r.landmarks) };
    }).sort((a, b) => b.area - a.area);
  }

  // ---------- Optional Teachable Machine logo / uniform model ----------
  const tf = () => faceapi.tf;

  async function loadLogoFromFiles(files) {
    const list = Array.from(files);
    const json = list.find(f => f.name.endsWith('model.json'));
    const weights = list.filter(f => f.name.endsWith('.bin'));
    const meta = list.find(f => f.name.endsWith('metadata.json'));
    if (!json || !weights.length) throw new Error('Please choose model.json and weights.bin together.');
    logoModel = await tf().loadLayersModel(tf().io.browserFiles([json, ...weights]));
    logoLabels = meta ? (JSON.parse(await meta.text()).labels || []) : [];
    try {
      await logoModel.save('indexeddb://leaklens-logo');
      localStorage.setItem('leaklens-logo-labels', JSON.stringify(logoLabels));
    } catch (e) { /* storage may be blocked; model still works this session */ }
    return logoLabels;
  }

  async function restoreLogoModel() {
    try {
      const models = await tf().io.listModels();
      if (models['indexeddb://leaklens-logo']) {
        logoModel = await tf().loadLayersModel('indexeddb://leaklens-logo');
        logoLabels = JSON.parse(localStorage.getItem('leaklens-logo-labels') || '[]');
      }
    } catch (e) { logoModel = null; }
    return !!logoModel;
  }

  async function clearLogoModel() {
    logoModel = null; logoLabels = [];
    try { await tf().io.removeModel('indexeddb://leaklens-logo'); localStorage.removeItem('leaklens-logo-labels'); } catch (e) { /* ignore */ }
  }

  const hasLogoModel = () => !!logoModel;

  /** Slide a window over the photo; tiles where the model sees the logo/uniform (class 0) are marked. */
  async function detectLogo(canvas, threshold = 0.85) {
    if (!logoModel) return [];
    const T = tf();
    const size = Math.round(Math.min(canvas.width, canvas.height) / 2.5);
    const stride = Math.round(size / 2);
    const hits = [];
    const tile = document.createElement('canvas');
    tile.width = tile.height = 224;
    const tctx = tile.getContext('2d');
    for (let y = 0; y + size <= canvas.height; y += stride) {
      for (let x = 0; x + size <= canvas.width; x += stride) {
        tctx.drawImage(canvas, x, y, size, size, 0, 0, 224, 224);
        const p = T.tidy(() => {
          const input = T.browser.fromPixels(tile).toFloat().div(127.5).sub(1).expandDims(0);
          return logoModel.predict(input).dataSync();
        });
        if (p[0] >= threshold) hits.push({ x0: x, y0: y, x1: x + size, y1: y + size, p: p[0] });
      }
      await new Promise(r => setTimeout(r, 0)); // keep the page responsive
    }
    // Merge overlapping tiles into regions.
    const regions = [];
    hits.forEach(h => {
      const r = regions.find(g => h.x0 < g.x1 && h.x1 > g.x0 && h.y0 < g.y1 && h.y1 > g.y0);
      if (r) { r.x0 = Math.min(r.x0, h.x0); r.y0 = Math.min(r.y0, h.y0); r.x1 = Math.max(r.x1, h.x1); r.y1 = Math.max(r.y1, h.y1); }
      else regions.push({ ...h });
    });
    return regions.map(r => ({ bbox: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, label: logoLabels[0] || 'logo' }));
  }

  root.LL = root.LL || {};
  root.LL.vision = { loadFaceModels, detectFaces, loadLogoFromFiles, restoreLogoModel, clearLogoModel, hasLogoModel, detectLogo };
})(window);
