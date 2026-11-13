/**
 * Shards do test:backend na CI paralela (MAIKE-CI-PARALELO-PR02).
 *
 * O que não pode quebrar: cada arquivo de backend/tests roda em EXATAMENTE um
 * shard, a divisão é determinística e um shard inválido falha antes de tocar
 * no banco. Equilíbrio é desejável, cobertura é obrigatória.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT } from './helpers.mjs';
import { dividirArquivos, selecionarShard, lerEspecificacao, carregarPesos } from '../../ci/backend-shards.mjs';

const ARQUIVOS = readdirSync(join(REPO_ROOT, 'backend/tests'))
  .filter((n) => n.endsWith('.test.mjs'))
  .sort();
const PESOS = carregarPesos();

describe('divisão do test:backend em shards', () => {
  test('BS-1 com os arquivos reais, cada arquivo cai em exatamente um shard (n = 1..6)', () => {
    assert.ok(ARQUIVOS.length > 50, 'lista de testes de backend inesperadamente curta');
    for (let n = 1; n <= 6; n += 1) {
      const grupos = dividirArquivos(ARQUIVOS, n, PESOS);
      assert.equal(grupos.length, n);
      const todos = grupos.flat();
      assert.equal(todos.length, ARQUIVOS.length, `n=${n}: arquivo perdido ou repetido`);
      assert.deepEqual([...todos].sort(), ARQUIVOS, `n=${n}: a união não é a lista inteira`);
      assert.ok(grupos.every((g) => g.length > 0), `n=${n}: shard vazio`);
    }
  });

  test('BS-2 selecionarShard 1..n reconstrói a lista inteira, sem interseção', () => {
    const vistos = new Set();
    for (let i = 1; i <= 3; i += 1) {
      for (const arquivo of selecionarShard(ARQUIVOS, `${i}/3`, PESOS)) {
        assert.ok(!vistos.has(arquivo), `${arquivo} em dois shards`);
        vistos.add(arquivo);
      }
    }
    assert.deepEqual([...vistos].sort(), ARQUIVOS);
  });

  test('BS-3 determinística: mesma entrada, mesmos shards (inclusive com a lista embaralhada)', () => {
    const a = dividirArquivos(ARQUIVOS, 3, PESOS);
    const b = dividirArquivos([...ARQUIVOS].reverse(), 3, PESOS);
    assert.deepEqual(a, b);
  });

  test('BS-4 arquivo novo sem peso medido entra num shard (só o equilíbrio pode piorar)', () => {
    const comNovo = [...ARQUIVOS, 'zzzArquivoNovoSemPeso.test.mjs'];
    const grupos = dividirArquivos(comNovo, 3, PESOS);
    assert.equal(grupos.flat().filter((a) => a === 'zzzArquivoNovoSemPeso.test.mjs').length, 1);
    assert.equal(grupos.flat().length, comNovo.length);
    // Sem pesos nenhum, ainda cobre tudo.
    assert.deepEqual(dividirArquivos(ARQUIVOS, 3, {}).flat().sort(), ARQUIVOS);
  });

  test('BS-5 especificação inválida é recusada', () => {
    for (const ruim of ['', '0/3', '4/3', '1/0', '1/21', 'a/b', '1/3/1', ' 1 / 3', '-1/3', undefined, null]) {
      assert.equal(lerEspecificacao(ruim), null, String(ruim));
    }
    assert.deepEqual(lerEspecificacao('2/3'), { indice: 2, total: 3 });
    assert.throws(() => selecionarShard(ARQUIVOS, '5/3', PESOS), /TEST_BACKEND_SHARD inválido/);
    assert.throws(() => dividirArquivos(['a', 'a'], 2), /repetido/);
  });

  test('BS-6 com os pesos medidos, o shard mais pesado fica perto do ideal (≤ 1,25 × média)', () => {
    const peso = (a) => PESOS[a] ?? 0;
    const grupos = dividirArquivos(ARQUIVOS, 3, PESOS);
    const somas = grupos.map((g) => g.reduce((s, a) => s + peso(a), 0));
    const media = somas.reduce((s, x) => s + x, 0) / somas.length;
    assert.ok(Math.max(...somas) <= media * 1.25, `desequilibrado: ${somas.map((s) => Math.round(s / 1000)).join('s / ')}s`);
  });

  test('BS-7 o arquivo de pesos é JSON válido e só tem pesos positivos', () => {
    const dados = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/ci/backend-test-pesos.json'), 'utf8'));
    assert.equal(typeof dados.pesos, 'object');
    for (const [arquivo, ms] of Object.entries(dados.pesos)) {
      assert.match(arquivo, /^[\w.-]+\.test\.mjs$/);
      assert.ok(Number.isFinite(ms) && ms > 0, arquivo);
    }
  });
});

describe('runner do test:backend com TEST_BACKEND_SHARD', () => {
  const rodar = (shard) =>
    spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/tests/run-backend-tests.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      // Banco inexistente de propósito: o shard inválido tem de falhar ANTES de qualquer conexão.
      env: { PATH: process.env.PATH, DATABASE_URL: 'postgresql://ninguem@127.0.0.1:1/nada', AUTH_SECRET: 'x', TEST_BACKEND_SHARD: shard },
    });

  test('BS-8 shard inválido falha antes de validar schema ou tocar no banco', () => {
    for (const ruim of ['0/3', '4/3', 'abc']) {
      const r = rodar(ruim);
      assert.equal(r.status, 1, ruim);
      assert.match(r.stderr + r.stdout, /TEST_BACKEND_SHARD inválido/);
      assert.doesNotMatch(r.stdout, /validando schema Prisma/);
    }
  });
});
