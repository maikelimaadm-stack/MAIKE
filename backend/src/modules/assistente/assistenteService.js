/**
 * Assistente só de leitura (D-PROD-230) — uma pergunta, uma resposta.
 *
 * Laço de ferramentas manual e limitado: a IA (Claude, API da Anthropic, chave do
 * proprietário em `ANTHROPIC_API_KEY`) pede ferramentas do conjunto fechado de
 * `assistenteFerramentas.js`, o servidor executa com o `auth_context` da requisição
 * e devolve o resultado, até a resposta final ou `MAX_ITERACOES`. Nada é gravado:
 * sem tabela, sem histórico no servidor, sem auditoria de escrita. O histórico curto
 * da conversa vem do cliente, validado pelo schema da rota.
 */

import Anthropic from '@anthropic-ai/sdk';

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { DEFINICOES_FERRAMENTAS, criarExecutor } from './assistenteFerramentas.js';

export const MODELO = 'claude-opus-5-5';
export const MAX_ITERACOES = 8;
const MAX_TOKENS = 8000;
const MAX_RESULTADO_CHARS = 60000;

export const PROMPT_SISTEMA = `Você é o assistente do MAIKE, sistema de pecuária (Mapa Geral e manejo) de uma fazenda.
Responda sempre em português do Brasil, de forma curta e direta, como quem conversa com o dono da fazenda pelo celular.
Use SOMENTE os dados que as ferramentas devolverem. Nunca invente números, pastos, lotes ou datas.
Se a informação não existir nas ferramentas, diga claramente que o sistema não tem esse dado.
Você só consulta: não lança, não altera e não exclui nada. Se pedirem para mudar algo, explique que o assistente é só de leitura e diga onde fazer no sistema.
Situação de forragem: Rapado, Descanso, Pronto, Passou do ponto; "(estimado)" quer dizer que veio dos dias de descanso, não de medição.
Prefira listas curtas; cite o nome do pasto ou do lote.`;

/** @type {(() => any) | null} */
let fabricaDeTeste = null;

/** Só testes: troca o cliente da API por um falso. `null` volta ao real. */
export const definirFabricaClienteAssistente = (fabrica) => {
  fabricaDeTeste = fabrica;
};

const naoConfigurado = () =>
  new AppError('ASSISTENTE_NAO_CONFIGURADO', 'o assistente não está configurado neste servidor (falta a chave da API)');

const criarCliente = () => {
  if (fabricaDeTeste) return fabricaDeTeste();
  if (!process.env.ANTHROPIC_API_KEY) throw naoConfigurado();
  return new Anthropic({ maxRetries: 2, timeout: 90_000 });
};

/** @param {any} resposta */
const textoDe = (resposta) =>
  (resposta?.content ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

/** @param {unknown} valor */
const comoTexto = (valor) => {
  const json = JSON.stringify(valor ?? null);
  return json.length > MAX_RESULTADO_CHARS ? `${json.slice(0, MAX_RESULTADO_CHARS)}… (resultado cortado: peça algo mais específico)` : json;
};

/**
 * @param {{auth: any}} contexto
 * @param {{ empresa_id: string, pergunta: string, tela?: string, historico?: Array<{papel: 'usuario'|'assistente', texto: string}> }} entrada
 */
export const perguntar = async (contexto, entrada) => {
  exigirAuthContext(contexto?.auth);
  const executor = await criarExecutor(contexto, entrada.empresa_id);
  const cliente = criarCliente();

  /** @type {any[]} */
  const mensagens = [];
  for (const h of entrada.historico ?? []) {
    mensagens.push({ role: h.papel === 'assistente' ? 'assistant' : 'user', content: h.texto });
  }
  mensagens.push({ role: 'user', content: `Hoje é ${executor.hoje}.${entrada.tela ? ` Tela aberta: ${entrada.tela}.` : ''}\n\n${entrada.pergunta}` });

  const usadas = [];
  for (let i = 0; i < MAX_ITERACOES; i += 1) {
    let resposta;
    try {
      resposta = await cliente.beta.messages.create({
        model: MODELO,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: PROMPT_SISTEMA, cache_control: { type: 'ephemeral' } }],
        tools: DEFINICOES_FERRAMENTAS,
        messages: mensagens,
      });
    } catch (erro) {
      if (erro instanceof Anthropic.AuthenticationError) throw naoConfigurado();
      throw new AppError('ASSISTENTE_INDISPONIVEL', 'o assistente não respondeu agora; tente de novo em instantes', { cause: erro });
    }

    if (resposta.stop_reason === 'refusal') {
      return { resposta: 'Não consigo responder essa pergunta. Tente perguntar de outro jeito, sobre os pastos, o rebanho ou o cocho.', ferramentas: usadas, recusada: true };
    }
    if (resposta.stop_reason === 'pause_turn') {
      mensagens.push({ role: 'assistant', content: resposta.content });
      continue;
    }
    const pedidos = (resposta.content ?? []).filter((b) => b?.type === 'tool_use');
    if (resposta.stop_reason !== 'tool_use' || pedidos.length === 0) {
      const texto = textoDe(resposta);
      return { resposta: texto || 'Não encontrei uma resposta para isso nos dados do sistema.', ferramentas: usadas, recusada: false };
    }

    mensagens.push({ role: 'assistant', content: resposta.content });
    const resultados = [];
    for (const pedido of pedidos) {
      usadas.push(pedido.name);
      try {
        const dados = await executor.executar(pedido.name, pedido.input);
        resultados.push({ type: 'tool_result', tool_use_id: pedido.id, content: comoTexto(dados) });
      } catch (erro) {
        const mensagem = erro instanceof AppError ? erro.message : 'falha ao ler os dados';
        resultados.push({ type: 'tool_result', tool_use_id: pedido.id, content: mensagem, is_error: true });
      }
    }
    mensagens.push({ role: 'user', content: resultados });
  }
  return { resposta: 'A pergunta ficou grande demais para responder de uma vez. Tente dividir em perguntas menores.', ferramentas: usadas, recusada: false };
};
