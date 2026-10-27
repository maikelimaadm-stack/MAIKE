/** API pública de PontoSuplementacao (P5.4). */
import { pontoSuplementacaoPort } from './pontoSuplementacaoNativePort.js';

/**
 * @param {unknown} registros
 * @returns {any[]}
 */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);

/** @returns {Promise<any[]>} */
export const listPontosSuplementacao = async () =>
  comoLista(await pontoSuplementacaoPort.list());
export const createPontoSuplementacao = (dados) => pontoSuplementacaoPort.create(dados);
export const updatePontoSuplementacao = (id, dados) => pontoSuplementacaoPort.update(id, dados);
export const deletePontoSuplementacao = (id) => pontoSuplementacaoPort.delete(id);
