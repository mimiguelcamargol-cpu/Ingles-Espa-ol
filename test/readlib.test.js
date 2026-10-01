const test = require('node:test');
const assert = require('node:assert');
const R = require('../readlib.js');

test('cleanOcr une líneas, repara guiones y conserva párrafos', () => {
  const t = R.cleanOcr('The neigh-\nbour is very\nkind.  She lives\nnext door .\n\nSecond paragraph\nhere.');
  assert.equal(t, 'The neighbour is very kind. She lives next door.\n\nSecond paragraph here.');
});
test('tokenize: frases, abreviaturas y párrafos', () => {
  const { words, sentences } = R.tokenize('Dr. Smith lives here. He is kind! Is he rich?\n\nNew paragraph starts. Done');
  const txt = sentences.map(([a, b]) => words.slice(a, b + 1).map(w => w.t).join(' '));
  assert.deepEqual(txt, ['Dr. Smith lives here.', 'He is kind!', 'Is he rich?', 'New paragraph starts.', 'Done']);
  assert.deepEqual("I'm well-known, 5".split(' ').flatMap(R.wordKeys), ['im', 'well', 'known', 'five']);
});
test('tokenize: frases larguísimas se parten', () => {
  const long = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ') + '.';
  const { sentences } = R.tokenize(long); assert.ok(sentences.length >= 2 && sentences.every(([a, b]) => b - a < 46));
});
test('scoreReading: ok, cercana, equivocada y omitida', () => {
  const { words } = R.tokenize('The sheep is on the green hill');
  const r = R.scoreReading(words, 0, words.length - 1, 'the ship is the grin hill');
  const st = Object.fromEntries(r.list.map(x => [words[x.wi].t, x.status]));
  assert.equal(st.The, 'ok'); assert.equal(st.sheep, 'close'); assert.equal(st.on, 'miss'); assert.equal(st.green, 'close'); assert.equal(st.hill, 'ok');
  assert.ok(r.accuracy > 40 && r.accuracy < 80);
  const perfect = R.scoreReading(words, 0, words.length - 1, 'The sheep is on the green hill'); assert.equal(perfect.accuracy, 100);
  assert.equal(R.scoreReading(words, 0, words.length - 1, '').accuracy, 0);
});
test('scoreReading: contracciones y palabras con guion', () => {
  const { words } = R.tokenize("I'm a well-known teacher.");
  assert.equal(R.scoreReading(words, 0, words.length - 1, 'im a well known teacher').accuracy, 100);
});
test('lemmaCandidates', () => {
  assert.ok(R.lemmaCandidates('neighbours').includes('neighbour'));
  assert.ok(R.lemmaCandidates('studies').includes('study'));
  assert.ok(R.lemmaCandidates('stopped').includes('stop'));
  assert.ok(R.lemmaCandidates('making').includes('make'));
  assert.equal(R.lemmaCandidates('"Hello,"')[0], 'hello');
});
test('parseQuery: preguntas en español e inglés y órdenes', () => {
  const q = (t, l) => R.parseQuery(t, l);
  assert.deepEqual(q('¿Qué significa neighbour?'), { intent: 'define', word: 'neighbour', lang: 'es' });
  assert.deepEqual(q('what does neighbour mean'), { intent: 'define', word: 'neighbour', lang: 'en' });
  assert.deepEqual(q('what is the meaning of reluctant'), { intent: 'define', word: 'reluctant', lang: 'en' });
  assert.deepEqual(q('qué quiere decir esta palabra'), { intent: 'define', word: '@current', lang: 'es' });
  assert.deepEqual(q('what does this word mean'), { intent: 'define', word: '@current', lang: 'en' });
  assert.equal(q('cómo se dice vecino en inglés').intent, 'toEnglish');
  assert.equal(q('how do you pronounce thorough').intent, 'pronounce');
  assert.equal(q('sigue').intent, 'continue'); assert.equal(q('Repeat').intent, 'repeat'); assert.equal(q('más lento').intent, 'slower');
  assert.deepEqual(q('neighbour', 'es'), { intent: 'define', word: 'neighbour', lang: 'es' });
  assert.equal(q('me gusta mucho el helado de chocolate').intent, 'unknown');
});
test('localGrammar detecta errores típicos y propone arreglo', () => {
  const t = "She don't like it. I am agree with you. He have a car. It depends of the weather. I have 25 years. She go to home. I need an information. A apple and an dog. They is happy. More better. The the end.";
  const issues = R.localGrammar(t); const ids = issues.map(i => i.rule);
  for (const id of ['DONT_3P', 'AM_AGREE', 'HAVE_3P', 'DEPEND_OF', 'YEARS_OLD', 'S_3P', 'GO_TO_HOME', 'A_AN', 'AN_A', 'BE_AGREE_PL', 'MORE_ER', 'DOUBLE']) assert.ok(ids.includes(id), id);
  const fixed = R.applyFixes(t, issues);
  assert.match(fixed, /She doesn't like it/); assert.match(fixed, /I agree with you/); assert.match(fixed, /He has a car/); assert.match(fixed, /depends on/); assert.match(fixed, /I am 25 years old/);
});
test('localGrammar no marca texto correcto', () => {
  const ok = "She doesn't like it. I agree. He has a car. It depends on the weather. She goes home. I use a university library at an hour like this. They are happy.";
  assert.deepEqual(R.localGrammar(ok), []);
});
test('sentenceCase', () => { assert.equal(R.sentenceCase('i think i am ready'), 'I think I am ready.'); assert.equal(R.sentenceCase('  '), ''); });
