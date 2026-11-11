/**
 * D-PROD-157 / D-PROD-162 / D-PROD-163 — Famílias patrimoniais (catálogo do
 * TENANT, sem empresa).
 *
 * D-PROD-163 (SIMPLIFICA-02): o CADASTRO de família saiu e nenhuma tela lê
 * família, então não há mais rota de família (nem leitura nem opções → 404).
 * Cada "Tipo de bem" (natureza) tem a sua família PADRÃO, garantida
 * automaticamente por `garantirCatalogoPadrao` (`patrimonioCatalogoPadrao.js`);
 * famílias antigas criadas à mão continuam valendo para os tipos delas, e a
 * família aparece só dentro do tipo. Aqui ficam só a entidade e a forma de
 * auditoria (usadas pela garantia e pelo instalador).
 */

export const ENTIDADE = 'FamiliaPatrimonial';

/** Auditoria por allowlist (sem nome nem descrição). */
export const paraAuditoria = (r) => ({ id: r.id, codigo: r.codigo, natureza: r.natureza, ativo: r.ativo, versao: r.versao });
