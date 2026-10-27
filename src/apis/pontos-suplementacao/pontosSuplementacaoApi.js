/** API pública de PontoSuplementacao (P5.4). */
import { pontoSuplementacaoPort } from './pontoSuplementacaoNativePort.js';

export const listPontosSuplementacao = () => pontoSuplementacaoPort.list();
export const createPontoSuplementacao = (dados) => pontoSuplementacaoPort.create(dados);
export const updatePontoSuplementacao = (id, dados) => pontoSuplementacaoPort.update(id, dados);
export const deletePontoSuplementacao = (id) => pontoSuplementacaoPort.delete(id);
