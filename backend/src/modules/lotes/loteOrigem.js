/**
 * Origem do lote: entrada no rebanho × gerado por manejo.
 *
 * Lote gerado por manejo carrega cabeças que já estavam em outro lote
 * (movimentação parcial, reversão, mudança de categoria, recomposição por
 * edição de movimentação). Não é entrada no rebanho e não pode ser apagado
 * sozinho: a transferência que o originou referencia só o lote de ORIGEM, e
 * excluí-lo sumiria com as cabeças sem estorno. Nascimento é entrada de verdade.
 *
 * Mesma regra de `src/domain/lotes/saldoLote.js` (frontend); a paridade é
 * provada em `backend/tests/loteDerivadoIntegridade.test.mjs`.
 */

const ORIGENS_DERIVADAS_DE_MANEJO = Object.freeze(
  new Set(['MOVIMENTACAO', 'REVERSAO MOVIMENTACAO', 'MUDANCA DE CATEGORIA', 'EDICAO MOVIMENTACAO'])
);

/** @param {unknown} valor */
const semAcento = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

/**
 * @param {unknown} origem
 * @returns {boolean}
 */
export const origemDerivadaDeManejo = (origem) => ORIGENS_DERIVADAS_DE_MANEJO.has(semAcento(origem));
