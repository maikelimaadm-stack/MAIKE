/**
 * D-PROD-230 — Assistente só de leitura: o que a UI usa (a UI importa service, nunca a API).
 */
import { perguntarAoAssistente, perguntarAoAssistenteAoVivo } from '@/apis/assistente';

/** @param {Parameters<typeof perguntarAoAssistente>[0]} dados */
export const perguntarAssistente = (dados) => perguntarAoAssistente(dados);

/**
 * Resposta aparecendo enquanto é escrita. Se o fluxo falhar ANTES de chegar qualquer
 * coisa (rede, proxy que não deixa passar), repete pela rota sem fluxo. Cancelado por
 * quem chamou, não repete.
 * @param {Parameters<typeof perguntarAoAssistente>[0]} dados
 * @param {{ aoTexto?: (t: string) => void, aoFerramenta?: (nome: string) => void, aoAcao?: (acao: any) => void, signal?: AbortSignal }} [opcoes]
 */
export const perguntarAssistenteAoVivo = async (dados, opcoes = {}) => {
  try {
    return await perguntarAoAssistenteAoVivo(dados, opcoes);
  } catch (erro) {
    if (opcoes.signal?.aborted || /** @type {any} */ (erro)?.recebeuAlgo) throw erro;
    const resultado = await perguntarAoAssistente(dados, { signal: opcoes.signal });
    // Parar durante a repetição: nada de resposta "concluída" depois do cancelamento.
    if (opcoes.signal?.aborted) throw Object.assign(new Error('requisição cancelada'), { name: 'AbortError' });
    return resultado;
  }
};
