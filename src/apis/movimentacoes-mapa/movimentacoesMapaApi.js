/** API pública MovimentacaoMapa (P5.5). */
import {
  movimentacaoMapaPort,
  listarHistoricoMovimentacoesMapaPagina,
  cancelarMovimentacaoMapaNativa,
  elegibilidadeCancelamentoMovimentacaoMapaNativa,
  excluirMovimentacaoMapaNativa,
  elegibilidadeExclusaoMovimentacaoMapaNativa,
  removerMovimentacaoDosCachesOffline as removerDosCachesOfflineNativo,
  pendenciasOfflineDaMovimentacao as pendenciasOfflineNativas,
  eventoMudancaFilaOffline as eventoMudancaFilaOfflineNativo,
  executarManejoRebanhoNativo,
  executarJuncaoLotesNativo,
  executarBaixaRebanhoNativo,
  listarPosicoesRebanhoNativo,
  executarTransferenciaLedgerNativo,
  editarInformacaoPosicaoNativo,
} from './movimentacaoMapaNativePort.js';

export const listMovimentacoesMapaNativas = (...args) => movimentacaoMapaPort.list(...args);
export const filterMovimentacoesMapaNativas = (...args) => movimentacaoMapaPort.filter(...args);
export const createMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.create(...args);
export const updateMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.update(...args);
export const deleteMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.delete(...args);
export const listHistoricoMovimentacoesMapaNativo = (filtros) => listarHistoricoMovimentacoesMapaPagina(filtros);
export const cancelarMovimentacaoMapa = (id, corpo) => cancelarMovimentacaoMapaNativa(id, corpo);
export const elegibilidadeCancelamentoMovimentacaoMapa = (id) => elegibilidadeCancelamentoMovimentacaoMapaNativa(id);
export const excluirMovimentacaoMapa = (id, corpo) => excluirMovimentacaoMapaNativa(id, corpo);
export const elegibilidadeExclusaoMovimentacaoMapa = (id, opcoes) => elegibilidadeExclusaoMovimentacaoMapaNativa(id, opcoes);
export const removerMovimentacaoDosCachesOffline = (id) => removerDosCachesOfflineNativo(id);
export const pendenciasOfflineDaMovimentacao = (id) => pendenciasOfflineNativas(id);
export const eventoMudancaFilaOffline = () => eventoMudancaFilaOfflineNativo();
export const executarManejoRebanho = (corpo) => executarManejoRebanhoNativo(corpo);
export const executarJuncaoLotes = (corpo) => executarJuncaoLotesNativo(corpo);
export const executarBaixaRebanho = (corpo) => executarBaixaRebanhoNativo(corpo);
export const listarPosicoesRebanho = (empresaId) => listarPosicoesRebanhoNativo(empresaId);
export const executarTransferenciaLedger = (corpo) => executarTransferenciaLedgerNativo(corpo);
export const editarInformacaoPosicao = (posicaoId, corpo) => editarInformacaoPosicaoNativo(posicaoId, corpo);
