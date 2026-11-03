/** API pública MovimentacaoMapa (P5.5). */
import {
  movimentacaoMapaPort,
  listarHistoricoMovimentacoesMapaPagina,
  cancelarMovimentacaoMapaNativa,
  elegibilidadeCancelamentoMovimentacaoMapaNativa,
  executarManejoRebanhoNativo,
  executarJuncaoLotesNativo,
  executarBaixaRebanhoNativo,
  listarPosicoesRebanhoNativo,
  executarTransferenciaLedgerNativo,
} from './movimentacaoMapaNativePort.js';

export const listMovimentacoesMapaNativas = (...args) => movimentacaoMapaPort.list(...args);
export const filterMovimentacoesMapaNativas = (...args) => movimentacaoMapaPort.filter(...args);
export const createMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.create(...args);
export const updateMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.update(...args);
export const deleteMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.delete(...args);
export const listHistoricoMovimentacoesMapaNativo = (filtros) => listarHistoricoMovimentacoesMapaPagina(filtros);
export const cancelarMovimentacaoMapa = (id, corpo) => cancelarMovimentacaoMapaNativa(id, corpo);
export const elegibilidadeCancelamentoMovimentacaoMapa = (id) => elegibilidadeCancelamentoMovimentacaoMapaNativa(id);
export const executarManejoRebanho = (corpo) => executarManejoRebanhoNativo(corpo);
export const executarJuncaoLotes = (corpo) => executarJuncaoLotesNativo(corpo);
export const executarBaixaRebanho = (corpo) => executarBaixaRebanhoNativo(corpo);
export const listarPosicoesRebanho = (empresaId) => listarPosicoesRebanhoNativo(empresaId);
export const executarTransferenciaLedger = (corpo) => executarTransferenciaLedgerNativo(corpo);
