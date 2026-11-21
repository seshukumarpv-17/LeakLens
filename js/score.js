/* LeakLens – privacy score (0 = very risky, 100 = safe to post). */
(function (root) {
  'use strict';

  // How many points each kind of leak takes away. Higher = more dangerous.
  const WEIGHTS = {
    gps: 30, aadhaar: 30, phone: 25, house: 20, address: 20,
    plate: 15, school: 15, logo: 15, studentid: 15, name: 15, email: 15,
    face_other: 15, morph: 10, me: 0, handle: 10, pincode: 10, meta: 5,
  };

  /** leaks: [{ type, fixed }] – fixed leaks (blurred / removed) don't count. */
  function privacyScore(leaks) {
    const seen = {};
    let penalty = 0;
    leaks.filter(l => !l.fixed).forEach(l => {
      const w = l.type in WEIGHTS ? WEIGHTS[l.type] : 10;
      seen[l.type] = (seen[l.type] || 0) + 1;
      penalty += seen[l.type] === 1 ? w : Math.round(w / 2); // repeats count half
    });
    return Math.max(0, 100 - penalty);
  }

  function level(score) {
    if (score >= 80) return 'safe';
    if (score >= 50) return 'careful';
    return 'risky';
  }

  const api = { privacyScore, level, WEIGHTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LL = root.LL || {};
  root.LL.score = api;
})(typeof window !== 'undefined' ? window : globalThis);
