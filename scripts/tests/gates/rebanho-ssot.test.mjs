/**
 * Provas do gate:rebanho-ssot (R2E-P1 / D-PROD-107 → PR174-R5).
 *
 * Cada caso copia as entradas reais do gate para um diretório temporário
 * (REBANHO_SSOT_ROOT), aplica UMA mutação e confere que o gate falha com o
 * código certo. Nada toca o repositório de trabalho.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, cleanup, makeTempDir, runGate } from './helpers.mjs';

const GATE = 'gate-rebanho-ssot.mjs';
const MAPA = 'backend/src/modules/movimentacoesMapa';
const ENTRADAS = [
  'backend/src/modules/rebanhoLedger',
  MAPA,
  'backend/src/modules/lotes/loteService.js',
  'backend/prisma/migrations/20261102200000_rebanho_ledger_posicoes/migration.sql',
];

const comCopia = (mutar) => {
  const dir = makeTempDir('maike-rebanho-ssot-');
  try {
    for (const rel of ENTRADAS) cpSync(join(REPO_ROOT, rel), join(dir, rel), { recursive: true });
    if (mutar) mutar(dir);
    return runGate(GATE, { env: { REBANHO_SSOT_ROOT: dir } });
  } finally {
    cleanup(dir);
  }
};
const editar = (dir, rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), 'utf8')));

test('rebanho-ssot passa no repositório real', () => {
  const r = runGate(GATE);
  assert.equal(r.status, 0, r.output);
});

test('rebanho-ssot passa na cópia sem mutação', () => {
  const r = comCopia();
  assert.equal(r.status, 0, r.output);
});

for (const comando of ['manejoMapaComandoService', 'manejoRebanhoComandoService', 'manejoJuncaoComandoService', 'manejoBaixaComandoService']) {
  test(`P107-LEGADO-DELEGA: ${comando} sem o guarda exigirEmpresaNoLedger falha`, () => {
    const r = comCopia((dir) =>
      editar(dir, `${MAPA}/${comando}.js`, (s) => s.replace('await exigirEmpresaNoLedger(tx, auth.clienteId, e.empresaId);', 'await Promise.resolve();'))
    );
    assert.notEqual(r.status, 0);
    assert.match(r.output, /P107-LEGADO-DELEGA: .*exigirEmpresaNoLedger/);
  });
}

test('P107-LEGADO-DELEGA: desvio morto `if (true)` de volta ao legado falha', () => {
  const r = comCopia((dir) =>
    editar(dir, `${MAPA}/manejoJuncaoComandoService.js`, (s) => s.replace('return juncaoNoLedger(tx, contexto, e', 'if (true) return juncaoNoLedger(tx, contexto, e'))
  );
  assert.notEqual(r.status, 0);
  assert.match(r.output, /P107-LEGADO-DELEGA: .*if \(true\)/);
});

const ESCRITAS = [
  ['inserirLote', 'await inserirLote(tx, {});'],
  ['atualizarLote*', 'await atualizarLoteAuditado(tx, {});'],
  ['tx.lote.update', 'await tx.lote.update({ where: {}, data: {} });'],
  ['tx.lote.create', 'await tx.lote.create({ data: {} });'],
  ['lote.updateMany', 'await prisma.lote.updateMany({ where: {}, data: {} });'],
  ['SQL UPDATE "Lote"', 'await tx.$executeRaw`UPDATE "Lote" SET quantidade_cabecas = 0`;'],
];
for (const arquivo of ['manejoMapaComandoService', 'manejoBaixaComandoService', 'movimentacaoMapaCancelamentoService']) {
  for (const [nome, linha] of ESCRITAS) {
    test(`P174-MAPA-SEM-LOTE: ${arquivo} com ${nome} falha`, () => {
      const r = comCopia((dir) => editar(dir, `${MAPA}/${arquivo}.js`, (s) => `${s}\nexport const legado = async (tx, prisma) => {\n  ${linha}\n};\n`));
      assert.notEqual(r.status, 0);
      assert.match(r.output, new RegExp(`P174-MAPA-SEM-LOTE: ${MAPA}/${arquivo}\\.js escreve em Lote`));
    });
  }
}

test('P174-MAPA-SEM-LOTE: comentário que cita tx.lote.update não conta', () => {
  const r = comCopia((dir) => editar(dir, `${MAPA}/manejoMapaComandoService.js`, (s) => `${s}\n// antes: tx.lote.update e inserirLote (removidos)\n`));
  assert.equal(r.status, 0, r.output);
});

test('P174-MAPA-SEM-LOTE: serviço de cancelamento ausente falha', () => {
  const r = comCopia((dir) => cleanup(join(dir, `${MAPA}/movimentacaoMapaCancelamentoService.js`)));
  assert.notEqual(r.status, 0);
  assert.match(r.output, /P174-MAPA-SEM-LOTE: arquivo esperado ausente/);
});
