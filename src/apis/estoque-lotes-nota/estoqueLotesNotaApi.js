/**
 * API pública de EstoqueLoteNota (P5.4).
 *
 * D-PROD-161 (F3): sem create/delete genéricos — o lote nasce e some pelo motor.
 */
import { estoqueLoteNotaPort } from './estoqueLoteNotaNativePort.js';

export const listLotesNotaEstoque = () => estoqueLoteNotaPort.list();
export const filterLotesNotaEstoque = (criterio) => estoqueLoteNotaPort.filter(criterio);
export const updateLoteNotaEstoque = (id, dados) => estoqueLoteNotaPort.update(id, dados);
