import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

import { makeTempDir, cleanup, writeFile, runGate, readJson, fileExists } from './helpers.mjs';

const GATE = 'gate-base44-ratchet.mjs';

const AXES = {
  arquivosComSdk: 2, // base44Client.js (@base44/sdk) + Uso.jsx (base44Client)
  importsSdk: 1,
  entitiesRefs: 2,
  authRefs: 0,
  integrationsRefs: 0,
  functionsRefs: 0,
  vitePlugin: 0,
  runtimeConfigRefs: 0,
  schemas: 1,
  functionsBase44: 0,
};

/** Projeto sintético cuja medição é exatamente AXES. */
const makeProject = () => {
  const dir = makeTempDir('maike-base44-');
  writeFile(
    dir,
    'src/api/base44Client.js',
    "import { createClient } from '@base44/sdk';\nexport const base44 = createClient({});\n"
  );
  writeFile(
    dir,
    'src/pages/Uso.jsx',
    'import { base44 } from "@/api/base44Client";\nexport const a = () => base44.entities.Lote.list();\nexport const b = () => base44.entities.Setor.list();\n'
  );
  writeFile(dir, 'base44/entities/Lote.jsonc', '{}');
  return dir;
};

const baselinePath = (dir) => join(dir, 'baseline.json');

const run = (dir, args = []) =>
  runGate(GATE, { cwd: dir, env: { BASE44_BASELINE: 'baseline.json' }, args });

describe('gate:base44 — catraca', () => {
  let dir;
  before(() => {
    dir = makeProject();
  });
  after(() => cleanup(dir));

  test('mede os eixos esperados do projeto sintético', () => {
    writeFile(dir, 'baseline.json', { version: 2, axes: AXES });
    const r = run(dir);
    assert.equal(r.status, 0, r.output);
    const medicao = JSON.parse(r.stdout.match(/medição atual: (\{.*\})/)[1]);
    assert.deepEqual(medicao, AXES);
  });

  test('baseline ausente reprova — nunca cria automaticamente', () => {
    const d = makeProject();
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-BASE44-BASELINE/);
    assert.match(r.output, /baseline ausente/);
    assert.equal(fileExists(baselinePath(d)), false, 'não pode ter criado o baseline');
    cleanup(d);
  });

  test('baseline malformado reprova', () => {
    const d = makeProject();
    writeFile(d, 'baseline.json', '{ isto não é json');
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-BASE44-BASELINE/);
    assert.match(r.output, /não é JSON válido/);
    cleanup(d);
  });

  test('versão de schema desconhecida reprova', () => {
    const d = makeProject();
    writeFile(d, 'baseline.json', { version: 99, axes: AXES });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /versão de baseline desconhecida/);
    cleanup(d);
  });

  test('eixo ausente no baseline reprova', () => {
    const d = makeProject();
    const { schemas, ...semSchemas } = AXES;
    writeFile(d, 'baseline.json', { version: 2, axes: semSchemas });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-BASE44-CONTRACT/);
    assert.match(r.output, /ausente\(s\) no baseline: schemas/);
    cleanup(d);
  });

  test('eixo inesperado no baseline reprova', () => {
    const d = makeProject();
    writeFile(d, 'baseline.json', { version: 2, axes: { ...AXES, eixoInventado: 3 } });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-BASE44-CONTRACT/);
    assert.match(r.output, /inesperado\(s\).*eixoInventado/s);
    cleanup(d);
  });

  test('valor não inteiro no baseline reprova', () => {
    const d = makeProject();
    writeFile(d, 'baseline.json', { version: 2, axes: { ...AXES, entitiesRefs: -1 } });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /não é inteiro não negativo/);
    cleanup(d);
  });

  test('aumento em um eixo reprova', () => {
    const d = makeProject();
    writeFile(d, 'baseline.json', { version: 2, axes: { ...AXES, entitiesRefs: 1 } });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-BASE44-REGRESSION/);
    assert.match(r.output, /entitiesRefs: 1 -> 2/);
    cleanup(d);
  });

  test('redução válida passa e NÃO regrava sem --update', () => {
    const d = makeProject();
    writeFile(d, 'baseline.json', { version: 2, axes: { ...AXES, entitiesRefs: 50 } });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /entitiesRefs: 50 -> 2/);
    assert.equal(readJson(baselinePath(d)).axes.entitiesRefs, 50, 'execução normal não pode escrever');
    cleanup(d);
  });

  test('--update com redução grava atomicamente', () => {
    const d = makeProject();
    writeFile(d, 'baseline.json', { version: 2, axes: { ...AXES, entitiesRefs: 50 } });
    const r = run(d, ['--update']);
    assert.equal(r.status, 0, r.output);
    const gravado = readJson(baselinePath(d));
    assert.equal(gravado.version, 2);
    assert.equal(gravado.axes.entitiesRefs, 2);
    // Nenhum arquivo temporário sobrou.
    const restos = readdirSync(d).filter((f) => f.startsWith('.baseline.json.tmp'));
    assert.deepEqual(restos, [], `temporários não removidos: ${restos.join(', ')}`);
    cleanup(d);
  });

  test('--update com regressão falha e não altera o arquivo', () => {
    const d = makeProject();
    const original = { version: 2, axes: { ...AXES, entitiesRefs: 1 } };
    writeFile(d, 'baseline.json', original);
    const r = run(d, ['--update']);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-BASE44-REGRESSION/);
    assert.deepEqual(readJson(baselinePath(d)), original, 'arquivo não pode ter mudado');
    cleanup(d);
  });

  test('--update sem nenhuma redução falha e não regrava', () => {
    const d = makeProject();
    const original = { version: 2, axes: AXES };
    writeFile(d, 'baseline.json', original);
    const r = run(d, ['--update']);
    assert.equal(r.status, 1);
    assert.match(r.output, /exige pelo menos um eixo reduzido/);
    assert.deepEqual(readJson(baselinePath(d)), original);
    cleanup(d);
  });
});
