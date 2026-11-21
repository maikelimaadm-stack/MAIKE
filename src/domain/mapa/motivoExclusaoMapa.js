/**
 * D-PROD-270 — "não preciso de motivos para exclusão nos históricos" (proprietário).
 * Os diálogos de exclusão dos históricos do mapa (cocho, depósito, área, movimentação do
 * lote/curral) não pedem mais o motivo: a tela envia este texto fixo, que o servidor exige
 * (3 a 500 caracteres) e guarda na auditoria. Texto fixo = o mesmo fingerprint num reenvio
 * com a mesma chave. Uma pendência antiga, gravada com motivo digitado, reenvia o motivo dela.
 */
export const MOTIVO_EXCLUSAO_MAPA = 'Excluído pelo histórico do mapa';
