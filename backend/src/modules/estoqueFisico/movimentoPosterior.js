/**
 * D-PROD-264 / D-PROD-267 — "nada mexeu depois": o primeiro movimento do produto naquele depósito (entrada,
 * saída, transferência de/para, estorno) posterior a um movimento dado. Usado pela exclusão da saída manual e
 * do ajuste de inventário (escolha do proprietário: só exclui se nada mexeu depois). Chamar sob a trava do
 * produto (`travarProdutosEstoque`).
 *
 * "Depois" é fail-closed por dois critérios, qualquer um basta: o instante de criação igual ou posterior, ou
 * o número sequencial do movimento (dado sob a mesma trava do produto, logo na ordem real) maior. Número que
 * não é sequencial (movimento antigo, de antes da numeração do motor) só conta pelo instante.
 * @param {any} tx @param {string} cli @param {string} empresaId
 * @param {{ movimentoId: string, produtoId: string, localId: string }} a
 * @returns {Promise<string|null>} o número do primeiro movimento posterior, ou null
 */
export const movimentoPosteriorNoDeposito = async (tx, cli, empresaId, a) => {
  const [original] = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, numero_movimentacao, "createdAt" FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND id = ${a.movimentoId}`);
  if (!original) throw new Error(`movimentoPosteriorNoDeposito: movimento ${a.movimentoId} inexistente`);
  const depois = /** @type {any[]} */ (await tx.$queryRaw`SELECT m.numero_movimentacao FROM "MovimentacaoEstoque" m
    WHERE m.cliente_id = ${cli} AND m.empresa_id = ${empresaId} AND m.produto_id = ${a.produtoId} AND m.id <> ${original.id}
      AND (m.local_estoque_origem = ${a.localId} OR m.local_estoque_destino = ${a.localId})
      AND (m."createdAt" >= ${original.createdAt}
        OR (m.numero_movimentacao ~ '^[0-9]{1,30}$' AND ${original.numero_movimentacao} ~ '^[0-9]{1,30}$'
          AND m.numero_movimentacao::numeric > ${original.numero_movimentacao}::numeric))
    ORDER BY m."createdAt" DESC, m.id LIMIT 1`);
  return depois.length ? String(depois[0].numero_movimentacao) : null;
};
