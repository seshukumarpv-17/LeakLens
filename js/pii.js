/* LeakLens – personal-text detector.
   Takes the text lines that OCR read from the photo and finds the ones that give away
   personal details (phone numbers, house numbers, vehicle plates, names, school, IDs …).
   Uses pattern rules tuned for Indian formats. Runs on the device. */
(function (root) {
  'use strict';

  // Each rule: id (also used for translations), regex, and an optional filter.
  const RULES = [
    { id: 'aadhaar', re: /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g },
    { id: 'phone', re: /(?:\+?91[\s-]?)?\b[6-9](?:\d{9}|\d{4}[\s-]\d{5}|\d{2}[\s-]\d{3}[\s-]\d{4})\b/g },
    { id: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/gi },
    { id: 'handle', re: /(?:^|\s)@[A-Za-z0-9_.]{3,30}\b/g },
    { id: 'plate', re: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{3,4}\b/g },
    { id: 'house', re: /\b(?:h\.?\s?no|house\s?no|door\s?no|flat\s?no|plot\s?no|d\.?\s?no)\.?\s*[:#-]?\s*[\w/-]+/gi },
    { id: 'house', re: /\b\d{1,2}-\d{1,3}-\d{1,4}(?:\/[\w-]+)?\b/g },          // Indian door no. e.g. 8-2-293/82
    { id: 'house', re: /#\s?\d{1,4}[A-Za-z]?\b/g },
    { id: 'pincode', re: /\b[1-9]\d{2}\s?\d{3}\b/g, filter: m => m.replace(/\s/g, '').length === 6 },
    { id: 'address', re: /\b[\w.]+\s+(?:road|rd|street|nagar|colony|lane|layout|apartments?|apts|enclave|towers?|residency|sector|phase|marg|gali|chowk|bagh|pally|peta|pet|guda|halli)\b/gi },
    { id: 'school', re: /\b(?:[\w.]+\s+){0,4}(?:school|vidyalaya|vidyalayam|academy|convent|college|kendriya|gurukul|cbse|icse)\b/gi },
    { id: 'studentid', re: /\b(?:roll|admission|adm|enrol(?:l)?ment|student\s?id|reg(?:istration)?)\s*\.?\s*(?:no|number|#)?\s*[:.-]?\s*[\w/-]*\d[\w/-]*/gi },
    { id: 'name', re: /\bname\s*[:\-]\s*[A-Za-z][A-Za-z .]{1,40}/gi },
  ];

  // A line that is only a short number (e.g. "112" on a gate) is probably a house/door number.
  const LONE_NUMBER = /^\s*(?:no\.?\s*)?\d{1,4}[A-Za-z]?(?:\/\d{1,4})?[\])|.,:]*\s*$/i;

  function unionBox(boxes) {
    if (!boxes.length) return null;
    return {
      x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)),
      x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)),
    };
  }

  /** Find personal details in OCR lines.
   *  lines: [{ words: [{ text, bbox:{x0,y0,x1,y1}, confidence }] }]
   *  returns [{ type, text, bbox }] */
  function findPersonalText(lines, opts = {}) {
    const minNumberHeight = Math.max(14, (opts.imageHeight || 0) * 0.025);
    const findings = [];
    const taken = []; // [lineIndex, start, end] spans already claimed, so one text isn't counted twice

    lines.forEach((line, li) => {
      const words = (line.words || []).filter(w => w.text && w.text.trim() && (w.confidence === undefined || w.confidence > 35));
      if (!words.length) return;
      // Rebuild the line text and remember where each word sits.
      let text = '';
      const spans = words.map(w => {
        if (text) text += ' ';
        const start = text.length;
        text += w.text.trim();
        return { start, end: text.length, bbox: w.bbox };
      });

      const overlapsTaken = (s, e) => taken.some(t => t[0] === li && s < t[2] && e > t[1]);

      RULES.forEach(rule => {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(text)) !== null) {
          let s = m.index, e = m.index + m[0].length;
          const raw = m[0];
          const trimmed = raw.trimStart();
          s += raw.length - trimmed.length;
          if (rule.filter && !rule.filter(trimmed)) continue;
          if (overlapsTaken(s, e)) continue;
          const boxes = spans.filter(sp => sp.start < e && sp.end > s).map(sp => sp.bbox);
          const bbox = unionBox(boxes);
          if (!bbox) continue;
          taken.push([li, s, e]);
          findings.push({ type: rule.id, text: trimmed.trim(), bbox });
        }
      });

      const sure = words.every(w => w.confidence === undefined || w.confidence >= 70);
      const digits = (text.match(/\d/g) || []).length;
      if (LONE_NUMBER.test(text) && digits >= 2 && sure && !overlapsTaken(0, text.length)) {
        const bbox = unionBox(spans.map(sp => sp.bbox));
        // Only count it if the number is big in the photo (painted on a gate or wall), not random specks.
        if (bbox && (bbox.y1 - bbox.y0) >= minNumberHeight) {
          taken.push([li, 0, text.length]);
          findings.push({ type: 'house', text: text.trim(), bbox, guess: true });
        }
      }
    });
    return dedupe(findings);
  }

  /** The photo is read twice, so the same detail can be found twice. Keep one of each. */
  function dedupe(findings) {
    const area = b => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
    const overlap = (a, b) => {
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (w <= 0 || h <= 0) return 0;
      return (w * h) / Math.min(area(a), area(b));
    };
    const out = [];
    findings.forEach(f => {
      if (!out.some(o => overlap(o.bbox, f.bbox) > 0.5 && (o.type === f.type || f.guess))) out.push(f);
    });
    return out;
  }

  const api = { findPersonalText, dedupe, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LL = root.LL || {};
  root.LL.pii = api;
})(typeof window !== 'undefined' ? window : globalThis);
