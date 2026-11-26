/**
 * Diário da máquina, Fase 2: quem vê R$ nas telas de lançamento.
 * R$ só para o administrador da fazenda: a permissão EFETIVA (`permissaoEfetiva`, já com
 * `is_admin === true` para ele) é normalizada e conferida. Sem permissão, não vê.
 * Só decide a EXIBIÇÃO; o custo continua sendo gravado e enviado pelo servidor.
 */
import { normalizePermissionRecord } from "@/lib/permissions";

/** @param {unknown} permissao a permissão efetiva do usuário (ou null) @returns {boolean} */
export const podeVerCusto = (permissao) => normalizePermissionRecord(/** @type {any} */ (permissao))?.is_admin === true;
