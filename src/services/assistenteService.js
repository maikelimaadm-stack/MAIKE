/**
 * D-PROD-230 — Assistente só de leitura: o que a UI usa (a UI importa service, nunca a API).
 */
import { perguntarAoAssistente } from '@/apis/assistente';

/** @param {Parameters<typeof perguntarAoAssistente>[0]} dados */
export const perguntarAssistente = (dados) => perguntarAoAssistente(dados);
