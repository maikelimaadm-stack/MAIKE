/**
 * D-PROD-230 — interruptor do assistente (pedido do proprietário em 2026-11-17: desligado
 * por enquanto). O botão só aparece com `VITE_ASSISTENTE_LIGADO=true` no build; sem a
 * variável, fica desligado. Para religar: definir a variável na Vercel e publicar de novo.
 */
export const assistenteLigado = (env = import.meta.env) => String(env?.VITE_ASSISTENTE_LIGADO ?? '').trim() === 'true';
