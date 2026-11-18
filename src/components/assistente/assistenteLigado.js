/**
 * D-PROD-230 — interruptor do assistente (pedido do proprietário em 2026-11-17: desligado
 * por enquanto). A leitura da variável de build fica em `@/config/runtimeConfig`
 * (`VITE_ASSISTENTE_LIGADO=true` liga). Para religar: definir a variável na Vercel e
 * publicar de novo.
 */
import { isAssistenteLigado } from '@/config/runtimeConfig';

export const assistenteLigado = () => isAssistenteLigado();
