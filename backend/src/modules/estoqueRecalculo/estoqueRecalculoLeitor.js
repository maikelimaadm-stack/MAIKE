/**
 * D-PROD-273 (fatia 3) — LEITOR transacional SOMENTE LEITURA do replay.
 *
 * Toda função recebe um `tx` aberto por `emLeituraSomente` (REPEATABLE READ + `SET TRANSACTION READ ONLY`: o
 * PostgreSQL recusa qualquer escrita nela e todas as leituras veem o mesmo instante). Sem trava de produto: a
 * prévia não escreve, e a foto consistente basta para ela (a fatia de escrita relerá tudo sob a trava).
 * Toda consulta começa por `cliente_id` (R10/R11: o tenant vem do `auth_context` de quem chama).
 */
import { AppError } from '../../shared/errors/AppError.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { MODO_CUSTO_MEDIO, ORIGEM_AJUSTE_ESTOQUE, TIPO_FALTA_AJUSTE, TIPO_SOBRA_AJUSTE } from '../estoqueFisico/estoqueFisicoMotor.js';
import { MARCA_EXCLUSAO_RECALCULO } from '../estoqueFisico/movimentoPosterior.js';

/** Teto fail-closed de leitura: movimentos do produto na empresa (todos os depósitos e situações). */
export const TETO_MOVIMENTOS_PRODUTO = 20000;
/** Teto fail-closed de movimentos afetados (lançados depois do excluído) que a simulação reprocessa. */
export const TETO_MOVIMENTOS_AFETADOS = 5000;

const LEITURA = Object.freeze({ maxWait: 2000, timeout: 20000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

/**
 * Abre a transação de leitura (nada gravável) e roda `fn(tx)`.
 * @template T @param {(tx: any) => Promise<T>} fn @param {{ timeout?: number }} [o] @returns {Promise<T>}
 */
export const emLeituraSomente = (fn, o = {}) =>
  emTransacao({ ...LEITURA, ...(o.timeout ? { timeout: o.timeout } : {}) }, async (tx) => {
    await tx.$queryRaw`SET TRANSACTION READ ONLY`;
    return fn(tx);
  });

export const volumeExcedido = (details) =>
  new AppError('ESTOQUE_RECALCULO_VOLUME_EXCEDIDO', 'o produto tem movimentos demais para recalcular de uma vez; nada foi lido além da contagem e nada foi gravado', {
    details: { field: 'movimento_id', reason: 'volume_excedido', ...details },
  });

const COLUNAS_MOVIMENTO = {
  id: true, empresa_id: true, produto_id: true, numero_movimentacao: true, createdAt: true, tipo_movimentacao: true, tipo_detalhado: true,
  origem_sistema: true, status: true, quantidade: true, valor_unitario: true, valor_total: true, local_estoque_origem: true,
  local_estoque_destino: true, saldo_antes: true, saldo_depois: true, custo_medio_antes: true, custo_medio_depois: true,
  modo_saida_fifo: true, lotes_consumidos: true, movimento_pai_id: true, movimento_filho_id: true, lancamento_origem_id: true,
  movimentacao_grupo_id: true,
};
const COLUNAS_CAMADA = {
  id: true, local_estoque_id: true, data_documento: true, createdAt: true, custo_unitario: true, quantidade_entrada: true,
  quantidade_disponivel: true, status: true, movimentacao_entrada_id: true,
  // D-PROD-273 (fatia 4): a procedência e os nomes para criar a camada de destino de uma transferência recalculada.
  numero_documento: true, serie_documento: true, fornecedor_id: true, fornecedor_nome: true, local_estoque_nome: true, produto_nome: true,
  // D-PROD-282: o lote e a validade (a camada de destino recalculada os copia; a sobra de lote fica no custo gravado).
  lote_fabricante: true, data_validade: true,
};

/**
 * Corte do custo médio no tenant (D-PROD-256): o 1º movimento gravado com `modo_saida_fifo = 'CUSTO_MEDIO'`.
 * Sem nenhum: +Infinity se há saída FIFO (tudo é anterior), −Infinity se não há (tudo segue a regra atual).
 * @param {any} tx @param {string} cli
 * @returns {Promise<number>} instante em ms
 */
export const lerCorteCustoMedio = async (tx, cli) => {
  const [r] = /** @type {any[]} */ (await tx.$queryRaw`SELECT
      (SELECT min("createdAt") FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND modo_saida_fifo = ${MODO_CUSTO_MEDIO}) AS corte,
      EXISTS (SELECT 1 FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND tipo_movimentacao = 'Saída' AND modo_saida_fifo = 'FIFO') AS tem_fifo`);
  if (r?.corte) return new Date(r.corte).getTime();
  return r?.tem_fifo ? Infinity : -Infinity;
};

/**
 * Todo o histórico de UM produto numa empresa: movimentos (qualquer situação) e camadas. Conta antes de ler;
 * acima do teto, recusa sem ler as linhas.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string} produtoId
 * @param {{ teto?: number, cutover?: number|null }} [o]
 */
export const lerHistoricoDoProduto = async (tx, cli, empresaId, produtoId, o = {}) => {
  const teto = o.teto ?? TETO_MOVIMENTOS_PRODUTO;
  const total = await tx.movimentacaoEstoque.count({ where: { cliente_id: cli, empresa_id: empresaId, produto_id: produtoId } });
  if (total > teto) throw volumeExcedido({ movimentos: total, teto });
  const movimentos = await tx.movimentacaoEstoque.findMany({ where: { cliente_id: cli, empresa_id: empresaId, produto_id: produtoId }, select: COLUNAS_MOVIMENTO });
  const camadas = await tx.estoqueLoteNota.findMany({ where: { cliente_id: cli, empresa_id: empresaId, produto_id: produtoId }, select: COLUNAS_CAMADA });
  const cutover = o.cutover === undefined || o.cutover === null ? await lerCorteCustoMedio(tx, cli) : o.cutover;
  // D-PROD-272: a linha do ajuste de cada sobra/falta do produto diz se o custo da sobra foi informado (sem saldo).
  const ajustes = await tx.ajusteEstoqueItem.findMany({
    where: { cliente_id: cli, empresa_id: empresaId, produto_id: produtoId, movimentacao_estoque_id: { not: null } },
    select: { movimentacao_estoque_id: true, custo_informado: true },
  });
  return { movimentos, camadas, cutover, ajustes };
};

/**
 * Dependentes FORA do estoque que copiaram o custo dos movimentos `ids` (SPEC §3). Só identifica (tipo, id,
 * movimento): o recálculo deles é das fatias 4 e 5.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string[]} ids
 * @returns {Promise<Array<{ tipo: string, id: string, movimento_id: string, documento_id?: string|null }>>}
 */
export const lerDependentes = async (tx, cli, empresaId, ids) => {
  if (!ids.length) return [];
  const base = { cliente_id: cli, empresa_id: empresaId, movimentacao_estoque_id: { in: ids } };
  const saidas = await tx.saidaEstoqueItem.findMany({ where: base, select: { id: true, saida_id: true, movimentacao_estoque_id: true } });
  const abastecimentos = await tx.abastecimentoBem.findMany({ where: base, select: { id: true, movimentacao_estoque_id: true } });
  const itens = await tx.operacaoFinanceiraItem.findMany({ where: base, select: { id: true, operacao_id: true, movimentacao_estoque_id: true } });
  const consumosAbast = abastecimentos.length
    ? await tx.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: cli, empresa_id: empresaId, abastecimento_id: { in: abastecimentos.map((a) => a.id) } }, select: { id: true, abastecimento_id: true } })
    : [];
  const consumosItem = itens.length
    ? await tx.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: cli, empresa_id: empresaId, item_id: { in: itens.map((i) => i.id) } }, select: { id: true, item_id: true } })
    : [];
  const ajustes = await tx.ajusteEstoqueItem.findMany({ where: base, select: { id: true, ajuste_id: true, movimentacao_estoque_id: true } });
  const eventos = /** @type {Array<{ id: string, movimento_id: string }>} */ (await tx.$queryRaw`SELECT id, dados->>'movimentacao_estoque_id' AS movimento_id
      FROM "SuplementacaoEvento" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND dados->>'movimentacao_estoque_id' = ANY(${ids}::text[]) ORDER BY id`);
  const movDe = (lista, chave) => new Map(lista.map((x) => [x.id, x[chave]]));
  const movAbast = movDe(abastecimentos, 'movimentacao_estoque_id');
  const movItem = movDe(itens, 'movimentacao_estoque_id');
  const saida = [
    ...saidas.map((x) => ({ tipo: 'SaidaEstoqueItem', id: x.id, movimento_id: x.movimentacao_estoque_id, documento_id: x.saida_id })),
    ...abastecimentos.map((x) => ({ tipo: 'AbastecimentoBem', id: x.id, movimento_id: /** @type {string} */ (x.movimentacao_estoque_id), documento_id: null })),
    ...consumosAbast.map((x) => ({ tipo: 'AbastecimentoBemConsumoLote', id: x.id, movimento_id: /** @type {string} */ (movAbast.get(x.abastecimento_id)), documento_id: x.abastecimento_id })),
    ...itens.map((x) => ({ tipo: 'OperacaoFinanceiraItem', id: x.id, movimento_id: /** @type {string} */ (x.movimentacao_estoque_id), documento_id: x.operacao_id })),
    ...consumosItem.map((x) => ({ tipo: 'OperacaoFinanceiraConsumoLote', id: x.id, movimento_id: /** @type {string} */ (movItem.get(x.item_id)), documento_id: x.item_id })),
    ...eventos.map((x) => ({ tipo: 'SuplementacaoEvento', id: x.id, movimento_id: x.movimento_id, documento_id: null })),
    ...ajustes.map((x) => ({ tipo: 'AjusteEstoqueItem', id: x.id, movimento_id: /** @type {string} */ (x.movimentacao_estoque_id), documento_id: x.ajuste_id })),
  ];
  return saida.sort((a, b) => (a.tipo + a.id < b.tipo + b.id ? -1 : 1));
};

/**
 * D-PROD-273 × D-PROD-272 (escolha do proprietário, 2026-11-23) — a primeira SOBRA/FALTA de ajuste de inventário
 * VIGENTE (`Ativa`, sem estorno: ajuste não excluído) do produto nos `locais`, DEPOIS da referência `desde`, fora de
 * `ignorarIds` e dos pares excluídos com recálculo. "Depois" é o critério fail-closed de `buscarMovimentoPosterior`
 * (`createdAt` igual ou posterior, número não numérico, ou número maior). Com uma, a exclusão é recusada: o estoque
 * nunca fica diferente do contado. Traz o número do ajuste (`lancamento_origem_id` → `AjusteEstoque`).
 * @param {any} tx @param {string} cli
 * @param {{ empresaId: string, produtoId: string, locais: string[], ignorarIds?: string[], desde: { createdAt: Date, numero: string|null } }} a
 * @returns {Promise<{ movimento_id: string, movimento_numero: string, local_estoque_id: string, ajuste_id: string|null, ajuste_numero: string|null }|null>}
 */
export const buscarAjustePosterior = async (tx, cli, a) => {
  const locais = [...new Set((a.locais ?? []).filter((v) => typeof v === 'string' && v))];
  const ignorar = [...new Set((a.ignorarIds ?? []).filter((v) => typeof v === 'string' && v))];
  if (!locais.length) return null;
  const numero = a.desde.numero ?? '';
  const [m] = /** @type {any[]} */ (await tx.$queryRaw`SELECT m.id, m.numero_movimentacao, COALESCE(m.local_estoque_destino, m.local_estoque_origem) AS local_id,
        m.lancamento_origem_id, aj.numero AS ajuste_numero
      FROM "MovimentacaoEstoque" m
      LEFT JOIN "AjusteEstoque" aj ON aj.cliente_id = m.cliente_id AND aj.id = m.lancamento_origem_id
      WHERE m.cliente_id = ${cli} AND m.empresa_id = ${a.empresaId} AND m.produto_id = ${a.produtoId} AND m.id <> ALL(${ignorar}::text[])
        AND m.origem_sistema = ${ORIGEM_AJUSTE_ESTOQUE} AND m.tipo_detalhado = ANY(${[TIPO_SOBRA_AJUSTE, TIPO_FALTA_AJUSTE]}::text[])
        AND m.status = 'Ativa' AND m.movimento_filho_id IS NULL
        AND (m.local_estoque_origem = ANY(${locais}::text[]) OR m.local_estoque_destino = ANY(${locais}::text[]))
        AND NOT starts_with(COALESCE(m.movimentacao_grupo_id, ''), ${MARCA_EXCLUSAO_RECALCULO})
        AND (m."createdAt" >= ${a.desde.createdAt}
          OR m.numero_movimentacao !~ '^[0-9]{1,30}$'
          OR (${numero} ~ '^[0-9]{1,30}$' AND m.numero_movimentacao::numeric > ${numero}::numeric))
      ORDER BY m."createdAt", m.id LIMIT 1`);
  return m ? { movimento_id: m.id, movimento_numero: m.numero_movimentacao, local_estoque_id: m.local_id, ajuste_id: m.lancamento_origem_id ?? null, ajuste_numero: m.ajuste_numero ?? null } : null;
};
