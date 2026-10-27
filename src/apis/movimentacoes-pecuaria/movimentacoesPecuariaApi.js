import { movimentacaoPecuariaPort } from './movimentacaoPecuariaNativePort.js';

export const listMovimentacoesPecuariaNativas = (...args) => movimentacaoPecuariaPort.list(...args);
export const filterMovimentacoesPecuariaNativas = (...args) => movimentacaoPecuariaPort.filter(...args);
