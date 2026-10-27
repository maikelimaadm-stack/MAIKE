/** API pública de EstoqueLoteNota (P5.4). */
import { estoqueLoteNotaPort } from './estoqueLoteNotaNativePort.js';

export const listLotesNotaEstoque = () => estoqueLoteNotaPort.list();
export const filterLotesNotaEstoque = (criterio) => estoqueLoteNotaPort.filter(criterio);
export const createLoteNotaEstoque = (dados) => estoqueLoteNotaPort.create(dados);
export const updateLoteNotaEstoque = (id, dados) => estoqueLoteNotaPort.update(id, dados);
export const deleteLoteNotaEstoque = (id) => estoqueLoteNotaPort.delete(id);
