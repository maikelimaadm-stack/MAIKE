#!/usr/bin/env node
/**
 * Gate: R2E-P1 / D-PROD-107 — fonte única do saldo do rebanho.
 *
 * Absoluto, estático (sem banco). Falha se:
 *  P107-LEDGER-SEM-LOTE    o módulo do ledger cria/altera/apaga `Lote`
 *                          (`inserirLote`, `tx.lote.create/update/upsert/delete*`)
 *                          — movimento nunca fabrica cadastro;
 *  P107-LEDGER-PROJECAO    a projeção de posição é escrita fora do motor
 *                          (`posicaoRebanho.update*` de `quantidade_cabecas`,
 *                          `partidaRebanho.*` fora de `rebanhoLedger/`);
 *  P107-LEGADO-DELEGA      um dos quatro comandos do mapa não passa pelo guarda
 *                          único `await exigirEmpresaNoLedger(tx, auth.clienteId,
 *                          e.empresaId)` seguido de `*NoLedger(tx, contexto, e…)`
 *                          (R2E-R1 → PR174-R5: sem modelo legado; empresa sem
 *                          cutover recebe 409 REBANHO_CUTOVER_PENDENTE);
 *  P174-MAPA-SEM-LOTE      um arquivo de `movimentacoesMapa/` (os comandos do
 *                          mapa e o cancelamento entre eles) escreve em `Lote`
 *                          (`inserirLote`, `atualizarLote*`, `tx.lote.create/
 *                          update/upsert/delete*`, `lote.updateMany`, SQL
 *                          INSERT/UPDATE/DELETE em "Lote") — Lote é só o
 *                          cadastro de entrada e nunca recebe efeito de manejo;
 *  P107-PATCH-LOTE         o PATCH de lote perdeu a recusa dos campos
 *                          operacionais no ledger;
 *  P107-MIGRATION          a migration do ledger perdeu os CHECKs de saldo.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.REBANHO_SSOT_ROOT || process.cwd();
const ler = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const semComentarios = (f) => f.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const falhas = [];
const falha = (codigo, msg) => falhas.push(`${codigo}: ${msg}`);

const LEDGER_DIR = 'backend/src/modules/rebanhoLedger';
const arquivosJs = (dir) => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(join(ROOT, rel)).isDirectory() ? arquivosJs(rel) : n.endsWith('.js') ? [rel] : [];
  });
};

const ledger = arquivosJs(LEDGER_DIR);
if (!ledger.length) falha('P107-LEDGER-SEM-LOTE', `módulo ausente: ${LEDGER_DIR}`);
for (const rel of ledger) {
  const src = semComentarios(ler(rel));
  if (/\binserirLote\b/.test(src)) falha('P107-LEDGER-SEM-LOTE', `${rel} usa inserirLote`);
  if (/\.lote\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(src)) falha('P107-LEDGER-SEM-LOTE', `${rel} escreve em Lote`);
  if (/posicaoRebanho\.(update|updateMany)\s*\([^)]*quantidade_cabecas/s.test(src)) falha('P107-LEDGER-PROJECAO', `${rel} escreve quantidade_cabecas fora da reprojeção`);
}
for (const rel of arquivosJs('backend/src').filter((r) => !r.startsWith(LEDGER_DIR))) {
  const src = semComentarios(ler(rel));
  if (/\b(partidaRebanho|pesoRebanho)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|"PartidaRebanho"|"PesoRebanho"/.test(src)) falha('P107-LEDGER-PROJECAO', `${rel} escreve partidas/pesos fora do motor`);
  if (/\bposicaoRebanho\.(create|update|upsert|delete|deleteMany)\s*\(/.test(src)) falha('P107-LEDGER-PROJECAO', `${rel} escreve posição fora do motor`);
}

const MAPA_DIR = 'backend/src/modules/movimentacoesMapa';
const COMANDOS = [
  `${MAPA_DIR}/manejoMapaComandoService.js`,
  `${MAPA_DIR}/manejoRebanhoComandoService.js`,
  `${MAPA_DIR}/manejoJuncaoComandoService.js`,
  `${MAPA_DIR}/manejoBaixaComandoService.js`,
];
const CANCELAMENTO = `${MAPA_DIR}/movimentacaoMapaCancelamentoService.js`;
for (const rel of COMANDOS) {
  if (!existsSync(join(ROOT, rel))) {
    falha('P107-LEGADO-DELEGA', `comando ausente: ${rel}`);
    continue;
  }
  const src = semComentarios(ler(rel));
  const guarda = src.search(/await exigirEmpresaNoLedger\(tx, auth\.clienteId, e\.empresaId\)/);
  const delega = src.search(/return \w+NoLedger\(tx, contexto, e\b/);
  if (guarda < 0) falha('P107-LEGADO-DELEGA', `${rel} não exige a empresa no ledger (await exigirEmpresaNoLedger(tx, auth.clienteId, e.empresaId))`);
  else if (delega < 0 || delega < guarda) falha('P107-LEGADO-DELEGA', `${rel} não delega ao ledger (*NoLedger(tx, contexto, e…)) depois do guarda`);
  if (/\bif \(true\)/.test(src)) falha('P107-LEGADO-DELEGA', `${rel} mantém desvio morto (if (true)) para o modelo legado`);
}

const ESCRITA_LOTE = [
  [/\binserirLote\b/, 'inserirLote'],
  [/\batualizarLote\w*/, 'atualizarLote*'],
  [/\blote\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/, 'lote.create/update/upsert/delete*'],
  [/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"Lote"/i, 'SQL de escrita em "Lote"'],
];
const mapa = arquivosJs(MAPA_DIR);
for (const rel of [...COMANDOS, CANCELAMENTO]) if (!mapa.includes(rel)) falha('P174-MAPA-SEM-LOTE', `arquivo esperado ausente: ${rel}`);
for (const rel of mapa) {
  const src = semComentarios(ler(rel));
  for (const [re, nome] of ESCRITA_LOTE) if (re.test(src)) falha('P174-MAPA-SEM-LOTE', `${rel} escreve em Lote (${nome})`);
}

const servicoLote = 'backend/src/modules/lotes/loteService.js';
if (existsSync(join(ROOT, servicoLote))) {
  const src = semComentarios(ler(servicoLote));
  if (!/REBANHO_LEDGER_SALDO_SOMENTE_POR_EVENTO/.test(src) || !/registrarEntradaSeAtivo\(tx,/.test(src)) falha('P107-PATCH-LOTE', `${servicoLote} perdeu a separação cadastro × saldo no ledger`);
}

const MIG = 'backend/prisma/migrations/20261102200000_rebanho_ledger_posicoes/migration.sql';
if (!existsSync(join(ROOT, MIG))) falha('P107-MIGRATION', `migration ausente: ${MIG}`);
else {
  const sql = ler(MIG);
  for (const c of ['PosicaoRebanho_quantidade_nao_negativa', 'PartidaRebanho_delta_nao_zero', 'EventoRebanho_situacao_valida']) {
    if (!sql.includes(c)) falha('P107-MIGRATION', `CHECK ausente: ${c}`);
  }
}

if (falhas.length) {
  console.error(`gate:rebanho-ssot — FALHOU (${falhas.length})\n  - ${falhas.join('\n  - ')}\n\nVer docs/engineering/DECISIONS.md (D-PROD-107).`);
  process.exit(1);
}
console.log(`gate:rebanho-ssot — PASSOU (${ledger.length} arquivo(s) do ledger; ${COMANDOS.length} comandos do mapa só pelo ledger; ${mapa.length} arquivo(s) do mapa sem escrita em Lote)`);
