/** API pública MovimentacaoMapa (P5.5). */
import {
  movimentacaoMapaPort,
  listarHistoricoMovimentacoesMapaPagina,
  cancelarMovimentacaoMapaNativa,
  elegibilidadeCancelamentoMovimentacaoMapaNativa,
  executarManejoLoteNativo,
  executarManejoRebanhoNativo,
} from './movimentacaoMapaNativePort.js';

export const listMovimentacoesMapaNativas = (...args) => movimentacaoMapaPort.list(...args);
export const filterMovimentacoesMapaNativas = (...args) => movimentacaoMapaPort.filter(...args);
export const createMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.create(...args);
export const updateMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.update(...args);
export const deleteMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.delete(...args);
export const listHistoricoMovimentacoesMapaNativo = (filtros) => listarHistoricoMovimentacoesMapaPagina(filtros);
export const cancelarMovimentacaoMapa = (id, corpo) => cancelarMovimentacaoMapaNativa(id, corpo);
export const elegibilidadeCancelamentoMovimentacaoMapa = (id) => elegibilidadeCancelamentoMovimentacaoMapaNativa(id);
export const executarManejoLote = (corpo) => executarManejoLoteNativo(corpo);
export const executarManejoRebanho = (corpo) => executarManejoRebanhoNativo(corpo);
