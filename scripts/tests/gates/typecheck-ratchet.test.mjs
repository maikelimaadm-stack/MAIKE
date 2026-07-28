import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDiagnostics,
  toFingerprintCounts,
  toFileCounts,
  normalizeMessage,
} from '../../gates/lib/tsc-diagnostics.mjs';
import { compareMultisets, isCount } from '../../gates/lib/ratchet.mjs';

const SAIDA = [
  "src/a.jsx(10,5): error TS2322: Type 'x' is not assignable to type 'y'.",
  "  Property 'children' does not exist.",
  "src/a.jsx(40,9): error TS2322: Type 'x' is not assignable to type 'y'.",
  "  Property 'children' does not exist.",
  "src/b.js(3,1): error TS2339: Property 'foo' does not exist on type 'never'.",
].join('\n');

describe('diagnósticos do TypeScript', () => {
  test('parseia diagnósticos e dobra linhas de continuação', () => {
    const d = parseDiagnostics(SAIDA);
    assert.equal(d.length, 3);
    assert.equal(d[0].file, 'src/a.jsx');
    assert.equal(d[0].code, 'TS2322');
    assert.match(d[0].message, /Property 'children' does not exist/);
  });

  test('fingerprint ignora linha e coluna', () => {
    const d = parseDiagnostics(SAIDA);
    assert.equal(d[0].fingerprint, d[1].fingerprint, 'mesmo erro em linhas diferentes = mesmo fingerprint');
    assert.notEqual(d[0].fingerprint, d[2].fingerprint);
  });

  test('preserva a multiplicidade', () => {
    const counts = toFingerprintCounts(parseDiagnostics(SAIDA));
    const [chaveRepetida] = Object.entries(counts).find(([, n]) => n === 2);
    assert.ok(chaveRepetida.startsWith('src/a.jsx|TS2322|'));
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 3);
  });

  test('conta por arquivo', () => {
    assert.deepEqual(toFileCounts(parseDiagnostics(SAIDA)), { 'src/a.jsx': 2, 'src/b.js': 1 });
  });

  test('normaliza espaço em branco na mensagem', () => {
    assert.equal(normalizeMessage('  a   b \r\n c '), 'a b c');
  });

  test('deslocar o código não gera diagnóstico novo', () => {
    const antes = toFingerprintCounts(parseDiagnostics(SAIDA));
    const deslocado = SAIDA.replace('(10,5)', '(999,80)').replace('(40,9)', '(1200,2)');
    const depois = toFingerprintCounts(parseDiagnostics(deslocado));
    const { novos, aumentos } = compareMultisets(antes, depois);
    assert.deepEqual(novos, []);
    assert.deepEqual(aumentos, []);
  });

  test('linha inesperada não vira diagnóstico', () => {
    assert.deepEqual(parseDiagnostics('Version 5.8.2\nFound 0 errors.'), []);
  });
});

describe('comparação de multiconjuntos', () => {
  test('detecta fingerprint novo', () => {
    const { novos } = compareMultisets({ a: 1 }, { a: 1, b: 1 });
    assert.deepEqual(novos, ['b (x1)']);
  });

  test('detecta multiplicidade aumentada', () => {
    const { aumentos, novos } = compareMultisets({ a: 1 }, { a: 3 });
    assert.deepEqual(novos, []);
    assert.deepEqual(aumentos, ['a: 1 -> 3']);
  });

  test('somente redução não é regressão', () => {
    const { novos, aumentos, reducoes } = compareMultisets({ a: 3, b: 1 }, { a: 1 });
    assert.deepEqual(novos, []);
    assert.deepEqual(aumentos, []);
    assert.deepEqual(reducoes.sort(), ['a: 3 -> 1', 'b: 1 -> 0']);
  });

  test('conjuntos iguais não movem nada', () => {
    const { novos, aumentos, reducoes } = compareMultisets({ a: 2 }, { a: 2 });
    assert.deepEqual([novos, aumentos, reducoes], [[], [], []]);
  });

  test('isCount rejeita valores inválidos', () => {
    assert.equal(isCount(0), true);
    assert.equal(isCount(3), true);
    assert.equal(isCount(-1), false);
    assert.equal(isCount(1.5), false);
    assert.equal(isCount(Infinity), false);
    assert.equal(isCount('2'), false);
    assert.equal(isCount(null), false);
  });
});
