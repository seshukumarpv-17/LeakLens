/* LeakLens – strong blur for leak areas.
   Uses the browser's real blur filter when available (Chrome, Edge, Firefox, Android, new Safari),
   otherwise a heavy "shrink and stretch" blur that works everywhere (older iPhones). */
(function (root) {
  'use strict';
  const filterSupported = (() => {
    try { const c = document.createElement('canvas').getContext('2d'); c.filter = 'blur(2px)'; return c.filter === 'blur(2px)'; }
    catch (e) { return false; }
  })();

  function blurRegion(ctx, box) {
    // Grow the area a little so the edges of letters/faces are covered too.
    const padX = (box.x1 - box.x0) * 0.08, padY = (box.y1 - box.y0) * 0.15;
    const x = Math.max(0, Math.floor(box.x0 - padX)), y = Math.max(0, Math.floor(box.y0 - padY));
    const w = Math.min(ctx.canvas.width - x, Math.ceil(box.x1 - box.x0 + 2 * padX));
    const h = Math.min(ctx.canvas.height - y, Math.ceil(box.y1 - box.y0 + 2 * padY));
    if (w < 2 || h < 2) return;
    const radius = Math.max(8, Math.min(w, h) / 3);

    // Copy the area plus a margin, so the blur doesn't fade to transparent at the edges.
    const m = Math.ceil(radius * 2);
    const sx = Math.max(0, x - m), sy = Math.max(0, y - m);
    const sw = Math.min(ctx.canvas.width - sx, w + 2 * m), sh = Math.min(ctx.canvas.height - sy, h + 2 * m);
    const tmp = document.createElement('canvas');
    tmp.width = sw; tmp.height = sh;
    const t = tmp.getContext('2d');

    if (filterSupported) {
      t.filter = `blur(${radius}px)`;
      t.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      t.drawImage(tmp, 0, 0); // second pass = stronger
    } else {
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(sw / radius));
      small.height = Math.max(1, Math.round(sh / radius));
      const s = small.getContext('2d');
      s.imageSmoothingEnabled = true; s.imageSmoothingQuality = 'high';
      s.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, small.width, small.height);
      t.imageSmoothingEnabled = true; t.imageSmoothingQuality = 'high';
      t.drawImage(small, 0, 0, sw, sh);
    }

    ctx.save();
    ctx.beginPath();
    const r = Math.min(w, h) * 0.12;
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(tmp, sx, sy);
    ctx.restore();
  }
  root.LL = root.LL || {};
  root.LL.blurRegion = blurRegion;
})(window);
