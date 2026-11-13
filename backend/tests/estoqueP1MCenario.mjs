/**
 * MAIKE-ESTOQUE-P1-02 (D-PROD-177) — apoio compartilhado dos testes PG da
 * missão (M2, M3, M4, M5). Não é arquivo de teste (sem `.test.`): só monta
 * chamadas DIRETAS ao motor físico (`estoqueFisicoMotor.js`) dentro de
 * transações reais, com a trava canônica do produto, e fotografa o estado
 * físico do tenant.
 *
 * A prova de "recusa ANTES de qualquer escrita" (e não "escreveu e voltou")
 * é feita DENTRO da transação: o estado é lido antes e depois da chamada
 * recusada, pela própria `tx` (que enxergaria as próprias escritas).
 */

import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import * as motor from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';
import { prisma } from './gestaoP3Cenario.mjs';

export const D = (v) => new Prisma.Decimal(v);
export const q4 = (v) => (v === null || v === undefined ? null : D(v).toFixed(4));
export const OPCOES_TX = Object.freeze({ maxWait: 10000, timeout: 60000 });
const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

/** Contexto do motor (auth do administrador do tenant). */
export const ctxDe = (s) => ({ auth: { clienteId: s.c, usuarioId: s.admId, login: s.admLogin } });
export const localDe = (l) => ({ id: l.id, nome: l.nome });

/**
 * Estado físico do tenant pela conexão dada (`tx` ou o pool): lotes,
 * movimentos, `estoque_atual`, sequências e quantidade de auditoria — tudo o
 * que uma primitiva do motor pode tocar.
 * @param {any} db @param {string} c
 */
export const estadoFisico = async (db, c) => {
  const w = { where: { cliente_id: c }, orderBy: { id: /** @type {const} */ ('asc') } };
  return JSON.stringify({
    lotes: await db.estoqueLoteNota.findMany(w),
    movimentos: await db.movimentacaoEstoque.findMany(w),
    produtos: await db.produto.findMany({ ...w, select: { id: true, estoque_atual: true, updatedAt: true } }),
    sequencias: await db.entidadeCodigoSequencia.findMany(w),
    auditoria: await db.auditLog.count({ where: { cliente_id: c } }),
  }, replacer);
};

/** Contagens rápidas (lotes, movimentos, estoque_atual de um produto). */
export const contagens = async (s, produto) => {
  const p = prisma();
  return {
    lotes: await p.estoqueLoteNota.count({ where: { cliente_id: s.c } }),
    movimentos: await p.movimentacaoEstoque.count({ where: { cliente_id: s.c } }),
    estoque_atual: q4((await p.produto.findUnique({ where: { id: produto.id } })).estoque_atual),
  };
};

/** Argumentos padrão da entrada (compra P3 típica: 10 kg a 2,5000, NF-100 do fornecedor da empresa). */
export const argsEntrada = (s, e, produto, extra = {}) => ({
  empresaId: e.id,
  produto,
  local: localDe(s.local),
  quantidadeKg: '10.0000',
  custoUnitarioKg: '2.5000',
  valorTotal: '25.0000',
  dia: '2027-06-10',
  documento: { numero: 'NF-100', data: '2027-06-09' },
  parceiro: { id: e.forn.id, nome: e.forn.nome },
  origem: { operacaoId: 'op-motor-p102' },
  numeroMovimento: motor.numeroMovimentoProvisorio(),
  ...extra,
});

/** Entrada pelo motor numa transação própria: trava do produto → entrada → numeração NO FIM. */
export const entrar = (s, e, produto, extra = {}) =>
  prisma().$transaction(async (tx) => {
    await motor.travarProdutosEstoque(tx, s.c, e.id, [produto.id]);
    const lido = await tx.produto.findUnique({ where: { id: produto.id } });
    const r = await motor.aplicarEntradaEstoque(tx, ctxDe(s), argsEntrada(s, e, lido, extra));
    await motor.numerarMovimentos(tx, s.c, [r.movimento.id]);
    return { ...r, movimento: await tx.movimentacaoEstoque.findUnique({ where: { id: r.movimento.id } }) };
  }, OPCOES_TX);

/** Saída FIFO pelo motor numa transação própria. */
export const sairFifo = (s, e, produto, kg, extra = {}) =>
  prisma().$transaction(async (tx) => {
    await motor.travarProdutosEstoque(tx, s.c, e.id, [produto.id]);
    const lido = await tx.produto.findUnique({ where: { id: produto.id } });
    const r = await motor.aplicarSaidaFifo(tx, ctxDe(s), {
      empresaId: e.id, produto: lido, local: localDe(s.local), quantidadeKg: kg, dia: '2027-06-11',
      parceiro: { id: e.cli.id, nome: e.cli.nome }, origem: { operacaoId: 'op-venda-p102' }, numeroMovimento: motor.numeroMovimentoProvisorio(), ...extra,
    });
    await motor.numerarMovimentos(tx, s.c, [r.movimento.id]);
    return r;
  }, OPCOES_TX);

/** Item do estorno em lote no formato da linha (ENTRADA), a partir do resultado de `entrar`. */
export const itemDaEntrada = (r, ordem = 1, extra = {}) => ({
  produto_id: r.lote.produto_id,
  local_estoque_id: r.lote.local_estoque_id,
  local_estoque_nome: r.lote.local_estoque_nome,
  movimentacao_estoque_id: r.movimento.id,
  estoque_lote_nota_id: r.lote.id,
  quantidade_estoque: D(r.lote.quantidade_entrada),
  ordem,
  consumos: [],
  ...extra,
});

/** Item do estorno em lote (SAIDA) a partir do resultado de `sairFifo`. */
export const itemDaSaida = (r, produto, local, ordem = 1, extra = {}) => ({
  produto_id: produto.id,
  local_estoque_id: local.id,
  local_estoque_nome: local.nome,
  movimentacao_estoque_id: r.movimento.id,
  estoque_lote_nota_id: null,
  quantidade_estoque: D(r.movimento.quantidade),
  ordem,
  consumos: r.fatias.map((f) => ({ estoque_lote_nota_id: f.lote_id, quantidade: D(f.quantidade) })),
  ...extra,
});

/** Argumentos do estorno em lote (padrão: compra, sem os parâmetros novos). */
export const argsEstornoEmLote = (s, e, itens, extra = {}) => ({
  empresaId: e.id,
  itens,
  dia: '2027-06-12',
  documento: { numero: 'NF-100', data: '2027-06-09' },
  parceiro: { id: e.forn.id, nome: e.forn.nome },
  origem: { operacaoId: 'op-motor-p102' },
  numeroMovimento: motor.numeroMovimentoProvisorio,
  ...extra,
});

/** Estorno em lote numa transação própria: trava dos produtos → estornos → numeração NO FIM. */
export const estornarLote = (s, e, itens, extra = {}) =>
  prisma().$transaction(async (tx) => {
    await motor.travarProdutosEstoque(tx, s.c, e.id, itens.map((i) => i.produto_id));
    const ids = await motor.estornarEmLote(tx, ctxDe(s), argsEstornoEmLote(s, e, itens, extra));
    await motor.numerarMovimentos(tx, s.c, ids);
    return ids;
  }, OPCOES_TX);

/** Argumentos de `estornarEntrada` a partir do resultado de `entrar` (o item é a linha). */
export const argsEstornoEntrada = (s, e, r, produto, extra = {}) => ({
  empresaId: e.id,
  item: { ordem: 1, quantidade_estoque: D(r.lote.quantidade_entrada), estoque_lote_nota_id: r.lote.id, movimentacao_estoque_id: r.movimento.id },
  produto,
  local: localDe(s.local),
  dia: '2027-06-12',
  documento: { numero: 'NF-100', data: '2027-06-09' },
  parceiro: { id: e.forn.id, nome: e.forn.nome },
  origem: { operacaoId: 'op-motor-p102' },
  numeroMovimento: motor.numeroMovimentoProvisorio(),
  ...extra,
});

/** `estornarEntrada` numa transação própria (o único chamador fora de teste é nenhum; contrato §6.2 item 6). */
export const estornarUmaEntrada = (s, e, r, extra = {}) =>
  prisma().$transaction(async (tx) => {
    await motor.travarProdutosEstoque(tx, s.c, e.id, [r.lote.produto_id]);
    const produto = await tx.produto.findUnique({ where: { id: r.lote.produto_id } });
    const res = await motor.estornarEntrada(tx, ctxDe(s), argsEstornoEntrada(s, e, r, produto, extra));
    await motor.numerarMovimentos(tx, s.c, [res.movimento.id]);
    return res;
  }, OPCOES_TX);

/**
 * Roda `fn(tx)` (que DEVE recusar) numa transação real com os produtos
 * travados; lê o estado físico pela própria `tx` antes e depois da recusa e
 * devolve o erro. Se `fn` não recusar, a transação é desfeita (nada fica).
 * Prova: o estado visto pela `tx` não mudou = nenhuma escrita antes da recusa.
 * @returns {Promise<any>} o erro da recusa
 */
export const recusaAntesDeEscrever = async (s, empresaId, produtoIds, fn) => {
  const antesFora = await estadoFisico(prisma(), s.c);
  /** @type {any} */
  let erro = null;
  await prisma().$transaction(async (tx) => {
    await motor.travarProdutosEstoque(tx, s.c, empresaId, produtoIds);
    const antes = await estadoFisico(tx, s.c);
    try {
      await fn(tx);
    } catch (x) {
      erro = x;
    }
    if (!erro) throw new Error('a chamada deveria ter sido recusada (transação desfeita)');
    assert.equal(await estadoFisico(tx, s.c), antes, `nenhuma escrita antes da recusa: ${erro?.message}`);
  }, OPCOES_TX).catch((x) => {
    if (!erro) erro = x;
    else throw x;
  });
  assert.equal(await estadoFisico(prisma(), s.c), antesFora, 'nada gravado depois da recusa');
  return erro;
};

/** Resumo comparável de um erro do motor: AppError → [status, code, field, reason]; Error comum → ['500', message]. */
export const resumoErro = (x) =>
  x && typeof x === 'object' && 'code' in x && x.name === 'AppError'
    ? [x.status, x.code, x.details?.field ?? null, x.details?.reason ?? null]
    : ['500', String(x?.message ?? x)];

/**
 * Invariantes físicos (iguais aos de `estoqueP0MotorUnico`):
 *  (a) por produto: estoque_atual − Σ disponível dos lotes Disponivel da empresa do produto = diferença esperada (padrão 0);
 *  (b) por empresa+produto+local: Σ disponível ≥ 0;
 *  (c) por lote: 0 ≤ disponível ≤ entrada e situação coerente;
 *  (d) nenhum movimento com número provisório; nenhum produto com estoque_atual < 0.
 */
export const conferirInvariantes = async (s, rotulo, diferencas = {}) => {
  const p = prisma();
  const produtos = await p.produto.findMany({ where: { cliente_id: s.c }, select: { id: true, empresa_id: true, estoque_atual: true } });
  const lotes = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c } });
  for (const prod of produtos) {
    assert.ok(D(prod.estoque_atual).gte(0), `${rotulo}: (d) produto ${prod.id} com estoque_atual negativo`);
    const soma = lotes
      .filter((l) => l.produto_id === prod.id && l.empresa_id === prod.empresa_id && l.status === 'Disponivel')
      .reduce((t, l) => t.plus(D(l.quantidade_disponivel)), D(0));
    assert.equal(D(prod.estoque_atual).minus(soma).toFixed(4), diferencas[prod.id] ?? '0.0000', `${rotulo}: (a) produto ${prod.id}`);
  }
  const porLocal = new Map();
  for (const l of lotes) {
    const k = `${l.empresa_id}|${l.produto_id}|${l.local_estoque_id}`;
    porLocal.set(k, (porLocal.get(k) ?? D(0)).plus(D(l.quantidade_disponivel)));
    const disp = D(l.quantidade_disponivel);
    assert.ok(disp.gte(0) && disp.lte(D(l.quantidade_entrada)), `${rotulo}: (c) lote ${l.id}`);
    if (disp.gt(0)) assert.equal(l.status, 'Disponivel', `${rotulo}: (c) lote ${l.id} com saldo e status ${l.status}`);
    else assert.ok(['Esgotado', 'Estornado'].includes(l.status), `${rotulo}: (c) lote ${l.id} zerado e status ${l.status}`);
  }
  for (const [k, v] of porLocal) assert.ok(v.gte(0), `${rotulo}: (b) ${k} = ${v}`);
  const provisorios = await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, numero_movimentacao: { startsWith: 'p-' } } });
  assert.equal(provisorios, 0, `${rotulo}: nenhum movimento commitado com número provisório`);
};
