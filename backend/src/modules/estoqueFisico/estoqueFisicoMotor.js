/**
 * D-PROD-154 (Gestão P3-01) — motor de estoque FÍSICO composto (KG).
 *
 * Funções que RECEBEM `tx` (nunca abrem transação) e trabalham em Decimal ponta
 * a ponta. São a única porta de efeito físico do lançamento financeiro
 * confirmado/cancelado: entrada (compra), saída FIFO (venda) e os estornos.
 *
 * Regras (§3, §8.2, §8.4 do contrato):
 *  - estoque interno SEMPRE em KG; o planejador já entrega `kg` com 4 casas
 *    (ROUND_HALF_UP UMA vez) e o mesmo `kg` vale para item, lote, movimento,
 *    `estoque_atual`, consumo e estorno;
 *  - `travarProdutosEstoque` antes de QUALQUER leitura de produto/lote e antes
 *    de qualquer UPDATE em movimento (evita lost update com a suplementação e o
 *    ciclo com `/referencias/sincronizar`, que faz FOR SHARE no Produto);
 *  - sequência (`reservarNumero[s]`) só DEPOIS da trava de produtos;
 *  - `estoque_atual` só por `{increment}`/`{decrement}`, conferindo o resultado;
 *  - lote baixado/devolvido por compare-and-set (CAS) sobre o valor lido sob
 *    trava: um escritor fora do protocolo vira 409, nunca saldo fantasma;
 *  - nada aqui altera `preco_custo`.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { travarEscopo } from '../gestao/gestaoComum.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, LIMITE_ESTOQUE, ZERO, arredondar, dec, paraBanco, somar } from '../financeiro/decimalFinanceiro.js';

export const ENTIDADE_MOVIMENTO = 'MovimentacaoEstoque';
export const ORIGEM_SISTEMA = 'operacao_financeira';

/** Chave da trava por produto (a mesma em TODOS os escritores de estoque). */
export const chaveTravaProduto = (clienteId, empresaId, produtoId) => `estoque:produto:${clienteId}:${empresaId}:${produtoId}`;

/**
 * Trava os produtos (advisory lock por produto em ordem crescente de id + a
 * linha do Produto `FOR UPDATE`, também em ordem). Chamar logo depois da trava
 * do cabeçalho do documento e antes de qualquer leitura de produto ou lote.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {Array<string|null|undefined>} produtoIds
 * @returns {Promise<string[]>} ids travados, em ordem
 */
export const travarProdutosEstoque = async (tx, clienteId, empresaId, produtoIds) => {
  const ids = [...new Set((produtoIds ?? []).filter((v) => typeof v === 'string' && v).map(String))].sort();
  for (const id of ids) await travarEscopo(tx, chaveTravaProduto(clienteId, empresaId, id));
  if (ids.length) {
    await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  }
  return ids;
};

/** Dia `AAAA-MM-DD` → Date do banco (@db.Date). */
const comoDia = (dia) => new Date(`${dia}T00:00:00.000Z`);
/** Instante do movimento: meio-dia UTC do dia operacional (convenção do estoque). */
const instanteDoDia = (dia) => new Date(`${dia}T12:00:00.000Z`);

/**
 * Ordem FIFO idêntica à de `movimentacoesEstoque/fifoEstoque.js`: chave
 * `COALESCE(data_documento, createdAt)` crescente, desempate por id.
 * @template {{ id: string, data_documento?: Date|null, createdAt: Date }} T
 * @param {T[]} lotes
 * @returns {T[]}
 */
export const ordenarFifo = (lotes) =>
  [...lotes].sort((a, b) => {
    const ta = (a.data_documento ?? a.createdAt).getTime();
    const tb = (b.data_documento ?? b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

/**
 * O tradutor HTTP só expõe `reason` junto de `field` (ambos strings): toda
 * recusa de linha leva os dois (padrão `quantidade` do item) + colecao/indice.
 */
const comCampo = (details) => ({ field: 'quantidade', ...details });

const excedeLimiteEstoque = (details) =>
  new AppError('OPERACAO_VALORES_INVALIDOS', 'valor ou quantidade acima do limite das colunas de estoque (9.999.999.999,9999); nada foi gravado', {
    details: comCampo({ reason: 'valor_excede_limite_estoque', ...details }),
  });

const conflitoDeEstoque = (details) =>
  new AppError('CONCURRENCY_CONFLICT', 'o estoque do lote mudou durante a operação; tente de novo com a mesma operation_id', { details });

/** Σ dos lotes Disponivel do produto NAQUELE local e empresa (saldo por local). */
const saldoNoLocal = async (tx, clienteId, empresaId, produtoId, localId) => {
  const r = await tx.estoqueLoteNota.aggregate({
    _sum: { quantidade_disponivel: true },
    where: { cliente_id: clienteId, empresa_id: empresaId, produto_id: produtoId, local_estoque_id: localId, status: 'Disponivel' },
  });
  return r._sum.quantidade_disponivel == null ? ZERO : dec(r._sum.quantidade_disponivel);
};

/** `estoque_atual` relido (cada item repetido relê o estado sob a mesma trava). */
const estoqueAtualDe = async (tx, clienteId, produtoId) => {
  const p = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: produtoId } }, select: { estoque_atual: true } });
  if (!p) throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado neste tenant');
  return dec(p.estoque_atual);
};

const numeroDoMovimento = async (tx, clienteId, numero) =>
  numero !== undefined && numero !== null
    ? String(numero)
    : String(await reservarNumero(tx, { clienteId, entidade: ENTIDADE_MOVIMENTO, escopoTipo: ESCOPO_TENANT }));

const camposDoProduto = (produto) => ({
  produto_id: produto.id,
  produto_nome: produto.nome_produto ?? null,
  produto_codigo: produto.codigo_interno || produto.codigo_barras || '',
  produto_categoria: produto.categoria ?? null,
});

const camposComuns = (auth, a) => ({
  cliente_id: auth.clienteId,
  empresa_id: a.empresaId,
  ...camposDoProduto(a.produto),
  unidade_medida: 'KG',
  numero_documento: a.documento?.numero ?? null,
  data_documento: a.documento?.data ? comoDia(a.documento.data) : null,
  lancamento_origem_id: a.origem.operacaoId,
  origem_sistema: ORIGEM_SISTEMA,
  bloqueado_exclusao_estoque: true,
  exclusao_somente_em: ORIGEM_SISTEMA,
  is_registro_principal: true,
  numero_movimentacao_seq: 1,
  total_movimentacoes_grupo: 1,
  usuario_responsavel: auth.login || 'Sistema',
  status: 'Ativa',
});

const decrementarEstoqueAtual = async (tx, clienteId, produtoId, kg, erroSeNegativo) => {
  const depois = await tx.produto.update({
    where: { cliente_id_id: { cliente_id: clienteId, id: produtoId } },
    data: { estoque_atual: { decrement: paraBanco(kg, CASAS_QUANTIDADE) } },
    select: { estoque_atual: true },
  });
  const valor = dec(depois.estoque_atual);
  if (valor.lt(0)) throw erroSeNegativo(valor);
  return valor;
};

const incrementarEstoqueAtual = async (tx, clienteId, produtoId, kg) => {
  const depois = await tx.produto.update({
    where: { cliente_id_id: { cliente_id: clienteId, id: produtoId } },
    data: { estoque_atual: { increment: paraBanco(kg, CASAS_QUANTIDADE) } },
    select: { estoque_atual: true },
  });
  return dec(depois.estoque_atual);
};

/**
 * ENTRADA (compra confirmada): lote novo + movimento 'Entrada' ligado ao lote +
 * `estoque_atual += kg`. Custo do lote = custo por kg do item (o desconto e o
 * acréscimo do cabeçalho NÃO entram no custo nesta fase).
 * @param {any} tx
 * @param {{auth: any, requestId?: string}} ctx
 * @param {{ empresaId: string, produto: any, local: {id: string, nome: string}, quantidadeKg: any, custoUnitarioKg: any,
 *   valorTotal: any, dia: string, documento?: {numero?: string|null, data?: string|null}, parceiro?: {id?: string|null, nome?: string|null},
 *   origem: {operacaoId: string, tipoDetalhado?: string}, numeroMovimento?: string|number, contextoErro?: Record<string, unknown> }} a
 */
export const aplicarEntradaEstoque = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  const kg = dec(a.quantidadeKg);
  const custoKg = dec(a.custoUnitarioKg);
  const valorTotal = dec(a.valorTotal);
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  const extra = { produto_id: a.produto.id, ...(a.contextoErro ?? {}) };
  if (!kg.gt(0)) {
    throw new AppError('OPERACAO_VALORES_INVALIDOS', 'quantidade em kg deve ser maior que zero', { details: comCampo({ reason: 'quantidade_estoque_zero', ...extra }) });
  }
  if (kg.gt(LIMITE_ESTOQUE) || custoKg.gt(LIMITE_ESTOQUE) || valorTotal.gt(LIMITE_ESTOQUE) || estoqueAtual.plus(kg).gt(LIMITE_ESTOQUE)) {
    throw excedeLimiteEstoque({ ...extra, estoque_atual: estoqueAtual.toFixed(CASAS_QUANTIDADE), quantidade_kg: kg.toFixed(CASAS_QUANTIDADE) });
  }
  const saldoAntes = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.local.id);
  const numero = await numeroDoMovimento(tx, cli, a.numeroMovimento);
  const movimento = await tx.movimentacaoEstoque.create({
    data: {
      ...camposComuns(auth, a),
      numero_movimentacao: numero,
      tipo_movimentacao: 'Entrada',
      tipo_detalhado: a.origem.tipoDetalhado ?? 'compra_financeiro',
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: paraBanco(custoKg, CASAS_CUSTO),
      valor_total: paraBanco(valorTotal, CASAS_CUSTO),
      local_estoque_destino: a.local.id,
      local_destino: a.local.nome ?? null,
      fornecedor_id: a.parceiro?.id ?? null,
      fornecedor_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: 'Entrada por lançamento financeiro confirmado',
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.plus(kg), CASAS_QUANTIDADE),
    },
  });
  const lote = await tx.estoqueLoteNota.create({
    data: {
      cliente_id: cli,
      empresa_id: a.empresaId,
      produto_id: a.produto.id,
      produto_nome: a.produto.nome_produto ?? null,
      local_estoque_id: a.local.id,
      local_estoque_nome: a.local.nome ?? null,
      numero_documento: a.documento?.numero ?? null,
      data_documento: comoDia(a.dia),
      fornecedor_id: a.parceiro?.id ?? null,
      fornecedor_nome: a.parceiro?.nome ?? null,
      custo_unitario: paraBanco(custoKg, CASAS_CUSTO),
      quantidade_entrada: paraBanco(kg, CASAS_QUANTIDADE),
      quantidade_disponivel: paraBanco(kg, CASAS_QUANTIDADE),
      movimentacao_entrada_id: movimento.id,
      status: 'Disponivel',
    },
  });
  const estoqueDepois = await incrementarEstoqueAtual(tx, cli, a.produto.id, kg);
  return { lote, movimento, estoque_atual: estoqueDepois };
};

/**
 * Simulação FIFO pura (prévia e confirmação usam a mesma regra): consome os
 * lotes na ordem FIFO até `kg`. Não grava nada.
 * @param {Array<{ id: string, quantidade_disponivel: any, custo_unitario: any, data_documento?: Date|null, createdAt: Date }>} lotes
 * @param {any} kg
 */
export const consumirFifo = (lotes, kg) => {
  const pedido = dec(kg);
  const elegiveis = ordenarFifo(lotes.filter((l) => dec(l.quantidade_disponivel).gt(0)));
  const disponivel = somar(elegiveis.map((l) => l.quantidade_disponivel));
  /** @type {Array<{ lote_id: string, quantidade: any, custo_unitario: any, anterior: any }>} */
  const fatias = [];
  let restante = pedido;
  for (const l of elegiveis) {
    if (!restante.gt(0)) break;
    const disp = dec(l.quantidade_disponivel);
    const fatia = disp.lt(restante) ? disp : restante;
    fatias.push({ lote_id: l.id, quantidade: fatia, custo_unitario: dec(l.custo_unitario), anterior: disp });
    restante = restante.minus(fatia);
  }
  const suficiente = !restante.gt(0);
  const valorTotal = arredondar(somar(fatias.map((f) => f.quantidade.times(f.custo_unitario))), CASAS_CUSTO);
  const valorUnitario = pedido.gt(0) ? arredondar(valorTotal.dividedBy(pedido), CASAS_CUSTO) : ZERO;
  return { suficiente, disponivel, fatias, valorTotal, valorUnitario };
};

/** Lotes elegíveis ao FIFO de um produto num local de uma empresa. */
export const lotesFifo = (tx, clienteId, empresaId, produtoId, localId) =>
  tx.estoqueLoteNota.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, produto_id: produtoId, local_estoque_id: localId, status: 'Disponivel', quantidade_disponivel: { gt: 0 } },
    select: { id: true, quantidade_disponivel: true, quantidade_entrada: true, custo_unitario: true, data_documento: true, createdAt: true },
  });

export const saldoLoteInsuficiente = (details) =>
  new AppError('ESTOQUE_SALDO_INSUFICIENTE', 'saldo insuficiente nos lotes deste produto neste local; nada foi gravado', {
    details: comCampo({ reason: 'saldo_lote_insuficiente', ...details }),
  });

export const estoqueAtualInsuficiente = (details) =>
  new AppError('ESTOQUE_SALDO_INSUFICIENTE', 'o estoque atual do produto é menor que a quantidade pedida; nada foi gravado', {
    details: comCampo({ reason: 'estoque_atual_insuficiente', ...details }),
  });

/**
 * SAÍDA FIFO (venda confirmada): baixa os lotes Disponivel do produto + local +
 * empresa, cria UM movimento 'Saída' a CUSTO FIFO (nunca o preço de venda) e
 * `estoque_atual -= kg`. Devolve as fatias para `OperacaoFinanceiraConsumoLote`.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, produto: any, local: {id: string, nome: string}, quantidadeKg: any, dia: string,
 *   documento?: {numero?: string|null, data?: string|null}, parceiro?: {id?: string|null, nome?: string|null},
 *   origem: {operacaoId: string, tipoDetalhado?: string}, numeroMovimento?: string|number, contextoErro?: Record<string, unknown> }} a
 */
export const aplicarSaidaFifo = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  const kg = dec(a.quantidadeKg);
  const extra = { produto_id: a.produto.id, local_estoque_id: a.local.id, ...(a.contextoErro ?? {}) };
  const lotes = await lotesFifo(tx, cli, a.empresaId, a.produto.id, a.local.id);
  const fifo = consumirFifo(lotes, kg);
  if (!fifo.suficiente) {
    throw saldoLoteInsuficiente({ ...extra, disponivel: fifo.disponivel.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE) });
  }
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  if (estoqueAtual.lt(kg)) {
    throw estoqueAtualInsuficiente({ ...extra, estoque_atual: estoqueAtual.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE) });
  }
  if (fifo.valorTotal.gt(LIMITE_ESTOQUE)) throw excedeLimiteEstoque({ ...extra, valor_total: fifo.valorTotal.toFixed(CASAS_CUSTO) });
  const saldoAntes = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.local.id);
  const numero = await numeroDoMovimento(tx, cli, a.numeroMovimento);
  const movimento = await tx.movimentacaoEstoque.create({
    data: {
      ...camposComuns(auth, a),
      numero_movimentacao: numero,
      tipo_movimentacao: 'Saída',
      tipo_detalhado: a.origem.tipoDetalhado ?? 'venda_financeiro',
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: paraBanco(fifo.valorUnitario, CASAS_CUSTO),
      valor_total: paraBanco(fifo.valorTotal, CASAS_CUSTO),
      local_estoque_origem: a.local.id,
      local_origem: a.local.nome ?? null,
      cliente_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: 'Saída por lançamento financeiro confirmado',
      modo_saida_fifo: 'FIFO',
      lotes_consumidos: fifo.fatias.map((f) => ({
        lote_id: f.lote_id,
        quantidade: f.quantidade.toFixed(CASAS_QUANTIDADE),
        custo_unitario: f.custo_unitario.toFixed(CASAS_CUSTO),
      })),
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.minus(kg), CASAS_QUANTIDADE),
    },
  });
  for (const f of fifo.fatias) {
    const novo = f.anterior.minus(f.quantidade);
    const r = await tx.estoqueLoteNota.updateMany({
      where: { cliente_id: cli, id: f.lote_id, status: 'Disponivel', quantidade_disponivel: paraBanco(f.anterior, CASAS_QUANTIDADE) },
      data: { quantidade_disponivel: paraBanco(novo, CASAS_QUANTIDADE), status: novo.gt(0) ? 'Disponivel' : 'Esgotado' },
    });
    if (r.count !== 1) throw conflitoDeEstoque({ lote_id: f.lote_id });
  }
  await decrementarEstoqueAtual(tx, cli, a.produto.id, kg, (valor) =>
    estoqueAtualInsuficiente({ ...extra, estoque_atual: valor.plus(kg).toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE) })
  );
  return {
    movimento,
    fatias: fifo.fatias.map((f) => ({ lote_id: f.lote_id, quantidade: f.quantidade, custo_unitario: f.custo_unitario })),
    valor_total: fifo.valorTotal,
    valor_unitario: fifo.valorUnitario,
  };
};

/** Recusa do cancelamento: a linha é o item (colecao `itens`, índice 0-based). */
const jaConsumido = (mensagem, details) =>
  new AppError('ESTOQUE_JA_CONSUMIDO', mensagem, {
    details: { field: 'itens', colecao: 'itens', ...(Number.isInteger(details?.item_ordem) ? { indice: details.item_ordem - 1 } : {}), ...details },
  });

const movimentoOriginal = async (tx, clienteId, id) => {
  const m = id ? await tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } }) : null;
  if (!m) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque do item não encontrado');
  return m;
};

const marcarOriginalEstornado = (tx, clienteId, original, estorno) =>
  tx.movimentacaoEstoque.update({
    where: { cliente_id_id: { cliente_id: clienteId, id: original.id } },
    data: { status: 'Estornada', movimento_filho_id: estorno.id },
  });

/**
 * Estorno de ENTRADA (cancelamento de compra): exige o lote INTOCADO; zera o
 * lote (status 'Estornado'), cria 'Saída' `estorno_compra` ligada ao original
 * (pai/filho; original 'Estornada') e `estoque_atual -= kg`.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, item: any, produto: any, local: {id: string, nome: string}, dia: string,
 *   documento?: any, parceiro?: any, origem: {operacaoId: string}, numeroMovimento?: string|number }} a
 */
export const estornarEntrada = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  const kg = dec(a.item.quantidade_estoque);
  const base = { item_ordem: a.item.ordem, lote_id: a.item.estoque_lote_nota_id };
  const lote = a.item.estoque_lote_nota_id
    ? await tx.estoqueLoteNota.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: a.item.estoque_lote_nota_id } } })
    : null;
  if (!lote) throw jaConsumido('o lote de entrada deste item não existe mais; cancelamento recusado (nada foi alterado)', { ...base, reason: 'lote_inexistente' });
  const entrada = dec(lote.quantidade_entrada);
  const disponivel = dec(lote.quantidade_disponivel);
  if (lote.status !== 'Disponivel' || !disponivel.eq(entrada) || !entrada.eq(kg)) {
    throw jaConsumido('o estoque desta compra já foi consumido ou alterado; cancelamento recusado (nada foi alterado)', {
      ...base, reason: 'lote_consumido', entrada: entrada.toFixed(CASAS_QUANTIDADE), disponivel: disponivel.toFixed(CASAS_QUANTIDADE), status: lote.status,
    });
  }
  const original = await movimentoOriginal(tx, cli, a.item.movimentacao_estoque_id);
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  const semEstoque = (valor) =>
    jaConsumido('o estoque atual do produto é menor que a compra a estornar; cancelamento recusado (nada foi alterado)', {
      ...base, reason: 'estoque_atual_insuficiente', estoque_atual: valor.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE),
    });
  if (estoqueAtual.lt(kg)) throw semEstoque(estoqueAtual);
  const saldoAntes = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.local.id);
  const zerado = await tx.estoqueLoteNota.updateMany({
    where: { cliente_id: cli, id: lote.id, status: 'Disponivel', quantidade_disponivel: paraBanco(entrada, CASAS_QUANTIDADE) },
    data: { quantidade_disponivel: paraBanco(ZERO, CASAS_QUANTIDADE), status: 'Estornado' },
  });
  if (zerado.count !== 1) throw jaConsumido('o lote mudou durante o cancelamento; nada foi alterado', { ...base, reason: 'lote_consumido' });
  const numero = await numeroDoMovimento(tx, cli, a.numeroMovimento);
  const estorno = await tx.movimentacaoEstoque.create({
    data: {
      ...camposComuns(auth, a),
      numero_movimentacao: numero,
      tipo_movimentacao: 'Saída',
      tipo_detalhado: 'estorno_compra',
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: original.valor_unitario,
      valor_total: original.valor_total,
      local_estoque_origem: a.local.id,
      local_origem: a.local.nome ?? null,
      fornecedor_id: a.parceiro?.id ?? null,
      fornecedor_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: 'Estorno de compra por cancelamento do lançamento financeiro',
      movimento_pai_id: original.id,
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.minus(kg), CASAS_QUANTIDADE),
    },
  });
  await marcarOriginalEstornado(tx, cli, original, estorno);
  await decrementarEstoqueAtual(tx, cli, a.produto.id, kg, (valor) => semEstoque(valor.plus(kg)));
  return { movimento: estorno };
};

/**
 * Estorno de SAÍDA (cancelamento de venda): devolve cada fatia ao SEU lote
 * (recusa lote que não esteja 'Disponivel'/'Esgotado' — ex.: 'Estornado' — e
 * devolução acima da entrada), cria 'Entrada' `estorno_venda` ligada ao
 * original e `estoque_atual += kg`.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, item: any, consumos: Array<{estoque_lote_nota_id: string, quantidade: any}>, produto: any,
 *   local: {id: string, nome: string}, dia: string, documento?: any, parceiro?: any, origem: {operacaoId: string},
 *   numeroMovimento?: string|number }} a
 */
export const estornarSaida = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  const kg = dec(a.item.quantidade_estoque);
  const devolvido = somar(a.consumos.map((c) => c.quantidade));
  if (!devolvido.eq(kg)) {
    throw jaConsumido('as fatias FIFO gravadas não somam a quantidade do item; cancelamento recusado', { item_ordem: a.item.ordem, reason: 'fatias_inconsistentes' });
  }
  const original = await movimentoOriginal(tx, cli, a.item.movimentacao_estoque_id);
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  if (estoqueAtual.plus(kg).gt(LIMITE_ESTOQUE)) {
    throw excedeLimiteEstoque({ colecao: 'itens', indice: a.item.ordem - 1, item_ordem: a.item.ordem, produto_id: a.produto.id });
  }
  const saldoAntes = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.local.id);
  for (const c of a.consumos) {
    const lote = await tx.estoqueLoteNota.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: c.estoque_lote_nota_id } } });
    const base = { item_ordem: a.item.ordem, lote_id: c.estoque_lote_nota_id };
    if (!lote || !['Disponivel', 'Esgotado'].includes(lote.status)) {
      throw jaConsumido('um lote desta venda não pode receber a devolução (lote estornado ou removido); cancelamento recusado', {
        ...base, reason: 'lote_indisponivel_para_devolucao', status: lote?.status ?? null,
      });
    }
    const disp = dec(lote.quantidade_disponivel);
    const novo = disp.plus(dec(c.quantidade));
    if (novo.gt(dec(lote.quantidade_entrada))) {
      throw jaConsumido('a devolução ultrapassaria a entrada do lote; cancelamento recusado', {
        ...base, reason: 'devolucao_excede_entrada', entrada: dec(lote.quantidade_entrada).toFixed(CASAS_QUANTIDADE), disponivel: disp.toFixed(CASAS_QUANTIDADE),
      });
    }
    const r = await tx.estoqueLoteNota.updateMany({
      where: { cliente_id: cli, id: lote.id, status: lote.status, quantidade_disponivel: paraBanco(disp, CASAS_QUANTIDADE) },
      data: { quantidade_disponivel: paraBanco(novo, CASAS_QUANTIDADE), status: 'Disponivel' },
    });
    if (r.count !== 1) throw conflitoDeEstoque({ lote_id: lote.id });
  }
  const numero = await numeroDoMovimento(tx, cli, a.numeroMovimento);
  const estorno = await tx.movimentacaoEstoque.create({
    data: {
      ...camposComuns(auth, a),
      numero_movimentacao: numero,
      tipo_movimentacao: 'Entrada',
      tipo_detalhado: 'estorno_venda',
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: original.valor_unitario,
      valor_total: original.valor_total,
      local_estoque_destino: a.local.id,
      local_destino: a.local.nome ?? null,
      cliente_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: 'Estorno de venda por cancelamento do lançamento financeiro',
      movimento_pai_id: original.id,
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.plus(kg), CASAS_QUANTIDADE),
    },
  });
  await marcarOriginalEstornado(tx, cli, original, estorno);
  await incrementarEstoqueAtual(tx, cli, a.produto.id, kg);
  return { movimento: estorno };
};
