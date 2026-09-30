/* Evalúa una respuesta hablada/escrita contra una respuesta modelo. Determinista, sin IA ni red.
   spec = { say: "modelo", alts: ["otra válida"], keys: [["palabra","sinónimo"], ...] }
   keys = ideas que deben aparecer (cada una con variantes aceptadas). */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.IEJudge = f(); })(this, function () {
  const CONTR = [[/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/\bshan't\b/g, 'shall not'], [/n't\b/g, ' not'],
    [/\bi'm\b/g, 'i am'], [/\b(you|we|they)'re\b/g, '$1 are'], [/\b(he|she|it|that|there|what|who|here|where)'s\b/g, '$1 is'], [/\blet's\b/g, 'let us'],
    [/\b(i|you|we|they|he|she|it)'ve\b/g, '$1 have'], [/\b(i|you|we|they|he|she|it)'ll\b/g, '$1 will'], [/\b(i|you|we|they|he|she|it)'d\b/g, '$1 would'], [/\bgonna\b/g, 'going to'], [/\bwanna\b/g, 'want to'], [/\bgotta\b/g, 'have to']];
  const NUMS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  function norm(s) {
    s = String(s || '').toLowerCase().replace(/[‘’`´]/g, "'");
    for (const [re, to] of CONTR) s = s.replace(re, to);
    s = s.replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '');
    return s.split(/\s+/).filter(Boolean).map(w => (w in NUMS ? String(NUMS[w]) : w)).join(' ');
  }
  const stem = w => w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w;
  function f1(a, b) {
    const A = a.split(' ').filter(Boolean).map(stem), B = b.split(' ').filter(Boolean).map(stem);
    if (!A.length || !B.length) return 0;
    const cnt = new Map(); B.forEach(w => cnt.set(w, (cnt.get(w) || 0) + 1));
    let hit = 0; A.forEach(w => { if (cnt.get(w) > 0) { hit++; cnt.set(w, cnt.get(w) - 1); } });
    if (!hit) return 0;
    const p = hit / A.length, r = hit / B.length; return 2 * p * r / (p + r);
  }
  function judge(said, spec) {
    const n = norm(said), cands = [spec.say, ...(spec.alts || [])].map(norm);
    if (n.split(' ').filter(Boolean).length < 1) return { score: 0, verdict: 'no', hit: [], miss: (spec.keys || []).map(k => k[0]), best: spec.say };
    let bi = 0, bs = -1; cands.forEach((c, i) => { const s = f1(n, c); if (s > bs) { bs = s; bi = i; } });
    const keys = spec.keys || [], pad = ' ' + n + ' ';
    const hit = [], miss = [];
    keys.forEach(k => (k.some(v => { const nv = norm(v); return nv && (pad.includes(' ' + nv + ' ') || pad.includes(' ' + stem(nv))); }) ? hit : miss).push(k[0]));
    const score = keys.length ? 0.6 * (hit.length / keys.length) + 0.4 * bs : bs;
    const verdict = score >= 0.7 ? 'ok' : score >= 0.45 ? 'close' : 'no';
    return { score: Math.round(score * 100) / 100, verdict, hit, miss, best: [spec.say, ...(spec.alts || [])][bi] };
  }
  return { judge, norm, f1 };
});
