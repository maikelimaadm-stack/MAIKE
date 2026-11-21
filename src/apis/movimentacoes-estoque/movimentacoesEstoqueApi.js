/**
 * API pública de MovimentacaoEstoque (P5.4).
 *
 * D-PROD-161 (F3): sem create/delete genéricos — escrita só pelos comandos.
 */
import { movimentacaoEstoquePort } from './movimentacaoEstoqueNativePort.js';

export const listMovimentacoesEstoque = (ordenacao, limite) =>
  movimentacaoEstoquePort.list(ordenacao, limite);

export const updateMovimentacaoEstoque = (id, dados) => movimentacaoEstoquePort.update(id, dados);

export {
  comandoSaidaSuplementacao,
  comandoTransferenciaEntreLocais,
  cancelarTransferenciaEntreLocais,
  elegibilidadeCancelamentoTransferencia,
} from './movimentacaoEstoqueComandosApi.js';
