/**
 * Fronteira HTTP do backend nativo MAIKE (P4.0, D-PROD-24).
 *
 * Este é o **único** arquivo de `src/` autorizado a chamar `fetch` contra o
 * backend próprio. A P1 provou o valor dessa disciplina com a fronteira da
 * Base44: enquanto 68 arquivos falavam com o SDK, trocar de provider era
 * impossível; com uma porta só, virou uma edição.
 *
 * O que entra e o que sai:
 *
 *   entrada  caminho relativo + corpo simples
 *   saída    valor já desserializado, ou `ApiError`
 *
 * Nunca sai daqui um `Response`, um erro cru, um status HTTP solto ou o token.
 *
 * ─── A regra que mais importa: a mensagem do servidor é descartada ─────────
 *
 * O backend responde `{code, message, request_id}`. Nós usamos `code` e
 * **jogamos `message` fora**. Não é desconfiança do nosso próprio backend: é
 * que mensagem de servidor carrega caminho, id interno, fragmento de query e,
 * num dia ruim, eco de entrada do atacante. Exibi-la seria dar aparência
 * confiável a texto não controlado — exatamente o defeito que a P1.1-R2
 * corrigiu no `ApiError` (R2-B3).
 *
 * O texto exibível vem do catálogo local, indexado pelo `code`.
 */

import { comPrefixoApiNativa } from '@/config/nativeApiPath.js';
import { getNativeApiUrl } from '@/config/runtimeConfig';
import { ApiError, API_ERROR_CODES } from './ApiError.js';
import { getNativeToken } from '@/lib/auth/nativeTokenStorage';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';
import { guardarResposta, lerResposta } from '@/lib/offline/respostasOffline';
import { FORMATO_INCREMENTAL, incrementalDe, lerIncremental } from '@/lib/offline/sincronizacaoIncremental';
import { registrarCopiaServida } from '@/lib/offline/copiasDoAparelho';
import { registrarHoraDaResposta } from '@/lib/offline/horaDasRespostas';

/** Requisição sem resposta em 20 s é tratada como indisponibilidade. */
const TIMEOUT_MS = 20000;

/**
 * Códigos do backend que o frontend entende **como eles são**.
 *
 * São os oito do contrato ModeloBase1 mais o de credencial. Cada um tem
 * mensagem pública própria em `ApiError`, então o código atravessa com o mesmo
 * nome — a UI pode tratar `TENANT_SCOPE_VIOLATION` diferente de
 * `CONCURRENCY_CONFLICT` sem inspecionar texto.
 */
const CODIGOS_PRESERVADOS = Object.freeze({
  TENANT_CONTEXT_REQUIRED: API_ERROR_CODES.TENANT_CONTEXT_REQUIRED,
  TENANT_SCOPE_VIOLATION: API_ERROR_CODES.TENANT_SCOPE_VIOLATION,
  SEQUENCE_SCOPE_INVALID: API_ERROR_CODES.SEQUENCE_SCOPE_INVALID,
  SEQUENCE_CONFLICT: API_ERROR_CODES.SEQUENCE_CONFLICT,
  ATTACHMENT_INVALID: API_ERROR_CODES.ATTACHMENT_INVALID,
  ATTACHMENT_OWNER_INVALID: API_ERROR_CODES.ATTACHMENT_OWNER_INVALID,
  AUDIT_WRITE_FAILED: API_ERROR_CODES.AUDIT_WRITE_FAILED,
  CONCURRENCY_CONFLICT: API_ERROR_CODES.CONCURRENCY_CONFLICT,
  AUTH_INVALID_CREDENTIALS: API_ERROR_CODES.AUTH_INVALID_CREDENTIALS,
  // P4.1: 404 de Setor. Preservado porque a tela age sobre ele — recarregar a
  // lista resolve — e isso não é a mesma coisa que "a operação falhou".
  SETOR_NOT_FOUND: API_ERROR_CODES.SETOR_NOT_FOUND,
  MARCA_NOT_FOUND: API_ERROR_CODES.MARCA_NOT_FOUND,
  MARCA_NAME_CONFLICT: API_ERROR_CODES.MARCA_NAME_CONFLICT,
  EMPRESA_NAME_CONFLICT: API_ERROR_CODES.EMPRESA_NAME_CONFLICT,
  UNIDADE_MEDIDA_NOT_FOUND: API_ERROR_CODES.UNIDADE_MEDIDA_NOT_FOUND,
  UNIDADE_MEDIDA_SIGLA_CONFLICT: API_ERROR_CODES.UNIDADE_MEDIDA_SIGLA_CONFLICT,
  // D-PROD-197: a unidade usada como unidade de produção padrão de um Tipo de
  // Atividade não sai (FK RESTRICT → 409, `details.vinculo`); a tela diz por quê.
  UNIDADE_MEDIDA_DELETE_BLOCKED: API_ERROR_CODES.UNIDADE_MEDIDA_DELETE_BLOCKED,
  GRUPO_ATIVIDADE_NOT_FOUND: API_ERROR_CODES.GRUPO_ATIVIDADE_NOT_FOUND,
  GRUPO_ATIVIDADE_NAME_CONFLICT: API_ERROR_CODES.GRUPO_ATIVIDADE_NAME_CONFLICT,
  GRUPO_ATIVIDADE_DELETE_BLOCKED: API_ERROR_CODES.GRUPO_ATIVIDADE_DELETE_BLOCKED,
  TIPO_TAREFA_NOT_FOUND: API_ERROR_CODES.TIPO_TAREFA_NOT_FOUND,
  TIPO_TAREFA_NAME_CONFLICT: API_ERROR_CODES.TIPO_TAREFA_NAME_CONFLICT,
  TIPO_ATIVIDADE_NOT_FOUND: API_ERROR_CODES.TIPO_ATIVIDADE_NOT_FOUND,
  TIPO_ATIVIDADE_NAME_CONFLICT: API_ERROR_CODES.TIPO_ATIVIDADE_NAME_CONFLICT,
  // D-PROD-197 — padrão do Tipo de Atividade recusado: `field`/`reason` (em
  // `details`) escolhem o texto do motivo no catálogo.
  TIPO_ATIVIDADE_PADRAO_INVALIDO: API_ERROR_CODES.TIPO_ATIVIDADE_PADRAO_INVALIDO,
  // D-PROD-190/198 — a atividade barra a exclusão do tipo usado.
  TIPO_ATIVIDADE_DELETE_BLOCKED: API_ERROR_CODES.TIPO_ATIVIDADE_DELETE_BLOCKED,
  // D-PROD-200 — Lançamento de Atividades (cabeçalho e apontamentos): a tela relê
  // ou diz o campo recusado; sem estes, a recusa viraria OPERATION_FAILED.
  ATIVIDADE_NOT_FOUND: API_ERROR_CODES.ATIVIDADE_NOT_FOUND,
  // D-PROD-276 — a reforma de pastagem: a tela relê a lista das reformas.
  PLANEJAMENTO_NOT_FOUND: API_ERROR_CODES.PLANEJAMENTO_NOT_FOUND,
  ATIVIDADE_APONTAMENTO_NOT_FOUND: API_ERROR_CODES.ATIVIDADE_APONTAMENTO_NOT_FOUND,
  ATIVIDADE_AREA_NOT_FOUND: API_ERROR_CODES.ATIVIDADE_AREA_NOT_FOUND,
  ATIVIDADE_AREA_COM_LANCAMENTOS: API_ERROR_CODES.ATIVIDADE_AREA_COM_LANCAMENTOS,
  ATIVIDADE_SERVICO_PARADO: API_ERROR_CODES.ATIVIDADE_SERVICO_PARADO,
  ATIVIDADE_REFERENCIA_INVALIDA: API_ERROR_CODES.ATIVIDADE_REFERENCIA_INVALIDA,
  ATIVIDADE_EXIGIDA_PELO_TIPO: API_ERROR_CODES.ATIVIDADE_EXIGIDA_PELO_TIPO,
  ATIVIDADE_DATA_INVALIDA: API_ERROR_CODES.ATIVIDADE_DATA_INVALIDA,
  ATIVIDADE_STATUS_INVALIDO: API_ERROR_CODES.ATIVIDADE_STATUS_INVALIDO,
  ATIVIDADE_VERSAO_CONFLITO: API_ERROR_CODES.ATIVIDADE_VERSAO_CONFLITO,
  // D-PROD-316: o lote ou o cocho mudou depois que a pessoa o abriu; a mensagem diz quem e quando (`details`).
  REGISTRO_VERSAO_CONFLITO: API_ERROR_CODES.REGISTRO_VERSAO_CONFLITO,
  ATIVIDADE_MOTIVO_INVALIDO: API_ERROR_CODES.ATIVIDADE_MOTIVO_INVALIDO,
  // Exclusão de cadastro barrada por atividade ou apontamento (FK reconhecida pelo nome).
  ATIVIDADE_VINCULADA: API_ERROR_CODES.ATIVIDADE_VINCULADA,
  // D-PROD-202 — linhas de produto e de máquina: a tela relê (linha sumiu), pede a justificativa do salto e resende,
  // ou diz por que o estorno exato e a troca de data foram recusados.
  ATIVIDADE_LINHA_NOT_FOUND: API_ERROR_CODES.ATIVIDADE_LINHA_NOT_FOUND,
  ATIVIDADE_LINHA_INVALIDA: API_ERROR_CODES.ATIVIDADE_LINHA_INVALIDA,
  ATIVIDADE_SALTO_MEDIDOR: API_ERROR_CODES.ATIVIDADE_SALTO_MEDIDOR,
  ATIVIDADE_ESTORNO_BLOQUEADO: API_ERROR_CODES.ATIVIDADE_ESTORNO_BLOQUEADO,
  ATIVIDADE_DATA_COM_LINHAS: API_ERROR_CODES.ATIVIDADE_DATA_COM_LINHAS,
  ESTACAO_NOT_FOUND: API_ERROR_CODES.ESTACAO_NOT_FOUND,
  ESTACAO_NAME_CONFLICT: API_ERROR_CODES.ESTACAO_NAME_CONFLICT,
  ESTACAO_PERIODO_SOBREPOSTO: API_ERROR_CODES.ESTACAO_PERIODO_SOBREPOSTO,
  CULTURA_NOT_FOUND: API_ERROR_CODES.CULTURA_NOT_FOUND,
  CULTURA_NAME_CONFLICT: API_ERROR_CODES.CULTURA_NAME_CONFLICT,
  CULTURA_CODIGO_CONFLICT: API_ERROR_CODES.CULTURA_CODIGO_CONFLICT,
  CULTURA_EM_USO: API_ERROR_CODES.CULTURA_EM_USO,
  SERVICO_NOT_FOUND: API_ERROR_CODES.SERVICO_NOT_FOUND,
  SERVICO_REFERENCIA_INVALIDA: API_ERROR_CODES.SERVICO_REFERENCIA_INVALIDA,
  CURVA_GANHO_NOT_FOUND: API_ERROR_CODES.CURVA_GANHO_NOT_FOUND,
  CURVA_GANHO_NAME_CONFLICT: API_ERROR_CODES.CURVA_GANHO_NAME_CONFLICT,
  // D-PROD-195 — 409 ao excluir curva ligada a categoria de manejo.
  CURVA_GANHO_EM_USO: API_ERROR_CODES.CURVA_GANHO_EM_USO,
  // D-PROD-203 — Formulações de suplemento.
  FORMULACAO_NOT_FOUND: API_ERROR_CODES.FORMULACAO_NOT_FOUND,
  FORMULACAO_NAME_CONFLICT: API_ERROR_CODES.FORMULACAO_NAME_CONFLICT,
  FORMULACAO_EM_USO: API_ERROR_CODES.FORMULACAO_EM_USO,
  // D-PROD-205 — Leitura de cocho.
  LEITURA_COCHO_NOT_FOUND: API_ERROR_CODES.LEITURA_COCHO_NOT_FOUND,
  // D-PROD-219 — Medição de Forragem.
  MEDICAO_FORRAGEM_NOT_FOUND: API_ERROR_CODES.MEDICAO_FORRAGEM_NOT_FOUND,
  // D-PROD-230 — Assistente só de leitura.
  ASSISTENTE_NAO_CONFIGURADO: API_ERROR_CODES.ASSISTENTE_NAO_CONFIGURADO,
  ASSISTENTE_INDISPONIVEL: API_ERROR_CODES.ASSISTENTE_INDISPONIVEL,
  USUARIO_NOT_FOUND: API_ERROR_CODES.USUARIO_NOT_FOUND,
  USUARIO_LOGIN_DUPLICADO: API_ERROR_CODES.USUARIO_LOGIN_DUPLICADO,
  USUARIO_SELF_DEACTIVATE: API_ERROR_CODES.USUARIO_SELF_DEACTIVATE,
  TENANT_ADMIN_REQUIRED: API_ERROR_CODES.TENANT_ADMIN_REQUIRED,
  ACAO_NAO_PERMITIDA: API_ERROR_CODES.ACAO_NAO_PERMITIDA,
  USUARIO_SENHA_ATUAL_INVALIDA: API_ERROR_CODES.USUARIO_SENHA_ATUAL_INVALIDA,
  USUARIO_INATIVO: API_ERROR_CODES.USUARIO_INATIVO,
  // D-PROD-90 — importação de áreas.
  AREA_IMPORT_VALIDATION_FAILED: API_ERROR_CODES.AREA_IMPORT_VALIDATION_FAILED,
  AREA_IMPORT_LIMIT_EXCEEDED: API_ERROR_CODES.AREA_IMPORT_LIMIT_EXCEEDED,
  IDEMPOTENCY_CONFLICT: API_ERROR_CODES.IDEMPOTENCY_CONFLICT,
  IDEMPOTENCY_IN_PROGRESS: API_ERROR_CODES.IDEMPOTENCY_IN_PROGRESS,
  EMPRESA_NOT_FOUND: API_ERROR_CODES.EMPRESA_NOT_FOUND,
  // D-PROD-137 (EMP-01): a tela Empresa diz por que a exclusão foi recusada.
  EMPRESA_COM_VINCULOS: API_ERROR_CODES.EMPRESA_COM_VINCULOS,
});

/**
 * Códigos que só existem no backend e não viram vocabulário de tela.
 *
 * `REQUEST_VALIDATION_FAILED` e `REQUEST_REJECTED` são "a requisição estava
 * errada" — para o usuário isso é argumento inválido. `INTERNAL_ERROR` é "o
 * servidor falhou", que já é a falha genérica.
 */
const TRADUCAO_BACKEND_ONLY = Object.freeze({
  REQUEST_VALIDATION_FAILED: API_ERROR_CODES.INVALID_ARGUMENT,
  REQUEST_REJECTED: API_ERROR_CODES.INVALID_ARGUMENT,
  INTERNAL_ERROR: API_ERROR_CODES.OPERATION_FAILED,
});

const ehObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

/** Campos de diagnóstico de validação permitidos na resposta de erro. */
const detalhesSeguros = (corpo, details) => {
  const requestId = typeof corpo?.request_id === 'string' ? corpo.request_id : null;
  const field = typeof corpo?.field === 'string' ? corpo.field : null;
  const reason = typeof corpo?.reason === 'string' ? corpo.reason : null;
  const corpoDetails = ehObjeto(corpo?.details) ? corpo.details : null;
  const diagnostico =
    field && reason
      ? { field, reason }
      : null;
  if (!requestId && !details && !diagnostico && !corpoDetails) return null;
  return {
    ...(details ?? {}),
    ...(corpoDetails ?? {}),
    ...(diagnostico ?? {}),
    ...(requestId ? { requestId } : {}),
  };
};

/**
 * Traduz o código do backend para o vocabulário do frontend.
 *
 * Código desconhecido — backend mais novo que o bundle, proxy no meio, resposta
 * de outra coisa — vira falha genérica. Nunca atravessa cru: um código não
 * catalogado chegaria à UI sem mensagem pública e cairia no texto padrão de
 * qualquer jeito, mas carimbado como se fosse contrato.
 */
const traduzirCodigo = (codigo) => {
  if (typeof codigo !== 'string' || !codigo) return API_ERROR_CODES.OPERATION_FAILED;
  // Mapa em vez de `Set`: devolver a chave encontrada no mapa preserva o tipo
  // literal do código. Com `Set.has(x) ? x : ...` o retorno vira `string` solto,
  // e o contrato de `ApiError` — que aceita só códigos catalogados — deixaria de
  // ser verificável.
  return (
    CODIGOS_PRESERVADOS[codigo] ?? TRADUCAO_BACKEND_ONLY[codigo] ?? API_ERROR_CODES.OPERATION_FAILED
  );
};

/**
 * Monta a URL final.
 *
 * O caminho é sempre relativo e literal, definido pelo código — nunca vem de
 * entrada do usuário. Concatenar aqui uma URL arbitrária permitiria apontar o
 * `Authorization` para outro servidor.
 */
const montarUrl = (base, caminho) => `${base}${comPrefixoApiNativa(caminho)}`;

const erroDeIndisponibilidade = (contexto, cause) =>
  new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {
    operation: contexto.operation,
    resource: contexto.resource,
    details: contexto.details ?? null,
    cause,
  });

/**
 * Lê o corpo como JSON quando houver corpo.
 *
 * 204 e corpo vazio são normais: `logout` e `DELETE` respondem assim. JSON
 * inválido não derruba — vira `null` e o status decide o resultado.
 */
const lerCorpo = async (resposta) => {
  if (resposta.status === 204) return null;
  const texto = await resposta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};

/**
 * Executa uma requisição contra o backend nativo.
 *
 * @param {string} caminho caminho literal, ex.: `/auth/login`
 * `timeoutMs` é exceção por pedido, nunca padrão: hoje só a importação de áreas
 * (D-PROD-90 R1) usa, porque a gravação dela é uma transação de até 60 s no
 * servidor e cortá-la aos 20 s criaria "resultado desconhecido" sem motivo.
 *
 * `signal` (opcional, PR181-R2): cancelamento pedido por quem chama (ex.: a
 * conferência de elegibilidade cujo card sumiu ou estourou o prazo). Ele aborta
 * o MESMO controlador do transporte — o fetch E a leitura do corpo — e o
 * listener sai ao fim da chamada. Sem `signal`, nada muda.
 *
 * `tokenDeEtapa` (S04-P2): bearer de uma etapa restrita que NÃO é a sessão — o
 * token da troca obrigatória de senha, que só vive em memória na fronteira de
 * sessão (`nativeSessionApi`) e nunca vai para o armazenamento. Exclusivo com
 * `autenticado`.
 *
 * @param {{method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', body?: object|null, autenticado?: boolean, tokenDeEtapa?: string, timeoutMs?: number, signal?: AbortSignal}} opcoes
 * @param {{operation: string, resource: string, details?: object}} contexto
 * @returns {Promise<unknown>}
 */
const requisitarNaRede = async (caminho, opcoes, contexto) => {
  const { method = 'GET', body = null, autenticado = false } = opcoes;
  const limiteMs =
    Number.isFinite(opcoes.timeoutMs) && /** @type {number} */ (opcoes.timeoutMs) > 0
      ? /** @type {number} */ (opcoes.timeoutMs)
      : TIMEOUT_MS;
  const base = getNativeApiUrl();

  // Sem URL configurada não existe "tentar assim mesmo": chamar caminho
  // relativo bateria no host do frontend e devolveria o `index.html`, que
  // falharia como JSON inválido e viraria um erro sem sentido.
  if (!base) {
    throw erroDeIndisponibilidade(contexto, new Error('VITE_MAIKE_API_URL ausente'));
  }

  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (body !== null) headers['Content-Type'] = 'application/json';

  if (autenticado) {
    const token = getNativeToken();
    if (!token) {
      // Sem token, a requisição autenticada não sai. Mandá-la assim renderia
      // um 401 do servidor com o mesmo significado e uma ida à rede a mais.
      throw new ApiError(API_ERROR_CODES.TENANT_CONTEXT_REQUIRED, {
        operation: contexto.operation,
        resource: contexto.resource,
        details: contexto.details ?? null,
      });
    }
    headers.Authorization = `Bearer ${token}`;
  } else if (typeof opcoes.tokenDeEtapa === 'string' && opcoes.tokenDeEtapa) {
    headers.Authorization = `Bearer ${opcoes.tokenDeEtapa}`;
  }

  // `AbortController` em vez de `AbortSignal.timeout`: o segundo só existe no
  // Node 17.3+/navegadores recentes, e o `clearTimeout` evita segurar o
  // processo vivo em teste.
  const controlador = new AbortController();
  const externo = opcoes.signal ?? null;
  if (externo?.aborted) throw erroDeIndisponibilidade(contexto, Object.assign(new Error('requisição cancelada'), { name: 'AbortError' }));
  const repassarAbort = () => controlador.abort();
  externo?.addEventListener('abort', repassarAbort, { once: true });
  const soltarExterno = () => externo?.removeEventListener('abort', repassarAbort);
  const timer = setTimeout(() => controlador.abort(), limiteMs);

  let resposta;
  try {
    resposta = await fetch(montarUrl(base, caminho), {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controlador.signal,
      // Bearer, não cookie. `credentials: 'omit'` é explícito de propósito: o
      // CORS do backend não habilita credenciais, e mandar cookie de terceira
      // origem só criaria superfície de CSRF sem nenhum ganho.
      credentials: 'omit',
    });
  } catch (erro) {
    // Rede caída, DNS, CORS recusado e abort caem todos aqui, e todos
    // significam a mesma coisa para quem está na tela: o serviço não respondeu.
    soltarExterno();
    throw erroDeIndisponibilidade(contexto, erro);
  } finally {
    clearTimeout(timer);
  }

  let corpo;
  try {
    corpo = await lerCorpo(resposta);
  } catch (erro) {
    // D-PROD-307: a conexão caiu no meio da resposta (o servidor pode ter gravado): é falta de
    // rede, não recusa. Antes saía como erro sem código e o motor dava o registro como recusado.
    throw erroDeIndisponibilidade(contexto, erro);
  } finally {
    soltarExterno();
  }

  if (resposta.ok) return corpo;

  // 502/503/504 são indisponibilidade de infraestrutura, não erro de contrato:
  // o corpo pode nem ser do nosso backend (proxy, load balancer).
  // Exceção: 503 do PRÓPRIO backend com código do assistente (D-PROD-230) mostra a
  // mensagem do assistente, não a de infraestrutura.
  const codigoAssistente = ehObjeto(corpo) && String(corpo.code ?? '').startsWith('ASSISTENTE_') ? CODIGOS_PRESERVADOS[corpo.code] : null;
  if (resposta.status === 503 && codigoAssistente) {
    throw new ApiError(codigoAssistente, { operation: contexto.operation, resource: contexto.resource, details: detalhesSeguros(corpo, contexto.details), cause: corpo });
  }
  if (resposta.status === 502 || resposta.status === 503 || resposta.status === 504) {
    throw erroDeIndisponibilidade(contexto, new Error(`HTTP ${resposta.status}`));
  }

  const codigo = traduzirCodigo(ehObjeto(corpo) ? corpo.code : null);

  const erro = new ApiError(codigo, {
    operation: contexto.operation,
    resource: contexto.resource,
    details: detalhesSeguros(corpo, contexto.details),
    // O corpo inteiro fica em `cause`, que o `ApiError` define como não
    // enumerável — some de `JSON.stringify`, inclusive a `message` do servidor.
    cause: corpo,
  });
  // D-PROD-324: rota que o servidor ainda não tem (404/405/501 SEM o `code` de uma regra). Quem chama pode cair no
  // fluxo antigo, sem ler o formato do servidor. Um 404 de negócio sempre traz `code` e não entra aqui.
  if ([404, 405, 501].includes(resposta.status) && !(ehObjeto(corpo) && corpo.code)) erro.rotaAusente = true;
  throw erro;
};

const semInternetAgora = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * D-PROD-309: no máximo UMA sincronização incremental rodando por lista e conta, e UMA esperando.
 *  - quem pede antes de a sincronização em curso ir à rede entra nela (telas abrindo juntas);
 *  - quem pede DEPOIS espera ela acabar e recebe a SEGUINTE, que começa depois do pedido — a
 *    tela que acabou de salvar sempre vê o que salvou;
 *  - quem chega enquanto a seguinte ainda espera recebe a mesma.
 * @type {Map<string, {rodando: Promise<unknown>|null, foiARede: boolean, proxima: Promise<unknown>|null}>}
 */
const incrementais = new Map();
/**
 * @template T
 * @param {string} chave
 * @param {(marcarIdaARede: () => void) => Promise<T>} fazer
 * @returns {Promise<T>}
 */
const naVezDaLista = (chave, fazer) => {
  let e = incrementais.get(chave);
  if (!e) {
    e = { rodando: null, foiARede: false, proxima: null };
    incrementais.set(chave, e);
  }
  const estado = e;
  const rodar = () => {
    estado.foiARede = false;
    const p = fazer(() => {
      if (estado.rodando === p) estado.foiARede = true;
    }).finally(() => {
      if (estado.rodando === p) estado.rodando = null;
    });
    estado.rodando = p;
    return p;
  };
  if (!estado.rodando) return /** @type {Promise<T>} */ (rodar());
  if (!estado.foiARede) return /** @type {Promise<T>} */ (estado.rodando);
  if (!estado.proxima) {
    estado.proxima = estado.rodando
      .catch(() => undefined)
      .then(() => {
        estado.proxima = null;
        return rodar();
      });
  }
  return /** @type {Promise<T>} */ (estado.proxima);
};

const SEM_RESPOSTA_A_TEMPO = Symbol('sem-resposta-a-tempo');
/** @param {number} ms */
const esperar = (ms) => new Promise((r) => setTimeout(() => r(SEM_RESPOSTA_A_TEMPO), ms));

/** Leitura com cópia no aparelho espera a rede no máximo isto (D-PROD-294). */
const TIMEOUT_COM_COPIA_MS = 6000;

/**
 * D-PROD-307: a cópia do aparelho, avisando quem grava cache (`copiasDoAparelho`).
 * D-PROD-318: e de quando ela é (o início do pedido que a gravou; desconhecida em cópia antiga).
 * @param {{corpo: unknown, pedido_em?: number|null}} guardada @param {string} tenant @param {string} caminho
 */
const daCopia = (guardada, tenant, caminho) => {
  registrarCopiaServida();
  registrarHoraDaResposta(tenant, caminho, guardada.pedido_em ?? null);
  return guardada.corpo;
};

/**
 * Requisição ao backend nativo (contrato acima).
 *
 * D-PROD-294 — leitura autenticada (`GET`) funciona sem internet: a resposta
 * que o servidor deu fica guardada no aparelho (por tenant e caminho) e volta
 * quando a rede falha ou o aparelho está sem sinal. Gravações (POST/PUT/PATCH/
 * DELETE) nunca usam o guardado. Sem resposta guardada, a falha de rede segue
 * como sempre (indisponibilidade).
 *
 * @param {string} caminho
 * @param {{method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', body?: object|null, autenticado?: boolean, tokenDeEtapa?: string, timeoutMs?: number, signal?: AbortSignal, somenteRede?: boolean}} opcoes
 * @param {{operation: string, resource: string, details?: object}} contexto
 * @returns {Promise<unknown>}
 */
export const nativeRequest = async (caminho, opcoes, contexto) => {
  // `/auth/*` nunca: a sessão é decidida pelo servidor (ou pela regra própria
  // de abertura sem internet, em `nativeSessionApi`), nunca por resposta velha.
  const leitura = (opcoes.method ?? 'GET') === 'GET' && opcoes.autenticado === true && !caminho.startsWith('/auth/');
  const tenant = leitura ? getOfflineTenant() : null;
  if (!tenant) return requisitarNaRede(caminho, opcoes, contexto);

  // `somenteRede` (baixar dados): a leitura precisa vir do servidor agora.
  const podeUsarGuardado = opcoes.somenteRede !== true;
  const guardada = podeUsarGuardado ? await lerResposta(tenant, caminho) : undefined;
  if (guardada && semInternetAgora()) return daCopia(guardada, tenant, caminho);

  // Internet fraca (campo): com uma cópia guardada, não espera os 20 s do
  // servidor — em 6 s sem resposta, a tela abre com a cópia do aparelho.
  const opcoesDaRede = guardada
    ? { ...opcoes, timeoutMs: Math.min(opcoes.timeoutMs ?? TIMEOUT_COM_COPIA_MS, TIMEOUT_COM_COPIA_MS) }
    : opcoes;
  try {
    // D-PROD-309: listas grandes — só o que mudou desde a última vez (ver `sincronizacaoIncremental`).
    if (incrementalDe(caminho)) {
      const contaTrocou = () => getOfflineTenant() !== tenant;
      // O trabalho é compartilhado entre telas: sem o `signal` de quem pediu primeiro (se ele
      // desistir, as outras continuam) e com o timeout normal por página.
      const { signal: _sinalDeQuemPediu, ...opcoesCompartilhadas } = opcoes;
      const sincronia = naVezDaLista(`${tenant}\u0000${caminho}`, async (marcarIdaARede) => {
        // Lida AQUI (não antes): a sincronização anterior pode ter acabado de gravar a marca.
        const comMarca = await lerResposta(tenant, caminho);
        // D-PROD-318: a hora da 1ª página (esta sincronização pode ter esperado a anterior na fila).
        /** @type {number|null} */
        let saiuEm = null;
        const { corpo, marca } = await lerIncremental({
          caminho,
          guardada: comMarca,
          pedir: (c) => {
            // Saiu da conta (ou entrou outra) no meio das páginas: para; nada é misturado.
            if (contaTrocou()) throw new Error('incremental: a conta trocou durante a sincronização');
            marcarIdaARede();
            saiuEm ??= Date.now();
            return requisitarNaRede(c, opcoesCompartilhadas, contexto);
          },
        });
        if (contaTrocou()) throw new Error('incremental: a conta trocou durante a sincronização');
        const de = saiuEm ?? comMarca?.pedido_em ?? null;
        await guardarResposta(tenant, caminho, corpo, { marca, formato: FORMATO_INCREMENTAL, ...(de === null ? {} : { pedido_em: de }) }).catch(() => {});
        registrarHoraDaResposta(tenant, caminho, de);
        return corpo;
      });
      try {
        // Com cópia no aparelho, a tela espera no máximo os mesmos 6 s de sempre (D-PROD-294),
        // não 6 s por página: depois disso abre com a cópia e a sincronização termina por trás.
        if (guardada) {
          const r = await Promise.race([sincronia, esperar(TIMEOUT_COM_COPIA_MS)]);
          if (r === SEM_RESPOSTA_A_TEMPO) {
            sincronia.catch(() => undefined);
            return daCopia(guardada, tenant, caminho);
          }
          return r;
        }
        return await sincronia;
      } catch (erroIncremental) {
        // Sem rede: segue o caminho de sempre (a cópia, abaixo). Conta trocada: não grava nada
        // nesta conta. Qualquer outra falha (servidor sem a rota de mudanças — versões fora de
        // ordem —, resposta inesperada): a lista inteira, como antes. A sincronização
        // incremental nunca deixa a tela sem dados.
        if (/** @type {any} */ (erroIncremental)?.code === API_ERROR_CODES.PROVIDER_UNAVAILABLE || opcoes.signal?.aborted || contaTrocou()) {
          throw erroIncremental;
        }
      }
    }
    // D-PROD-318: a hora em que o pedido saiu (o que começou a subir depois dela, a resposta em regra ainda não tem).
    const pedidoEm = Date.now();
    const corpo = await requisitarNaRede(caminho, opcoesDaRede, contexto);
    guardarResposta(tenant, caminho, corpo, { pedido_em: pedidoEm }).catch(() => {});
    registrarHoraDaResposta(tenant, caminho, pedidoEm);
    return corpo;
  } catch (erro) {
    if (guardada && /** @type {any} */ (erro)?.code === API_ERROR_CODES.PROVIDER_UNAVAILABLE && !opcoes.signal?.aborted) {
      return daCopia(guardada, tenant, caminho);
    }
    throw erro;
  }
};

/**
 * D-PROD-230 — POST que responde em Server-Sent Events. Mesmas regras de URL, token e
 * erros HTTP de `nativeRequest` (resposta que não é 200 vira o mesmo `ApiError`).
 * Cada evento chega em `aoEvento({ evento, dados })`; um evento `erro` vira `ApiError`
 * com o código do servidor. `recebeuAlgo` no erro diz se algum byte do fluxo chegou
 * (quem chama decide se dá para repetir pelo caminho sem fluxo).
 *
 * @param {string} caminho
 * @param {{ body: object, signal?: AbortSignal }} opcoes
 * @param {{operation: string, resource: string, details?: object}} contexto
 * @param {(e: { evento: string, dados: any }) => void} aoEvento
 */
export const nativeStream = async (caminho, opcoes, contexto, aoEvento) => {
  const base = getNativeApiUrl();
  if (!base) throw erroDeIndisponibilidade(contexto, new Error('VITE_MAIKE_API_URL ausente'));
  const token = getNativeToken();
  if (!token) {
    throw new ApiError(API_ERROR_CODES.TENANT_CONTEXT_REQUIRED, { operation: contexto.operation, resource: contexto.resource, details: contexto.details ?? null });
  }
  const marcar = (erro, recebeuAlgo) => Object.assign(erro, { recebeuAlgo });
  if (opcoes.signal?.aborted) throw marcar(erroDeIndisponibilidade(contexto, Object.assign(new Error('requisição cancelada'), { name: 'AbortError' })), false);

  let resposta;
  try {
    resposta = await fetch(montarUrl(base, caminho), {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(opcoes.body),
      signal: opcoes.signal,
      credentials: 'omit',
    });
  } catch (erro) {
    throw marcar(erroDeIndisponibilidade(contexto, erro), false);
  }

  if (!resposta.ok) {
    let corpo = null;
    try {
      corpo = await lerCorpo(resposta);
    } catch {
      corpo = null;
    }
    const codigoAssistente = ehObjeto(corpo) && String(corpo.code ?? '').startsWith('ASSISTENTE_') ? CODIGOS_PRESERVADOS[corpo.code] : null;
    if (resposta.status === 503 && codigoAssistente) {
      throw marcar(new ApiError(codigoAssistente, { operation: contexto.operation, resource: contexto.resource, details: detalhesSeguros(corpo, contexto.details), cause: corpo }), true);
    }
    if (resposta.status === 502 || resposta.status === 503 || resposta.status === 504) {
      throw marcar(erroDeIndisponibilidade(contexto, new Error(`HTTP ${resposta.status}`)), false);
    }
    throw marcar(
      new ApiError(traduzirCodigo(ehObjeto(corpo) ? corpo.code : null), { operation: contexto.operation, resource: contexto.resource, details: detalhesSeguros(corpo, contexto.details), cause: corpo }),
      true,
    );
  }

  const tipo = resposta.headers?.get?.('content-type') ?? '';
  if (!resposta.body || !tipo.includes('text/event-stream')) {
    // Algum proxy no caminho não deixou o fluxo passar: quem chama repete sem fluxo.
    throw marcar(erroDeIndisponibilidade(contexto, new Error('resposta sem fluxo')), false);
  }

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let resto = '';
  let recebeuAlgo = false;
  const processarBloco = (bloco) => {
    let evento = 'message';
    let dados = '';
    for (const linha of bloco.split('\n')) {
      if (linha.startsWith('event:')) evento = linha.slice(6).trim();
      else if (linha.startsWith('data:')) dados += linha.slice(5).trim();
    }
    if (!dados) return;
    let valor;
    try {
      valor = JSON.parse(dados);
    } catch {
      return;
    }
    if (evento === 'erro') {
      throw marcar(new ApiError(traduzirCodigo(ehObjeto(valor) ? valor.code : null), { operation: contexto.operation, resource: contexto.resource, details: detalhesSeguros(valor, contexto.details), cause: valor }), true);
    }
    aoEvento({ evento, dados: valor });
  };
  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      recebeuAlgo = true;
      resto += decodificador.decode(value, { stream: true });
      let fim;
      while ((fim = resto.indexOf('\n\n')) >= 0) {
        const bloco = resto.slice(0, fim);
        resto = resto.slice(fim + 2);
        processarBloco(bloco);
      }
    }
    if (resto.trim()) processarBloco(resto);
  } catch (erro) {
    if (erro instanceof ApiError) throw erro;
    throw marcar(erroDeIndisponibilidade(contexto, erro), recebeuAlgo);
  }
};
