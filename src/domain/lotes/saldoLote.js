/**
 * Entrada no rebanho × saldo atual de um lote — regra pura (D-PROD-85).
 *
 * O Cadastro de Lotes é o lançamento da ENTRADA (como o recebimento de um
 * estoque). Movimentações são operações do Mapa Geral, com histórico próprio,
 * e não aparecem nem se fazem aqui.
 *
 * - **Quantidade de entrada:** `quantidade_entrada`, o retrato imutável do dia
 *   em que as cabeças ENTRARAM no rebanho (compra, ajuste, inventário,
 *   nascimento).
 * - **Lote gerado por manejo** (parte de uma movimentação, reversão, mudança de
 *   categoria ou recomposição) não é entrada: as cabeças já existiam no lote
 *   de origem. Contá-lo de novo somaria a mesma cabeça duas vezes (500 + 50).
 * - **Saldo atual:** `quantidade_cabecas`, as cabeças que o lote tem hoje.
 *   Dado informativo de leitura; muda só pelos manejos do mapa.
 *
 * Caso real: lote 1 entrou com 500 e tem 450; lote 2 (gerado pela
 * transferência) tem 50. Entradas no rebanho = 500; rebanho atual = 500.
 * A diferença saldo − entrada NÃO é um evento e não é exibida como tal.
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
 * O lote é uma entrada no rebanho (pertence ao Cadastro de Lotes)?
 * @param {object | null | undefined} lote
 */
export const ehEntradaNoRebanho = (lote) => !ehLoteDerivadoDeManejo(lote);

/**
 * Totais de um conjunto de lotes. Soma cada cabeça física uma vez.
 * @param {Array<object | null | undefined>} lotes
 * @returns {{ lotes: number, entradas: number, saldoAtual: number }}
 */
export const resumoDeCabecas = (lotes) =>
  (Array.isArray(lotes) ? lotes : []).reduce(
    (acc, lote) => ({
      lotes: acc.lotes + 1,
      entradas: acc.entradas + entradaHistoricaDoLote(lote),
      saldoAtual: acc.saldoAtual + saldoAtualDoLote(lote),
    }),
    { lotes: 0, entradas: 0, saldoAtual: 0 }
  );
