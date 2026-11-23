#!/usr/bin/env node
/**
 * D-PROD-273 (fatia 3) — auditoria SOMENTE LEITURA "replay = gravado" do custo médio do estoque.
 *
 * Uso:
 *   DATABASE_URL='postgresql://…' node scripts/ops/replay-estoque-custo-medio.mjs \
 *     [--cliente-id <id>] [--empresa-id <id>] [--produto-id <id>] [--teto <n>] [--cutover <ISO>] \
 *     [--amostra <n>] [--saida relatorio.json] [--mostrar-ids] [--exigir-zero]
 *
 * Para cada produto × empresa (do tenant pedido, ou de todos), lê TODO o histórico do produto (movimentos e
 * camadas) e roda o replay puro do motor (`backend/src/modules/estoqueRecalculo/estoqueReplay.js`) sem exclusão; relata
 * cada divergência entre o que o replay calcula e o que está gravado (valores, saldos, médios, fatias, camadas no fim),
 * os movimentos fora do protocolo e onde o replay parou.
 *
 * Segurança:
 *  - lê a URL SÓ de `DATABASE_URL` e NUNCA a imprime (nem em erro: só a classe/código do erro);
 *  - cada produto numa transação REPEATABLE READ com `SET TRANSACTION READ ONLY` (o PostgreSQL recusa qualquer
 *    escrita); só `SELECT`/`count`; nada de trava, nada de DDL, nada de AuditLog;
 *  - ids saem com hash curto, a menos que `--mostrar-ids`; números de movimento saem sempre (são do tenant);
 *    nomes de produto, depósito ou parceiro nunca saem.
 *  - `--cutover` (ISO) força o corte do custo médio (D-PROD-256) para todos os tenants; sem ele, o corte de cada
 *    tenant é o 1º movimento gravado com `modo_saida_fifo = 'CUSTO_MEDIO'`.
 *
 * Saída (exit code): 0 executado | 1 falha técnica | 2 uso incorreto | 3 com `--exigir-zero`, há divergência,
 * problema ou parada.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

const USO = 'uso: DATABASE_URL=… node scripts/ops/replay-estoque-custo-medio.mjs [--cliente-id id] [--empresa-id id] [--produto-id id] [--teto n] [--cutover ISO] [--amostra n] [--saida arquivo] [--mostrar-ids] [--exigir-zero]';
const COM_VALOR = new Set(['--cliente-id', '--empresa-id', '--produto-id', '--teto', '--cutover', '--amostra', '--saida']);
const SEM_VALOR = new Set(['--mostrar-ids', '--exigir-zero']);
const args = process.argv.slice(2);
/** @type {Record<string, string|true>} */
const op = {};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (SEM_VALOR.has(a)) op[a] = true;
  else if (COM_VALOR.has(a) && typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--')) op[a] = args[(i += 1)];
  else {
    console.error(USO);
    process.exit(2);
  }
}
const inteiro = (nome, padrao) => {
  if (op[nome] === undefined) return padrao;
  const v = Number(op[nome]);
  if (!Number.isSafeInteger(v) || v < 1) {
    console.error(USO);
    process.exit(2);
  }
  return v;
};
const teto = inteiro('--teto', 200000);
const amostra = inteiro('--amostra', 20);
let cutover = null;
if (op['--cutover'] !== undefined) {
  cutover = new Date(String(op['--cutover'])).getTime();
  if (Number.isNaN(cutover)) {
    console.error(USO);
    process.exit(2);
  }
}
const url = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim() ? process.env.DATABASE_URL.trim() : null;
if (!url) {
  console.error('replay-estoque-custo-medio — DATABASE_URL ausente.');
  process.exit(2);
}
const mostrarIds = op['--mostrar-ids'] === true;
const id = (v) => (v === null || v === undefined ? null : mostrarIds ? v : createHash('sha256').update(String(v)).digest('hex').slice(0, 10));

// O núcleo do backend só é importado depois da validação dos argumentos; o cliente Prisma é deste script.
const { auditarReplayDoProduto } = await import('../../backend/src/modules/estoqueRecalculo/estoqueRecalculoService.js');
const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });

/** Transação somente leitura (o banco recusa escrita). @template T @param {(tx: any) => Promise<T>} fn @returns {Promise<T>} */
const lendo = (fn) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SET TRANSACTION READ ONLY`;
    return fn(tx);
  }, { isolationLevel: 'RepeatableRead', maxWait: 10000, timeout: 600000 });

/** Linha de divergência/problema sem nada além de ids (com hash), números e valores. */
const limpar = (x) => {
  const saida = {};
  for (const [k, v] of Object.entries(x ?? {})) {
    if (/(^|_)id$/.test(k) && typeof v === 'string') saida[k] = id(v);
    // fatias em JSON (`lotes_consumidos`): os ids das camadas também saem com hash
    else if (typeof v === 'string' && !mostrarIds) saida[k] = v.replace(/("lote(?:_destino)?_id":")([^"]+)"/g, (_t, a, b) => `${a}${id(b)}"`);
    else saida[k] = v;
  }
  return saida;
};

let codigo = 0;
try {
  const chaves = /** @type {Array<{ cliente_id: string, empresa_id: string, produto_id: string }>} */ (await lendo((tx) => tx.$queryRawUnsafe(
    `SELECT cliente_id, empresa_id, produto_id FROM "MovimentacaoEstoque" WHERE ($1::text IS NULL OR cliente_id = $1) AND ($2::text IS NULL OR empresa_id = $2) AND ($3::text IS NULL OR produto_id = $3)
     UNION
     SELECT cliente_id, empresa_id, produto_id FROM "EstoqueLoteNota" WHERE ($1::text IS NULL OR cliente_id = $1) AND ($2::text IS NULL OR empresa_id = $2) AND ($3::text IS NULL OR produto_id = $3)
     ORDER BY 1, 2, 3`,
    op['--cliente-id'] ?? null, op['--empresa-id'] ?? null, op['--produto-id'] ?? null,
  )));
  const produtos = [];
  const resumo = { produtos: 0, reproduzem: 0, com_divergencia: 0, nao_reproduziveis: 0, acima_do_teto: 0, movimentos: 0, camadas: 0, divergencias: 0, legados: 0 };
  for (const k of chaves) {
    resumo.produtos += 1;
    let r;
    try {
      r = await lendo((tx) => auditarReplayDoProduto(tx, k.cliente_id, k.empresa_id, k.produto_id, { teto, cutover }));
    } catch (e) {
      if (e?.code === 'ESTOQUE_RECALCULO_VOLUME_EXCEDIDO') {
        resumo.acima_do_teto += 1;
        produtos.push({ cliente_id: id(k.cliente_id), empresa_id: id(k.empresa_id), produto_id: id(k.produto_id), estado: 'acima_do_teto', movimentos: e.details?.movimentos ?? null });
        continue;
      }
      throw e;
    }
    resumo.movimentos += r.movimentos;
    resumo.camadas += r.camadas;
    resumo.divergencias += r.divergencias.length;
    resumo.legados += r.legados;
    const estado = !r.reproduzivel ? 'nao_reproduzivel' : r.divergencias.length ? 'com_divergencia' : 'reproduz';
    if (estado === 'reproduz') resumo.reproduzem += 1;
    else if (estado === 'com_divergencia') resumo.com_divergencia += 1;
    else resumo.nao_reproduziveis += 1;
    if (estado !== 'reproduz') {
      produtos.push({
        cliente_id: id(k.cliente_id), empresa_id: id(k.empresa_id), produto_id: id(k.produto_id), estado,
        movimentos: r.movimentos, camadas: r.camadas, legados: r.legados,
        parada: r.parada ? limpar(r.parada) : null,
        problemas: r.problemas.slice(0, amostra).map(limpar), total_problemas: r.problemas.length,
        divergencias: r.divergencias.slice(0, amostra).map(limpar), total_divergencias: r.divergencias.length,
      });
    }
  }
  const relatorio = { gerado_em: new Date().toISOString(), somente_leitura: true, filtros: { cliente_id: id(op['--cliente-id'] ?? null), empresa_id: id(op['--empresa-id'] ?? null), produto_id: id(op['--produto-id'] ?? null), teto, cutover: cutover === null ? null : new Date(cutover).toISOString() }, resumo, produtos };
  const json = `${JSON.stringify(relatorio, null, 2)}\n`;
  if (typeof op['--saida'] === 'string') writeFileSync(op['--saida'], json);
  else process.stdout.write(json);
  console.error(`replay-estoque-custo-medio — SOMENTE LEITURA — ${resumo.produtos} produto(s): ${resumo.reproduzem} reproduzem, ${resumo.com_divergencia} com divergência, ${resumo.nao_reproduziveis} não reproduzíveis, ${resumo.acima_do_teto} acima do teto; ${resumo.movimentos} movimentos, ${resumo.divergencias} divergência(s), ${resumo.legados} movimento(s) da era FIFO.`);
  if (op['--exigir-zero'] === true && resumo.reproduzem !== resumo.produtos) codigo = 3;
} catch (e) {
  // Nunca ecoa URL nem dados: só a classe do erro.
  console.error(`replay-estoque-custo-medio — FALHA TÉCNICA (${e?.code ?? e?.name ?? 'erro'})`);
  codigo = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(codigo);
