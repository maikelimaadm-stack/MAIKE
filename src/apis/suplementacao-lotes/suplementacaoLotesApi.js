import { suplementacaoLotePort } from './suplementacaoLoteNativePort.js';

export const listSuplementacaoLotesNativos = (...args) => suplementacaoLotePort.list(...args);
export const filterSuplementacaoLotesNativos = (...args) => suplementacaoLotePort.filter(...args);
export const bulkCreateSuplementacaoLoteNativo = (...args) => suplementacaoLotePort.bulkCreate(...args);
export const updateSuplementacaoLoteNativo = (...args) => suplementacaoLotePort.update(...args);
export const deleteSuplementacaoLoteNativo = (...args) => suplementacaoLotePort.delete(...args);
