import { suplementacaoEventoPort } from './suplementacaoEventoNativePort.js';

export const listSuplementacaoEventosNativos = (...args) => suplementacaoEventoPort.list(...args);
export const filterSuplementacaoEventosNativos = (...args) => suplementacaoEventoPort.filter(...args);
export const createSuplementacaoEventoNativo = (...args) => suplementacaoEventoPort.create(...args);
export const updateSuplementacaoEventoNativo = (...args) => suplementacaoEventoPort.update(...args);
export const deleteSuplementacaoEventoNativo = (...args) => suplementacaoEventoPort.delete(...args);

export { comandoLancamentoComLotes } from './suplementacaoEventoComandosApi.js';
