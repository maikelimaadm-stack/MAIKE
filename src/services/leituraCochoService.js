/**
 * D-PROD-205 — Leitura de cocho: o que a UI do mapa usa (a UI importa service,
 * nunca a API do módulo). Criação também offline (fila); exclusão pela porta.
 */
import { createLeituraCocho, deleteLeituraCocho } from '@/apis/leituras-cocho';

/** @param {Record<string, unknown>} corpo */
export const registrarLeituraCocho = (corpo) => createLeituraCocho(corpo);

/** @param {string} id */
export const excluirLeituraCocho = (id) => deleteLeituraCocho(id);
