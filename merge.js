/* Fusión de estado compartida por cliente y servidor. Conmutativa e idempotente:
   el orden de sincronización no importa y nunca se pierde progreso. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.IEMerge = f(); })(this, function () {
  const obj = o => (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  const num = n => Number.isFinite(n) ? n : 0;
  const examId = e => e.id || [e.d, e.p, e.lv].join('|');

  function merge(a, b) {
    a = obj(a); b = obj(b);
    const out = {};
    // srs: gana la entrada más reciente (t)
    out.srs = {};
    for (const id of new Set([...Object.keys(obj(a.srs)), ...Object.keys(obj(b.srs))])) {
      const x = obj(a.srs)[id], y = obj(b.srs)[id];
      out.srs[id] = !x ? y : !y ? x : (num(y.t) > num(x.t) ? y : x);
    }
    // gram / convo: mejor puntaje
    for (const k of ['gram', 'convo']) {
      out[k] = {};
      for (const id of new Set([...Object.keys(obj(a[k])), ...Object.keys(obj(b[k]))]))
        out[k][id] = Math.max(num(obj(a[k])[id]), num(obj(b[k])[id]));
    }
    out.devLevel = Math.max(num(a.devLevel) || 1, num(b.devLevel) || 1);
    // exámenes: unión por id
    const ex = new Map();
    for (const e of [...(a.exams || []), ...(b.exams || [])]) if (e && typeof e === 'object') ex.set(examId(e), { ...e, id: examId(e) });
    out.exams = [...ex.values()].sort((x, y) => (x.d + x.id).localeCompare(y.d + y.id)).slice(-200);
    // audios: unión por id; tombstone `del`; posición máxima; notas más recientes
    const pods = new Map();
    for (const p of [...(a.pods || []), ...(b.pods || [])]) {
      if (!p || !p.id) continue;
      const q = pods.get(p.id);
      if (!q) { pods.set(p.id, { ...p }); continue; }
      const notes = num(p.nt) > num(q.nt) ? p : q;
      pods.set(p.id, { ...q, del: !!(q.del || p.del), pos: Math.max(num(q.pos), num(p.pos)), notes: notes.notes, nt: Math.max(num(q.nt), num(p.nt)) });
    }
    out.pods = [...pods.values()];
    // estadísticas: máximo por día
    out.stats = { days: {} };
    for (const d of new Set([...Object.keys(obj(obj(a.stats).days)), ...Object.keys(obj(obj(b.stats).days))]))
      out.stats.days[d] = Math.max(num(obj(obj(a.stats).days)[d]), num(obj(obj(b.stats).days)[d]));
    // ajustes: último en escribir
    const s = num(b.settingsAt) > num(a.settingsAt) ? b : a;
    out.rate = num(s.rate) || 0.9; out.unlockAll = !!s.unlockAll; out.settingsAt = num(s.settingsAt);
    return out;
  }
  return { merge };
});
