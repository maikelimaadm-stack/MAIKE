/**
 * D-PROD-201 (Fatia 3 do Lançamento de Atividades) — repositório da LINHA DE
 * PRODUTO do apontamento (`AtividadeApontamentoProduto`) e das fatias FIFO que
 * ela consumiu (`AtividadeApontamentoProdutoConsumoLote`). Contrato
 * `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md` §2.
 *
 * Adaptador de dados, sem regra: o `cliente_id` vem SEMPRE de quem chama (que
 * o tirou do auth_context), nunca do corpo, da query, dos params, do cabeçalho
 * nem do cookie (R11). Toda leitura vai pelo escopo (cliente_id, empresa_id,
 * apontamento_id[, id]): linha de outro apontamento, de outra fazenda ou de
 * outro tenant dá o mesmo `null` (sem oráculo). Lote, movimento e
 * `estoque_atual` só mudam pelo motor de estoque; aqui nada escreve neles.
 */

import { INCLUIR_LINHA_PRODUTO, STATUS_LINHA } from './atividadeComum.js';

/**
 * Linha gravada com esta `operation_id` (qualquer apontamento do tenant): a
 * chave de uma linha que já existe é conflito mesmo sem o recibo.
 * @param {any} db @param {string} clienteId @param {string} operationId
 * @returns {Promise<{ id: string } | null>}
 */
export const buscarLinhaPorOperacao = (db, clienteId, operationId) =>
  db.atividadeApontamentoProduto.findFirst({ where: { cliente_id: clienteId, operation_id: operationId }, select: { id: true } });

/**
 * Alguma linha (de produto) com chave que começa por `prefixo` (as chaves
 * derivadas `<operation_id>:p<n>` de um lançamento com linhas).
 * @param {any} db @param {string} clienteId @param {string} prefixo
 * @returns {Promise<boolean>}
 */
export const existeLinhaComPrefixo = async (db, clienteId, prefixo) =>
  (await db.atividadeApontamentoProduto.count({ where: { cliente_id: clienteId, operation_id: { startsWith: prefixo } } })) > 0;

/**
 * Maior `ordem` das linhas do apontamento (confirmadas e canceladas: a ordem
 * nunca é reaproveitada). Chame SOB a trava da atividade.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} apontamentoId
 * @returns {Promise<number>}
 */
export const maiorOrdem = async (tx, clienteId, empresaId, apontamentoId) => {
  const r = await tx.atividadeApontamentoProduto.aggregate({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId },
    _max: { ordem: true },
  });
  return r._max.ordem ?? 0;
};

/** @param {any} tx @param {Record<string, unknown>} dados @returns {Promise<{ id: string }>} */
export const inserirLinha = (tx, dados) => tx.atividadeApontamentoProduto.create({ data: dados, select: { id: true } });

/** @param {any} tx @param {Array<Record<string, unknown>>} fatias */
export const inserirFatias = (tx, fatias) => (fatias.length ? tx.atividadeApontamentoProdutoConsumoLote.createMany({ data: fatias }) : Promise.resolve({ count: 0 }));

/**
 * Linhas dos apontamentos com os resumos e as fatias (na ordem do motor), em
 * ordem de lançamento. `status` filtra (ex.: só CONFIRMADO); `id` pega uma.
 * @param {any} db @param {string} clienteId @param {string} empresaId
 * @param {{ apontamentoIds: string[], status?: string, id?: string }} filtro
 */
export const lerLinhas = (db, clienteId, empresaId, { apontamentoIds, status, id }) =>
  db.atividadeApontamentoProduto.findMany({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      apontamento_id: { in: apontamentoIds },
      ...(status ? { status } : {}),
      ...(id ? { id } : {}),
    },
    include: INCLUIR_LINHA_PRODUTO,
    orderBy: [{ apontamento_id: 'asc' }, { ordem: 'asc' }],
  });

/**
 * CONFIRMADO → CANCELADO de cada linha com o SEU estorno, com CAS pelo status
 * (uma instrução por linha: cada uma leva o próprio movimento de estorno).
 * Devolve quantas mudaram (≠ linhas = um escritor fora do protocolo).
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, linhas: Array<{ id: string, estorno: string }>, motivo: string,
 *   origem: string, usuarioId: string|null, agora: Date }} pedido
 * @returns {Promise<number>}
 */
export const cancelarLinhasConfirmadas = async (tx, { clienteId, empresaId, linhas, motivo, origem, usuarioId, agora }) => {
  let n = 0;
  for (const l of linhas) {
    const r = await tx.atividadeApontamentoProduto.updateMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, id: l.id, status: STATUS_LINHA.CONFIRMADO, movimentacao_estorno_id: null },
      data: {
        status: STATUS_LINHA.CANCELADO,
        movimentacao_estorno_id: l.estorno,
        cancelado_em: agora,
        cancelado_por_usuario_id: usuarioId,
        motivo_cancelamento: motivo,
        cancelamento_origem: origem,
      },
    });
    n += r.count;
  }
  return n;
};

/**
 * Linhas CONFIRMADO do apontamento (a data não muda com elas).
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} apontamentoId
 * @returns {Promise<number>}
 */
export const contarConfirmadas = (db, clienteId, empresaId, apontamentoId) =>
  db.atividadeApontamentoProduto.count({ where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, status: STATUS_LINHA.CONFIRMADO } });

/**
 * Refaz `dose_ha = quantidade / área do dia` (4 casas, meio para cima) das
 * linhas CONFIRMADO do apontamento; sem área (nula ou zero), ou com a dose
 * acima do teto da coluna, nula. Só leitura para a tela: não mexe em estoque.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} apontamentoId
 * @param {string|null} area  texto decimal (4 casas) ou nulo
 */
export const recalcularDoses = (tx, clienteId, empresaId, apontamentoId, area) =>
  tx.$executeRaw`UPDATE "AtividadeApontamentoProduto"
    SET dose_ha = CASE
        WHEN ${area}::numeric IS NULL OR ${area}::numeric <= 0 THEN NULL
        WHEN ROUND(quantidade / ${area}::numeric, 4) >= 10000000000 THEN NULL
        ELSE ROUND(quantidade / ${area}::numeric, 4)
      END,
      "updatedAt" = now()
    WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND apontamento_id = ${apontamentoId} AND status = 'CONFIRMADO'`;

/**
 * Produtos já usados em linhas CONFIRMADO da atividade (os "favoritos" do
 * seletor), do mais usado para o menos usado.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<string[]>}
 */
export const produtosUsadosNaAtividade = async (db, clienteId, empresaId, atividadeId) => {
  const linhas = /** @type {Array<{ produto_id: string }>} */ (
    await db.$queryRaw`SELECT p.produto_id
      FROM "AtividadeApontamentoProduto" p
      JOIN "AtividadeApontamento" a ON a.cliente_id = p.cliente_id AND a.id = p.apontamento_id
      WHERE p.cliente_id = ${clienteId} AND p.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId} AND p.status = 'CONFIRMADO'
      GROUP BY p.produto_id
      ORDER BY COUNT(*) DESC, MAX(p."createdAt") DESC, p.produto_id`
  );
  return linhas.map((l) => l.produto_id);
};

/**
 * Totais por produto das linhas CONFIRMADO de apontamentos CONFIRMADO da
 * atividade (Σ quantidade e Σ custo_total), com o nome e a unidade da linha.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<Array<{ produto_id: string, nome: string, unidade: string, quantidade: string, custo_total: string }>>}
 */
export const totaisPorProduto = (db, clienteId, empresaId, atividadeId) =>
  db.$queryRaw`SELECT p.produto_id, pr.nome_produto AS nome, p.unidade,
      SUM(p.quantidade)::text AS quantidade, SUM(p.custo_total)::text AS custo_total
    FROM "AtividadeApontamentoProduto" p
    JOIN "AtividadeApontamento" a ON a.cliente_id = p.cliente_id AND a.id = p.apontamento_id
    JOIN "Produto" pr ON pr.cliente_id = p.cliente_id AND pr.id = p.produto_id
    WHERE p.cliente_id = ${clienteId} AND p.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
      AND p.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
    GROUP BY p.produto_id, pr.nome_produto, p.unidade
    ORDER BY pr.nome_produto, p.produto_id, p.unidade`;
