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
const MAX_TOKENS = 4000;
const MAX_RESULTADO_CHARS = 60000;

export const PROMPT_SISTEMA = `Você é o assistente do MAIKE, sistema de pecuária (Mapa Geral e manejo) de uma fazenda.
Responda sempre em português do Brasil, de forma curta e direta, como quem conversa com o dono da fazenda pelo celular.
Use SOMENTE os dados que as ferramentas devolverem. Nunca invente números, pastos, lotes ou datas.
Se a informação não existir nas ferramentas, diga claramente que o sistema não tem esse dado.
Você só consulta: não lança, não altera e não exclui nada. Se pedirem para mudar algo, explique que o assistente é só de leitura e diga onde fazer no sistema.
Situação de forragem: Rapado, Descanso, Pronto, Passou do ponto; "(estimado)" quer dizer que veio dos dias de descanso, não de medição.
Rapidez: quando precisar de mais de uma ferramenta, peça todas de uma vez na mesma resposta, sem escrever nada antes de pedir.
Dúvidas: se a pergunta for ambígua (qual pasto, lote, categoria ou período; ou se der para entender de mais de um jeito), não chute: faça UMA pergunta curta de volta, com 2 a 4 opções em lista com "- ", e espere a resposta. Se for claro, responda direto.
Ao terminar uma resposta, pode oferecer em uma frase curta o próximo passo útil (por exemplo, ver a lista lote por lote).
Formato (a resposta aparece num balão pequeno de celular):
- Comece pela resposta direta em 1 ou 2 frases; depois, se precisar, uma lista curta com "- ".
- Use **negrito** só para o número ou nome principal. Não use tabelas, títulos com "#" nem emojis.
- No máximo 8 itens por lista; se houver mais, resuma e ofereça mostrar o resto.
- Números no padrão brasileiro (4.425 cabeças, 327,5 kg); datas como 05/11.
- Cite o nome do pasto ou do lote. Não explique como o sistema calcula, a não ser que perguntem.`;

/** @type {(() => any) | null} */
let fabricaDeTeste = null;

/** Só testes: troca o cliente da API por um falso. `null` volta ao real. */
export const definirFabricaClienteAssistente = (fabrica) => {
  fabricaDeTeste = fabrica;
};

const PRAZO_TOTAL_MS = 50_000;
const PRAZO_MINIMO_CHAMADA_MS = 5_000;

const naoConfigurado = () =>
  new AppError('ASSISTENTE_NAO_CONFIGURADO', 'o assistente não está configurado neste servidor (falta a chave da API)');

const criarCliente = () => {
  if (fabricaDeTeste) return fabricaDeTeste();
  if (!process.env.ANTHROPIC_API_KEY) throw naoConfigurado();
  // Chave da organização (sem workspace) exige o cabeçalho com o workspace a usar.
  const workspace = String(process.env.ANTHROPIC_WORKSPACE_ID ?? '').trim();
  return new Anthropic({
    maxRetries: 1,
    timeout: 45_000,
    ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}),
  });
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
/**
 * Opções de streaming (D-PROD-230): com `aoTexto`, cada rodada usa
 * `cliente.beta.messages.stream()` e manda os pedaços de texto conforme chegam;
 * `aoFerramenta` avisa qual consulta está rodando; `sinal` cancela (cliente fechou).
 * Sem opções, o caminho é o mesmo de antes (`create`), resposta inteira no fim.
 * @typedef {{ aoTexto?: (t: string) => void, aoFerramenta?: (nome: string) => void, sinal?: AbortSignal }} OpcoesPergunta
 */

/**
 * @param {{auth: any}} contexto
 * @param {{ empresa_id: string, pergunta: string, tela?: string, historico?: Array<{papel: 'usuario'|'assistente', texto: string}> }} entrada
 * @param {OpcoesPergunta} [opcoes]
 */
export const perguntar = async (contexto, entrada, opcoes = {}) => {
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
  // A função da Vercel tem no máximo 60 s (vercel.json): a conversa inteira cabe em ~50 s.
  const prazo = Date.now() + PRAZO_TOTAL_MS;
  for (let i = 0; i < MAX_ITERACOES; i += 1) {
    const restante = prazo - Date.now();
    if (restante < PRAZO_MINIMO_CHAMADA_MS) break;
    let resposta;
    try {
      const params = {
        model: MODELO,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Rapidez: perguntas de consulta não precisam de raciocínio longo.
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: PROMPT_SISTEMA, cache_control: { type: 'ephemeral' } }],
        tools: DEFINICOES_FERRAMENTAS,
        messages: mensagens,
      };
      const opcoesPedido = { timeout: restante, maxRetries: 0, ...(opcoes.sinal ? { signal: opcoes.sinal } : {}) };
      if (opcoes.aoTexto) {
        const fluxo = cliente.beta.messages.stream(params, opcoesPedido);
        fluxo.on('text', (pedaco) => opcoes.aoTexto?.(pedaco));
        resposta = await fluxo.finalMessage();
      } else {
        resposta = await cliente.beta.messages.create(params, opcoesPedido);
      }
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
      opcoes.aoFerramenta?.(pedido.name);
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
