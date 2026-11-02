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
 *  P107-LEGADO-DELEGA      um comando do mapa que escreve saldo em `Lote` não
 *                          delega ao ledger (`empresaNoLedger` → `*NoLedger`)
 *                          ANTES da primeira escrita em `Lote` (duas fontes de
 *                          verdade numa empresa ativada) — R2E-R1;
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

const COMANDOS = [
  'backend/src/modules/movimentacoesMapa/manejoMapaComandoService.js',
  'backend/src/modules/movimentacoesMapa/manejoRebanhoComandoService.js',
  'backend/src/modules/movimentacoesMapa/manejoJuncaoComandoService.js',
  'backend/src/modules/movimentacoesMapa/manejoBaixaComandoService.js',
];
for (const rel of COMANDOS) {
  if (!existsSync(join(ROOT, rel))) continue;
  const src = semComentarios(ler(rel));
  const escrita = src.search(/tx\.lote\.update|inserirLote\(/);
  const delega = src.search(/if \(await empresaNoLedger\(tx, auth\.clienteId, e\.empresaId\)\)/);
  if (escrita >= 0 && (delega < 0 || !/NoLedger\(tx, contexto, e/.test(src))) falha('P107-LEGADO-DELEGA', `${rel} escreve saldo em Lote sem delegar ao ledger`);
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
console.log(`gate:rebanho-ssot — PASSOU (${ledger.length} arquivo(s) do ledger; ${COMANDOS.length} comandos do mapa delegando ao ledger na empresa ativada)`);
