import { AppError } from '../../shared/errors/AppError.js';
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

/**
 * PR174-R4 (D-PROD-107): o cadastro de Lote é SÓ de entradas. Nenhum manejo
 * (nem o modelo legado, antes da ativação do controle por posições) fabrica
 * linha nova no cadastro. Recusa estável; nada é gravado.
 * @param {Record<string, unknown>} [detalhes]
 */
export const recusarLoteFabricadoPorManejo = (detalhes = {}) => {
  throw new AppError('LOTE_CADASTRO_SOMENTE_ENTRADAS', 'o cadastro de lotes guarda só entradas; esta operação criaria um lote derivado. Ative o controle por posições nesta fazenda para registrá-la (nada foi gravado)', { details: detalhes });
};
