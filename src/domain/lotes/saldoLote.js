/**
 * Entrada × movimentações × saldo atual de um lote — regra pura.
 *
 * Três números distintos, que a tela de cadastro misturava numa coluna só
 * ("Cabeças" = `quantidade_entrada`):
 *
 * - **Entrada (histórico):** `quantidade_entrada`, o retrato imutável do dia em
 *   que as cabeças ENTRARAM no rebanho (compra, ajuste, inventário, nascimento).
 *   Um lote criado por manejo (parte de uma movimentação, reversão ou mudança
 *   de categoria) não é entrada no rebanho: as cabeças já existiam no lote de
 *   origem. Contá-lo de novo somaria a mesma cabeça duas vezes — 500 + 50 = 550.
 * - **Saldo atual:** `quantidade_cabecas`, as cabeças que o lote tem hoje.
 * - **Movimentações (±):** saldo atual − entrada. Negativo na origem (−50),
 *   positivo no destino (+50). É sinal do fluxo, não estoque negativo.
 *
 * Invariante por lote e no total: entrada + movimentações = saldo atual.
 * Com o caso real (lote 1: entrada 500, saldo 450; lote 2 gerado pela
 * movimentação: saldo 50): entradas 500, movimentações −50 + 50 = 0, saldo 500.
 *
 * Nada aqui conhece React, rede ou storage.
 */

/** @param {unknown} valor */
const semAcento = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

/**
 * Origens de lote gerado por manejo a partir de cabeças que já estavam no
 * rebanho (comparadas sem acento e sem caixa). "EDIÇÃO MOVIMENTAÇÃO" é a
 * recomposição criada ao editar/desfazer uma movimentação
 * (`movimentacaoReconciliation`). Nascimento NÃO entra: são cabeças novas,
 * uma entrada de verdade. Mesma lista do servidor
 * (`backend/src/modules/lotes/loteOrigem.js`).
 */
const ORIGENS_DERIVADAS_DE_MANEJO = Object.freeze(
  new Set(['MOVIMENTACAO', 'REVERSAO MOVIMENTACAO', 'MUDANCA DE CATEGORIA', 'EDICAO MOVIMENTACAO'])
);

/**
 * Quantidade de cabeças como inteiro. Aceita número ou string numérica
 * (legado importado); vazio, nulo ou não-numérico vira 0.
 * @param {unknown} valor
 * @returns {number}
 */
export const quantidadeDeCabecas = (valor) => {
  if (valor === null || valor === undefined) return 0;
  const texto = typeof valor === 'string' ? valor.trim() : valor;
  if (texto === '') return 0;
  const n = Number(texto);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * O lote nasceu de um manejo sobre cabeças que já existiam?
 * @param {{ origem?: unknown } | null | undefined} lote
 */
export const ehLoteDerivadoDeManejo = (lote) => ORIGENS_DERIVADAS_DE_MANEJO.has(semAcento(lote?.origem));

/**
 * Cabeças que entraram no rebanho por este lote (0 para lote derivado).
 * @param {object | null | undefined} lote
 */
export const entradaHistoricaDoLote = (lote) =>
  ehLoteDerivadoDeManejo(lote) ? 0 : quantidadeDeCabecas(/** @type {any} */ (lote)?.quantidade_entrada);

/**
 * Cabeças que o lote tem hoje.
 * @param {object | null | undefined} lote
 */
export const saldoAtualDoLote = (lote) => quantidadeDeCabecas(/** @type {any} */ (lote)?.quantidade_cabecas);

/**
 * Variação líquida desde a entrada (saídas negativas, chegadas positivas).
 * @param {object | null | undefined} lote
 */
export const movimentacaoLiquidaDoLote = (lote) => saldoAtualDoLote(lote) - entradaHistoricaDoLote(lote);

/**
 * Totais de um conjunto de lotes. Soma cada cabeça física uma vez.
 * @param {Array<object | null | undefined>} lotes
 * @returns {{ lotes: number, entradas: number, movimentacoes: number, saldoAtual: number }}
 */
export const resumoDeCabecas = (lotes) =>
  (Array.isArray(lotes) ? lotes : []).reduce(
    (acc, lote) => ({
      lotes: acc.lotes + 1,
      entradas: acc.entradas + entradaHistoricaDoLote(lote),
      movimentacoes: acc.movimentacoes + movimentacaoLiquidaDoLote(lote),
      saldoAtual: acc.saldoAtual + saldoAtualDoLote(lote),
    }),
    { lotes: 0, entradas: 0, movimentacoes: 0, saldoAtual: 0 }
  );

/**
 * Variação com sinal explícito: "+50", "-50", "0".
 * @param {number} valor
 */
export const formatarVariacao = (valor) => {
  const n = quantidadeDeCabecas(valor);
  const abs = Math.abs(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return '0';
};
