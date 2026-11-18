/**
 * D-PROD-219 — Medição de Forragem: o que a UI do mapa usa (a UI importa service,
 * nunca a API do módulo). Criação também offline (fila); exclusão pela porta.
 */
import { createMedicaoForragem, deleteMedicaoForragem } from '@/apis/medicoes-forragem';

/** @param {Record<string, unknown>} corpo */
export const registrarMedicaoForragem = (corpo) => createMedicaoForragem(corpo);

/** @param {string} id */
export const excluirMedicaoForragem = (id) => deleteMedicaoForragem(id);
