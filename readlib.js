/* Lógica pura de lectura: segmentación, alineación de lo leído, preguntas por voz y gramática local.
   Sin red ni IA: se usa tanto en el navegador como en las pruebas. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.IERead = f(); })(this, function () {
  const NUMS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const ABBR = /^(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|a\.m|p\.m|no|fig|approx|inc|ltd|co)\.$/i;

  /* ---------- texto ---------- */
  function cleanOcr(raw) {
    let t = String(raw || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/­/g, '');
    t = t.replace(/(\w)-\n(?=[a-z])/g, '$1');                       // palabras partidas con guion
    t = t.split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()).filter(Boolean).join('\n\n');
    t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/(^|\s)\|(\s|$)/g, '$1I$2').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    return t.trim();
  }
  function wordKeys(w) {
    const s = String(w).toLowerCase().replace(/[‘’`´]/g, "'");
    return s.split(/[-–—\/]+/).map(p => p.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').replace(/'/g, '')).filter(Boolean)
      .map(k => /^\d$|^10$/.test(k) ? NUMS[+k] : k);
  }
  function tokenize(text) {
    const words = [], re = /\S+/g; let m;
    while ((m = re.exec(text))) words.push({ t: m[0], s: m.index, e: m.index + m[0].length, k: wordKeys(m[0]) });
    const sentences = []; let a = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i], nx = words[i + 1];
      let end = i === words.length - 1;
      if (!end) {
        const gap = text.slice(w.e, nx.s);
        if (/\n/.test(gap)) end = true;
        else if (/[.!?…]["')\]]*$/.test(w.t) && !ABBR.test(w.t) && /^["'(\[]*[A-Z0-9]/.test(nx.t)) end = true;
        else if (i - a >= 44) end = true;                                       // tope para frases larguísimas
        else if (i - a >= 26 && /[,;:]$/.test(w.t)) end = true;
      }
      if (end) { sentences.push([a, i]); a = i + 1; }
    }
    return { words, sentences };
  }
  const sentenceOf = (sentences, wi) => { for (let k = 0; k < sentences.length; k++) if (wi <= sentences[k][1]) return k; return sentences.length - 1; };

  /* ---------- pronunciación: alinear lo leído con el texto ---------- */
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  const sim = (a, b) => a === b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length);
  function heardKeys(s) { return String(s || '').split(/\s+/).flatMap(wordKeys); }
  function alignWords(expected, heard) {              // expected: [{k, wi}], heard: [key]
    const n = expected.length, m = heard.length;
    const cost = (i, j) => { const s = sim(expected[i].k, heard[j]); return s === 1 ? 0 : s >= 0.6 ? 0.45 : 1; };
    const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) D[i][0] = i; for (let j = 1; j <= m; j++) D[0][j] = j;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + cost(i - 1, j - 1));
    const out = new Array(n); let i = n, j = m;
    while (i > 0) {
      if (j > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + cost(i - 1, j - 1))) < 1e-9) { const c = cost(i - 1, j - 1); out[i - 1] = { status: c === 0 ? 'ok' : c < 1 ? 'close' : 'wrong', heard: heard[j - 1] }; i--; j--; }
      else if (j > 0 && Math.abs(D[i][j] - (D[i][j - 1] + 1)) < 1e-9) j--;
      else { out[i - 1] = { status: 'miss', heard: '' }; i--; }
    }
    return out;
  }
  const RANK = { ok: 0, close: 1, wrong: 2, miss: 3 };
  function scoreReading(words, from, to, heardText) {
    const exp = []; for (let wi = from; wi <= to; wi++) words[wi].k.forEach(k => exp.push({ k, wi }));
    const res = alignWords(exp, heardKeys(heardText));
    const per = {}; exp.forEach((e, idx) => { const r = res[idx], p = per[e.wi]; if (!p || RANK[r.status] > RANK[p.status]) per[e.wi] = { status: r.status, heard: r.heard || (p && p.heard) || '' }; });
    const list = []; let pts = 0, n = 0;
    for (let wi = from; wi <= to; wi++) { const p = per[wi] || { status: 'ok', heard: '' }; if (!words[wi].k.length) continue; n++; pts += p.status === 'ok' ? 1 : p.status === 'close' ? 0.6 : 0; list.push({ wi, ...p }); }
    return { list, accuracy: n ? Math.round(pts / n * 100) : 0 };
  }

  /* ---------- diccionario: variantes de una palabra ---------- */
  function lemmaCandidates(word) {
    const w = String(word).toLowerCase().replace(/[‘’`´]/g, "'").replace(/^[^a-z]+|[^a-z']+$/g, '').replace(/'s$/, ''), c = [w];
    const add = x => { if (x.length > 2 && !c.includes(x)) c.push(x); };
    if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/(ches|shes|sses|xes|zes|oes)$/.test(w)) add(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w)) add(w.slice(0, -1));
    if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
    if (/ed$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (/(.)\1ed$/.test(w)) add(w.slice(0, -3)); }
    if (/ing$/.test(w)) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); if (/(.)\1ing$/.test(w)) add(w.slice(0, -4)); }
    if (/ly$/.test(w)) add(w.slice(0, -2));
    if (/er$|est$/.test(w)) add(w.replace(/(er|est)$/, ''));
    return c;
  }

  /* ---------- preguntas y órdenes por voz ---------- */
  const strip = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const HERE = /\b(this word|the current word|that word|esta palabra|la palabra actual|esa palabra|la palabra)\b/;
  function parseQuery(text, lang) {
    const t = strip(text); if (!t) return { intent: 'unknown' };
    if (/^(continue|resume|go on|keep reading|keep going|sigue|sigamos|continua|continuar|seguir|sigue leyendo|continue reading)$/.test(t)) return { intent: 'continue' };
    if (/^(repeat|again|say that again|repeat that|repite|repetir|otra vez|repite eso|repeat the sentence)$/.test(t)) return { intent: 'repeat' };
    if (/^(slower|slow down|more slowly|mas lento|mas despacio|despacio|habla mas lento)$/.test(t)) return { intent: 'slower' };
    if (/^(faster|speed up|mas rapido|mas rapida|habla mas rapido)$/.test(t)) return { intent: 'faster' };
    if (/^(pause|stop|wait|pausa|para|detente|espera)$/.test(t)) return { intent: 'pause' };
    const clean = w => w.replace(/^(the word|la palabra|the phrase|la frase|la expresion|the expression)\s+/, '').replace(/\s+(mean|means|en espanol|en ingles|in english|in spanish)$/, '').trim();
    const pick = (w, intent, l) => { w = clean(w); if (!w) return { intent: 'unknown' }; return { intent: HERE.test(w) && w.split(' ').length <= 4 ? intent : intent, word: HERE.test(w) && w.split(' ').length <= 4 ? '@current' : w, lang: l }; };
    let m;
    if ((m = t.match(/^(?:que|cual) (?:significa|quiere decir|es el significado de|es la traduccion de)\s+(.+)$/))) return pick(m[1], 'define', 'es');
    if ((m = t.match(/^(?:significado|traduccion|definicion) de\s+(.+)$/))) return pick(m[1], 'define', 'es');
    if ((m = t.match(/^(?:traduce|traducir|traduceme|define|definir)\s+(.+)$/))) return pick(m[1], 'define', 'es');
    if ((m = t.match(/^como se pronuncia\s+(.+)$/))) return pick(m[1], 'pronounce', 'es');
    if ((m = t.match(/^como se dice\s+(.+)$/))) return pick(m[1], 'toEnglish', 'es');
    if ((m = t.match(/^what does\s+(.+?)\s+mean$/))) return pick(m[1], 'define', 'en');
    if ((m = t.match(/^(?:what is the meaning of|what s the meaning of|meaning of|what is the definition of|define|definition of|translate)\s+(.+)$/))) return pick(m[1], 'define', 'en');
    if ((m = t.match(/^how (?:do you|do i|to) pronounce\s+(.+)$/))) return pick(m[1], 'pronounce', 'en');
    if ((m = t.match(/^how do you say\s+(.+?)(?:\s+in (english|spanish))?$/))) return pick(m[1], m[2] === 'english' ? 'toEnglish' : 'define', m[2] === 'english' ? 'es' : 'en');
    if ((m = t.match(/^what is\s+(.+)$/)) && m[1].split(' ').length <= 3) return pick(m[1], 'define', 'en');
    if (HERE.test(t) && t.split(' ').length <= 6) return { intent: 'define', word: '@current', lang: lang || 'es' };
    if (t.split(' ').length <= 2) return { intent: 'define', word: t, lang: lang || 'en' };
    return { intent: 'unknown', heard: t };
  }

  /* ---------- gramática local (errores típicos de hispanohablantes) ---------- */
  const A_EXC = /^(uni|use|usu|uti|eur|one|once|ubi|uk|us\b)/i, AN_EXC = /^(hour|honest|honor|honour|heir)/i;
  const RULES = [
    { id: 'AM_AGREE', re: /\bI am agree\b/gi, fix: () => 'I agree', msg: '"agree" ya es un verbo: se dice "I agree", sin "am".' },
    { id: 'DONT_3P', re: /\b(he|she|it) (don't|do not)\b/gi, fix: m => m[1] + (/n't/i.test(m[2]) ? " doesn't" : ' does not'), msg: 'Con he/she/it se usa "doesn\'t" (o "does not").' },
    { id: 'HAVE_3P', re: /\b(he|she|it) have\b(?! to\b)/gi, fix: m => m[1] + ' has', msg: 'Con he/she/it el verbo es "has".' },
    { id: 'BE_AGREE_1', re: /\bI (is|are)\b/g, fix: () => 'I am', msg: 'Con "I" se usa "am".' },
    { id: 'BE_AGREE_3', re: /\b(he|she|it) are\b/gi, fix: m => m[1] + ' is', msg: 'Con he/she/it se usa "is".' },
    { id: 'BE_AGREE_PL', re: /\b(you|we|they) is\b/gi, fix: m => m[1] + ' are', msg: 'Con you/we/they se usa "are".' },
    { id: 'PLURAL_BE', re: /\b(people|children|men|women|police) (is|was)\b/gi, fix: m => m[1] + (/was/i.test(m[2]) ? ' were' : ' are'), msg: '"' + 'people/children/men/women' + '" son plurales: usa "are/were".' },
    { id: 'MORE_ER', re: /\bmore (better|bigger|easier|faster|cheaper|smaller|worse|older|younger|taller|harder|happier)\b/gi, fix: m => m[1], msg: 'Comparativo doble: "better" ya significa "more good"; no agregues "more".' },
    { id: 'DEPEND_OF', re: /\bdepends? of\b/gi, fix: m => m[0].replace(/of$/i, 'on'), msg: 'Se dice "depend on", no "depend of".' },
    { id: 'YEARS_OLD', re: /\bI have (\d+) years( old)?\b/gi, fix: m => 'I am ' + m[1] + ' years old', msg: 'La edad se dice con "to be": "I am 25 years old", no "I have".' },
    { id: 'SINCE_FOR', re: /\bsince (\d+|a|one|two|three|four|five|six|several) (years?|months?|weeks?|days?|hours?|minutes?)\b/gi, fix: m => 'for ' + m[1] + ' ' + m[2], msg: 'Para una duración (3 years) se usa "for"; "since" va con un momento (2020, Monday).' },
    { id: 'DID_PAST', re: /\b(did|didn't|do|does|don't|doesn't|did not|do not|does not) (went|saw|ate|took|came|gave|made|had|got|said|knew|thought)\b/gi, fix: m => m[1] + ' ' + ({ went: 'go', saw: 'see', ate: 'eat', took: 'take', came: 'come', gave: 'give', made: 'make', had: 'have', got: 'get', said: 'say', knew: 'know', thought: 'think' })[m[2].toLowerCase()], msg: 'Después de did/do/does el verbo va en infinitivo: "did go", no "did went".' },
    { id: 'S_3P', re: /\b(he|she) (go|do|make|take|come|want|need|like|live|work|get|know|think|say|see|play|study|eat|speak|read|write|love|use)\b/gi, fix: m => m[1] + ' ' + (/(s|sh|ch|x|o)$/.test(m[2]) ? m[2] + 'es' : m[2] + 's'), msg: 'Con he/she en presente, el verbo lleva -s: "he works".' },
    { id: 'VERY_LIKE', re: /\b(I|we|they|you) very (like|love|want|need|enjoy)\b/gi, fix: m => m[1] + ' ' + m[2] + ' ... very much', msg: 'No se dice "I very like": usa "I like it very much" o "I really like".' },
    { id: 'SUPPOSE_TO', re: /\bsuppose to\b/gi, fix: () => 'supposed to', msg: 'Se escribe "supposed to".' },
    { id: 'UNCOUNT', re: /\b(informations|advices|furnitures|equipments|knowledges|homeworks|peoples|childrens)\b/gi, fix: m => ({ informations: 'information', advices: 'advice', furnitures: 'furniture', equipments: 'equipment', knowledges: 'knowledge', homeworks: 'homework', peoples: 'people', childrens: 'children' })[m[1].toLowerCase()], msg: 'Esta palabra no se usa en plural así en inglés.' },
    { id: 'GO_TO_HOME', re: /\b(go|went|going|goes) to home\b/gi, fix: m => m[1] + ' home', msg: '"home" no lleva "to": "go home".' },
    { id: 'DOUBLE', re: /\b(\w+) \1\b/gi, fix: m => m[1], msg: 'Palabra repetida.', skip: m => /^(had|that|very|really|so|no|bye)$/i.test(m[1]) },
    { id: 'A_AN', re: /\ba ([aeiou]\w*)/gi, fix: m => 'an ' + m[1], msg: 'Antes de un sonido de vocal se usa "an".', skip: m => A_EXC.test(m[1]) },
    { id: 'AN_A', re: /\ban ([bcdfghjklmnpqrstvwxyz]\w*)/gi, fix: m => 'a ' + m[1], msg: 'Antes de un sonido de consonante se usa "a".', skip: m => AN_EXC.test(m[1]) },
  ];
  function localGrammar(text) {
    const issues = [];
    for (const r of RULES) { r.re.lastIndex = 0; let m; while ((m = r.re.exec(text))) { if (r.skip && r.skip(m)) continue; const rep = r.fix(m); if (rep !== m[0]) issues.push({ rule: r.id, offset: m.index, length: m[0].length, message: r.msg, replacement: rep, source: 'local' }); if (m[0].length === 0) r.re.lastIndex++; } }
    return issues.sort((a, b) => a.offset - b.offset);
  }
  function applyFixes(text, issues) {
    let out = text, shift = 0, last = -1;
    for (const i of [...issues].sort((a, b) => a.offset - b.offset)) { if (i.offset < last || !i.replacement) continue; out = out.slice(0, i.offset + shift) + i.replacement + out.slice(i.offset + i.length + shift); shift += i.replacement.length - i.length; last = i.offset + i.length; }
    return out;
  }
  /* El reconocimiento no pone mayúsculas ni puntos: normaliza cada frase reconocida. */
  const sentenceCase = s => { s = String(s || '').trim(); if (!s) return ''; s = s.replace(/\bi\b/g, 'I'); s = s[0].toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + '.'; };

  return { cleanOcr, tokenize, sentenceOf, wordKeys, alignWords, scoreReading, lemmaCandidates, parseQuery, localGrammar, applyFixes, sentenceCase, lev };
});
