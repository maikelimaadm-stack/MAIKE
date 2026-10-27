/** API pública MovimentacaoMapa (P5.5). */
import { movimentacaoMapaPort } from './movimentacaoMapaNativePort.js';

export const listMovimentacoesMapaNativas = (...args) => movimentacaoMapaPort.list(...args);
export const filterMovimentacoesMapaNativas = (...args) => movimentacaoMapaPort.filter(...args);
export const createMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.create(...args);
export const updateMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.update(...args);
export const deleteMovimentacaoMapaNativa = (...args) => movimentacaoMapaPort.delete(...args);
