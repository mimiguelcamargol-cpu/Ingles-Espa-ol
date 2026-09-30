const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { judge } = require('../judge.js');
const D = path.join(__dirname, '..', 'data');
const levels = JSON.parse(fs.readFileSync(path.join(D, 'levels.json'), 'utf8')).map(l => l.id);
const index = JSON.parse(fs.readFileSync(path.join(D, 'talks', 'index.json'), 'utf8'));

test('índice y archivos de conversaciones coinciden', () => {
  const files = fs.readdirSync(path.join(D, 'talks')).filter(f => f !== 'index.json').map(f => f.replace('.json', '')).sort();
  assert.deepEqual(index.map(t => t.id).sort(), files);
  assert.equal(new Set(index.map(t => t.id)).size, index.length);
});
for (const meta of index) {
  const t = JSON.parse(fs.readFileSync(path.join(D, 'talks', meta.id + '.json'), 'utf8'));
  test(`conversación "${t.id}" es válida y evaluable`, () => {
    assert.ok(levels.includes(t.level), 'nivel existente');
    assert.ok(['daily', 'dev'].includes(t.track));
    assert.ok(t.phrases.length >= 4 && t.phrases.every(p => p[0] && p[1]));
    assert.ok(t.turns[0].t, 'empieza hablando el tutor');
    assert.equal(t.turns.filter(x => x.y).length, meta.turns);
    assert.ok(t.turns.filter(x => x.y).length >= 5, 'conversación larga: ≥5 respuestas');
    t.turns.forEach((x, k) => {
      if (x.t) assert.ok(x.t.length > 20 && x.es, `turno ${k}: tutor con traducción`);
      if (x.c) { assert.ok(x.c.q && x.c.o.length >= 3 && x.c.a >= 0 && x.c.a < x.c.o.length); }
      if (x.y) {
        const y = x.y;
        assert.ok(y.say && y.es && y.keys.length >= 1 && y.keys.every(k => Array.isArray(k) && k.length), `turno ${k}: claves`);
        assert.equal(judge(y.say, y).verdict, 'ok', `turno ${k}: el modelo debe aprobar`);
        for (const a of y.alts) assert.equal(judge(a, y).verdict, 'ok', `turno ${k}: alternativa "${a}" debe aprobar`);
        assert.equal(judge('I like pizza and football very much today', y).verdict, 'no', `turno ${k}: respuesta irrelevante`);
        assert.notEqual(judge(y.keys[0][0], y).verdict, 'ok', `turno ${k}: una sola palabra no basta`);
      }
    });
  });
}
test('judge: tolera contracciones, sinónimos y detecta ideas faltantes', () => {
  const spec = { say: "I'm looking for a quiet place to work.", alts: ['I need a calm place to study.'], keys: [['quiet', 'calm'], ['work', 'study']] };
  assert.equal(judge("I am looking for a quiet place to work", spec).verdict, 'ok');
  assert.equal(judge('i need a calm place to study', spec).verdict, 'ok');
  const c = judge('a quiet place', spec); assert.ok(c.miss.includes('work'));
  assert.equal(judge('', spec).verdict, 'no');
});

test('la versión de la app coincide con package.json', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), new RegExp(`APP_VERSION = '${v.replace(/\./g, '\\.')}'`));
});
