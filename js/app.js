/* LeakLens – main app: pick photo → scan → show leaks + score → fix → save clean copy. */
(function () {
  'use strict';
  const { i18n, exif, pii, score, vision, ocr, blurRegion } = window.LL;
  const $ = id => document.getElementById(id);
  const WORK_MAX = 1600;   // size used for checking and preview
  const EXPORT_MAX = 3000; // size of the saved clean photo

  const ICONS = {
    me: '🙋', gps: '📍', meta: '📱', face_other: '🙂', morph: '🎭', logo: '🏫', aadhaar: '🪪', phone: '📞', email: '✉️',
    handle: '#️⃣', plate: '🚗', house: '🏠', pincode: '📮', address: '🛣️', school: '🏫', studentid: '🎓', name: '📝',
  };
  const REGION_TYPES = new Set(['face_other', 'logo', 'aadhaar', 'phone', 'email', 'handle', 'plate', 'house', 'pincode', 'address', 'school', 'studentid', 'name']);

  const state = { bitmap: null, work: null, scale: 1, leaks: [], view: 'leaks', audience: 'public', meta: {}, cleanBlob: null };

  // ---------- language ----------
  function applyLang() {
    document.documentElement.lang = i18n.lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = i18n.t(el.dataset.i18n); });
    ['lang', 'lang2'].forEach(id => { $(id).value = i18n.lang; });
    if (!$('results').hidden) renderResults();
  }
  ['lang', 'lang2'].forEach(id => {
    const sel = $(id);
    Object.entries(i18n.langs).forEach(([k, v]) => sel.add(new Option(v, k)));
    sel.addEventListener('change', () => { i18n.lang = sel.value; applyLang(); });
  });

  // ---------- views ----------
  function show(view) {
    ['home', 'scanning', 'results'].forEach(v => { $(v).hidden = v !== view; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ---------- load photo ----------
  async function loadBitmap(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall back */ }
    }
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(blob);
    });
  }

  function makeCanvas(src, max) {
    const w = src.width, h = src.height;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  async function handleFile(file) {
    if (!file) return;
    let buffer, bitmap;
    try {
      buffer = await file.arrayBuffer();
      bitmap = await loadBitmap(file);
    } catch (e) { toast(i18n.t('errorRead')); return; }
    state.bitmap = bitmap;
    state.work = makeCanvas(bitmap, WORK_MAX);
    state.scale = state.work.width / bitmap.width;
    state.meta = exif.parseExif(buffer); // returns {} for photos without (or with damaged) hidden data
    state.leaks = []; state.cleanBlob = null; state.view = 'leaks';
    $('cleanNote').hidden = true;
    await scan();
  }

  // ---------- scan ----------
  function setStep(step, status) {
    const li = document.querySelector(`[data-step="${step}"]`);
    if (li) li.className = status;
  }

  async function scan() {
    show('scanning');
    const sc = $('scanCanvas');
    sc.width = state.work.width; sc.height = state.work.height;
    sc.getContext('2d').drawImage(state.work, 0, 0);
    document.querySelectorAll('.scan-steps li').forEach(li => { li.className = ''; });
    $('ocrProgress').value = 0;
    const leaks = [];

    // 1. Hidden data
    setStep('meta', 'active');
    if (state.meta.gps) leaks.push({ type: 'gps', detail: `${state.meta.gps.lat.toFixed(5)}, ${state.meta.gps.lon.toFixed(5)}`, gps: state.meta.gps });
    const metaBits = [state.meta.Make, state.meta.Model].filter(Boolean).join(' ');
    const when = state.meta.DateTimeOriginal || state.meta.DateTime;
    if (metaBits || when || state.meta.CameraOwnerName) {
      leaks.push({ type: 'meta', detail: [metaBits, when, state.meta.CameraOwnerName].filter(Boolean).join(' · ') });
    }
    setStep('meta', 'done');

    // 2. Faces
    setStep('faces', 'active');
    $('loadingAI').hidden = false;
    try {
      const faces = await vision.detectFaces(state.work);
      state.faces = faces;
      faces.forEach((f, i) => {
        if (i === 0) {
          if (f.area > 0.03 && f.frontal) leaks.push({ type: 'morph', bbox: f.bbox, faceIndex: i, noBlur: true });
          else if (faces.length > 1) leaks.push({ type: 'me', bbox: f.bbox, faceIndex: i, noBlur: true });
        } else {
          leaks.push({ type: 'face_other', bbox: f.bbox, faceIndex: i });
        }
      });
      setStep('faces', 'done');
    } catch (e) { console.warn('Face detection failed', e); setStep('faces', 'skip'); toast(i18n.t('modelFail')); }

    // 3. Text
    setStep('text', 'active');
    try {
      const lines = await ocr.readText(state.work, p => { $('ocrProgress').value = p; });
      pii.findPersonalText(lines, { imageHeight: state.work.height }).forEach(f => leaks.push({ type: f.type, bbox: f.bbox, detail: f.text, guess: f.guess }));
      setStep('text', 'done');
    } catch (e) { console.warn('OCR failed', e); setStep('text', 'skip'); toast(i18n.t('modelFail')); }
    $('loadingAI').hidden = true;

    // 4. School logo (only if the team loaded their model)
    if (vision.hasLogoModel()) {
      setStep('logo', 'active');
      try {
        (await vision.detectLogo(state.work)).forEach(r => leaks.push({ type: 'logo', bbox: r.bbox, detail: r.label }));
        setStep('logo', 'done');
      } catch (e) { console.warn('Logo model failed', e); setStep('logo', 'skip'); }
    } else setStep('logo', 'skip');

    leaks.forEach((l, i) => { l.id = i + 1; l.fixed = false; });
    state.leaks = leaks;
    state.audience = 'public';
    show('results');
    renderResults();
  }

  // ---------- results ----------
  function currentScore() {
    return score.privacyScore(state.leaks.map(l => ({ type: l.type, fixed: l.fixed || (l.type === 'morph' && state.audience === 'friends') })));
  }

  function drawView() {
    const c = $('viewCanvas');
    c.width = state.work.width; c.height = state.work.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(state.work, 0, 0);
    const clean = state.view === 'clean';
    state.leaks.forEach(l => { if (l.bbox && l.fixed && !l.noBlur) blurRegion(ctx, l.bbox); });
    if (clean) return;
    const lw = Math.max(2, c.width / 400);
    ctx.font = `bold ${Math.max(14, c.width / 45)}px system-ui, sans-serif`;
    state.leaks.forEach(l => {
      if (!l.bbox) return;
      const done = l.fixed || l.type === 'me' || (l.type === 'morph' && state.audience === 'friends');
      const color = l.type === 'me' ? '#19b3b1' : done ? '#22c55e' : (l.type === 'morph' ? '#f59e0b' : '#ef4444');
      const { x0, y0, x1, y1 } = l.bbox;
      ctx.lineWidth = lw; ctx.strokeStyle = color;
      ctx.setLineDash(l.type === 'morph' || l.type === 'me' ? [lw * 4, lw * 3] : []);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      const r = Math.max(12, c.width / 70);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x0, y0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(l.id), x0, y0 + 1);
    });
  }

  function renderScore() {
    const s = currentScore();
    let lvl = score.level(s);
    const open = state.leaks.some(l => !l.fixed && l.type !== 'me' && !(l.type === 'morph' && state.audience === 'friends'));
    if (lvl === 'safe' && open) lvl = 'careful';
    $('scoreNum').textContent = s;
    $('scoreLabel').textContent = i18n.t(lvl);
    $('gauge').className = 'gauge ' + lvl;
    const circ = 2 * Math.PI * 52;
    const bar = $('gaugeBar');
    bar.style.strokeDasharray = circ;
    bar.style.strokeDashoffset = circ * (1 - s / 100);
    $('audPublic').classList.toggle('active', state.audience === 'public');
    $('audFriends').classList.toggle('active', state.audience === 'friends');
  }

  function leakButtons(l) {
    if (l.type === 'gps' || l.type === 'meta') {
      return l.fixed ? `<span class="badge ok">✓ ${i18n.t('fixed')}</span>`
        : `<button class="btn small primary" data-act="fix" data-id="${l.id}">${i18n.t('remove')}</button>`;
    }
    if (l.type === 'me') {
      return `<button class="btn small ghost" data-act="notme" data-id="${l.id}">${i18n.t('notMe')}</button>`;
    }
    if (l.type === 'morph') {
      return `<div class="seg small"><button data-act="aud-friends" class="${state.audience === 'friends' ? 'active' : ''}">${i18n.t('no')}</button></div>`;
    }
    let html = l.fixed
      ? `<button class="btn small ghost" data-act="keep" data-id="${l.id}">${i18n.t('keep')}</button><span class="badge ok">✓ ${i18n.t('fixed')}</span>`
      : `<button class="btn small primary" data-act="fix" data-id="${l.id}">${i18n.t('blur')}</button><button class="btn small ghost" data-act="keep" data-id="${l.id}">${i18n.t('keep')}</button>`;
    if (l.type === 'face_other') html += `<button class="btn small ghost" data-act="me" data-id="${l.id}">${i18n.t('thisIsMe')}</button>`;
    return html;
  }

  function renderList() {
    const list = $('leakList');
    list.innerHTML = '';
    $('noLeaks').hidden = state.leaks.length > 0;
    state.leaks.forEach(l => {
      const [title, why] = i18n.leak(l.type);
      const done = l.fixed || l.type === 'me' || (l.type === 'morph' && state.audience === 'friends');
      const li = document.createElement('li');
      li.className = 'leak ' + (done ? 'done' : (l.type === 'morph' ? 'warn' : ''));
      let detail = '';
      if (l.type === 'gps') {
        detail = `<div class="detail">${l.detail} · <a href="https://www.openstreetmap.org/?mlat=${l.gps.lat}&mlon=${l.gps.lon}#map=16/${l.gps.lat}/${l.gps.lon}" target="_blank" rel="noopener">${i18n.t('map')} ↗</a></div>`;
      } else if (l.detail) {
        const span = document.createElement('span'); span.textContent = l.detail; // safe text
        detail = `<div class="detail">“${span.innerHTML}”</div>`;
      }
      li.innerHTML = `
        <div class="leak-head"><span class="num">${l.bbox ? l.id : ICONS[l.type] || '•'}</span>
          <div><div class="leak-title">${l.bbox ? (ICONS[l.type] || '') + ' ' : ''}${title}</div>${detail}<p class="why">${why}</p></div></div>
        <div class="leak-actions">${leakButtons(l)}</div>`;
      list.appendChild(li);
    });
  }

  function renderResults() {
    drawView(); renderScore(); renderList();
    $('tabLeaks').classList.toggle('active', state.view === 'leaks');
    $('tabClean').classList.toggle('active', state.view === 'clean');
    $('shareBtn').hidden = !(navigator.canShare && window.File);
  }

  $('leakList').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const l = state.leaks.find(x => x.id === Number(b.dataset.id));
    switch (b.dataset.act) {
      case 'fix': l.fixed = true; break;
      case 'keep': l.fixed = false; break;
      case 'me': state.leaks = state.leaks.filter(x => x !== l); break; // the user said this face is theirs
      case 'notme': l.type = 'face_other'; l.noBlur = false; l.fixed = true; break;
      case 'aud-friends': state.audience = state.audience === 'friends' ? 'public' : 'friends'; break;
      default: return;
    }
    state.cleanBlob = null; $('cleanNote').hidden = true;
    renderResults();
  });
  $('audPublic').onclick = () => { state.audience = 'public'; renderResults(); };
  $('audFriends').onclick = () => { state.audience = 'friends'; renderResults(); };
  $('tabLeaks').onclick = () => { state.view = 'leaks'; renderResults(); };
  $('tabClean').onclick = () => { state.view = 'clean'; renderResults(); };
  $('fixAllBtn').onclick = () => {
    state.leaks.forEach(l => { if (l.type !== 'morph') l.fixed = true; });
    state.audience = 'friends';
    state.view = 'clean';
    renderResults();
    toast('✓ ' + i18n.t('cleanReady'));
  };
  $('againBtn').onclick = () => { show('home'); };

  // ---------- clean copy ----------
  async function buildClean() {
    if (state.cleanBlob) return state.cleanBlob;
    const out = makeCanvas(state.bitmap, EXPORT_MAX);
    const ctx = out.getContext('2d');
    const k = out.width / state.work.width;
    state.leaks.forEach(l => {
      if (l.bbox && l.fixed && !l.noBlur && REGION_TYPES.has(l.type)) {
        blurRegion(ctx, { x0: l.bbox.x0 * k, y0: l.bbox.y0 * k, x1: l.bbox.x1 * k, y1: l.bbox.y1 * k });
      }
    });
    // Re-drawing on a canvas creates a brand-new file: all hidden data (GPS, phone model, time) is gone.
    state.cleanBlob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.92));
    $('cleanNote').hidden = false;
    return state.cleanBlob;
  }

  $('downloadBtn').onclick = async () => {
    const blob = await buildClean();
    if (state.cleanUrl) URL.revokeObjectURL(state.cleanUrl); // free the previous copy
    const url = URL.createObjectURL(blob);
    state.cleanUrl = url;
    try {
      const a = document.createElement('a');
      a.href = url; a.download = 'leaklens-clean.jpg';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* downloads blocked here – the preview below still lets you save */ }
    // Always show the clean photo too, so it can be saved by long-press / right-click anywhere.
    $('cleanImg').src = url;
    try { $('cleanDlg').showModal(); } catch (e) { $('cleanDlg').setAttribute('open', ''); }
  };
  $('shareBtn').onclick = async () => {
    const blob = await buildClean();
    const file = new File([blob], 'leaklens-clean.jpg', { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'LeakLens' }); } catch (e) { /* user cancelled */ }
    } else $('downloadBtn').click();
  };

  // ---------- inputs ----------
  $('fileInput').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
  $('cameraInput').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
  $('sampleBtn').onclick = async () => {
    const res = await fetch(window.LL.SAMPLE_PHOTO); // demo photo from js/sample.js
    handleFile(await res.blob());
  };
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  window.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item && !$('home').hidden) handleFile(item.getAsFile());
  });

  // ---------- settings ----------
  $('settingsBtn').onclick = () => { updateLogoStatus(); $('settings').showModal(); };
  function updateLogoStatus() {
    $('logoStatus').textContent = vision.hasLogoModel() ? '✓ ' + i18n.t('logoLoaded') : i18n.t('logoNone');
    $('logoClear').hidden = !vision.hasLogoModel();
  }
  $('logoFiles').addEventListener('change', async e => {
    try { await vision.loadLogoFromFiles(e.target.files); toast('✓ ' + i18n.t('logoLoaded')); }
    catch (err) { toast(err.message); }
    updateLogoStatus(); e.target.value = '';
  });
  $('logoClear').onclick = async () => { await vision.clearLogoModel(); updateLogoStatus(); };

  // ---------- install as app ----------
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; $('installBtn').hidden = false; });
  $('installBtn').onclick = async () => { if (installEvent) { installEvent.prompt(); installEvent = null; $('installBtn').hidden = true; } };
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* not available here */ }); });
  }

  // ---------- start ----------
  applyLang();
  vision.restoreLogoModel().then(updateLogoStatus).catch(() => {});
  // Warm up the AI models in the background so the first scan is faster.
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
  idle(() => { vision.loadFaceModels().catch(() => {}); ocr.warmUp().catch(() => {}); });
})();
