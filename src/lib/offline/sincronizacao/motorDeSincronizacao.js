/**
 * Motor de sincronização (D-PROD-295) — o caminho único de gravação que
 * funciona com e sem internet.
 *
 * ─── O que ele é ───────────────────────────────────────────────────────────
 *
 * Um motor GENÉRICO por contrato. Ele não conhece cocho, depósito, lote nem
 * manejo nenhum: conhece "tipos de envio". Cada tipo se registra dizendo
 *
 *   - `tipo`     nome estável (ex.: 'cocho.lancamento'); nunca muda depois de
 *                publicado, porque já pode haver item dele guardado em celular;
 *   - `versao`   versão do formato do payload desse tipo (+ `migrar` opcional);
 *   - `offline`  true = guarda na fila sem internet e envia depois;
 *                false = só grava com internet (como antes);
 *   - `recursos` o que o registro toca (ex.: ['cocho:ID', 'deposito:ID']) —
 *                itens que tocam o mesmo recurso vão ao servidor NA ORDEM;
 *   - `enviar`   como mandar ao servidor, recebendo o `operationId`;
 *   - `rotulo`   texto curto para a pessoa reconhecer o registro na lista;
 *   - `atualiza` (opcional) o que as telas releem depois que um registro deste
 *                tipo chega ao servidor (ex.: ['leiturasCocho']);
 *   - `reajustar` (opcional) no "Tentar de novo" de um item recusado, devolve o
 *                payload corrigido com o que o servidor tem agora (o código
 *                continua o mesmo: o que já foi gravado não é gravado de novo).
 *
 * `enviar` recebe `registrarProgresso`: um tipo com vários passos grava o que
 * já foi confirmado (ex.: a baixa do estoque), e a tela sabe o que não volta.
 *
 * Os manejos de hoje se registram assim, e uma aplicação criada no futuro
 * dentro do sistema também: basta declarar o tipo e se usa offline. O motor
 * não muda.
 *
 * ─── As regras que não mudam ───────────────────────────────────────────────
 *
 * 1. Código único: cada registro nasce com um `operationId` (UUID) no
 *    aparelho, e TODA tentativa de envio leva o mesmo código. O servidor
 *    deduplica pelo código (`OperacaoIdempotente`, ESTAB-P0-01): reenviar
 *    depois de uma queda nunca grava duas vezes.
 * 2. Ordem: itens com recurso em comum saem na ordem em que foram feitos. Se
 *    um deles parar (sem rede, recusado), os de trás do mesmo recurso esperam.
 *    Itens de recursos diferentes não se seguram.
 * 3. Nada some: item recusado pelo servidor vai para "precisa de atenção",
 *    com o motivo. Só sai da fila se a pessoa descartar — nunca por heurística.
 * 4. Dono: a fila é por fazenda (tenant) e por usuário. Só vai ao servidor
 *    com a sessão do mesmo dono — mandar com o token de outro gravaria em
 *    nome dele.
 * 5. Formato versionado: item gravado por um formato que este app não
 *    conhece fica intocado na fila, em vez de ser enviado ou apagado.
 *
 * ─── Ligação entre registros ───────────────────────────────────────────────
 *
 * Um registro feito sem internet pode precisar do id que o servidor ainda vai
 * dar a outro (ex.: o 2º lançamento do cocho cita o 1º). O payload guarda
 * `referenciaAoResultado(operationIdDoOutro, 'evento.id')`; no envio, a
 * referência é trocada pelo valor real do resultado já confirmado. Enquanto o
 * outro não foi confirmado, este espera.
 */

import { API_ERROR_CODES, getApiErrorMessage } from '@/apis/_core/ApiError';
import { criarFilaIndexedDB, filaDeEnvioDisponivel } from './filaDeEnvio.js';

/** @typedef {import('./filaDeEnvio.js').ItemDaFila} ItemDaFila */
/** @typedef {import('./filaDeEnvio.js').PortaDaFila} PortaDaFila */

/**
 * @typedef {{
 *   tipo: string,
 *   versao: number,
 *   offline: boolean,
 *   recursos?: (payload: any) => string[],
 *   rotulo?: (payload: any) => string,
 *   enviar: (payload: any, contexto: {operationId: string, empresaId: string|null,
 *            registrarProgresso: (progresso: Record<string, unknown>) => Promise<void>}) => Promise<unknown>,
 *   migrar?: (payload: any, versaoAntiga: number) => any,
 *   atualiza?: string[],
 *   reajustar?: (payload: any, contexto: {ultimoErro: ItemDaFila['ultimo_erro'], progresso: Record<string, unknown>}) => Promise<any>,
 * }} TipoDeEnvio
 *
 * @typedef {{cliente_id: string, usuario_id: string|null}} SessaoDaFila
 *
 * @typedef {{estado: 'enviado', operationId: string, resultado: unknown}
 *         | {estado: 'aguardando', operationId: string}} ResultadoDoEnvio
 *
 * @typedef {{
 *   aguardando: number,
 *   atencao: number,
 *   enviando: boolean,
 *   atualizar?: string[],
 *   itens: Array<{id: string, tipo: string, rotulo: string, estado: string, criado_em: string,
 *                 tentativas: number, ultimo_erro: ItemDaFila['ultimo_erro'], esperando: boolean,
 *                 confirmando: boolean, progresso: Record<string, any>}>,
 * }} ResumoDaFila
 */

/** Formato do item da fila. Subir só com migração e decisão própria. */
export const FORMATO_DA_FILA = 1;

/** Evento disparado no `window` a cada mudança da fila. */
export const EVENTO_FILA_DE_ENVIO = 'maike:fila-de-envio';

/** Intervalos entre tentativas sem rede (ms). Depois do último, repete o último. */
const ESPERAS_MS = Object.freeze([5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000]);
/** Erro do próprio servidor (5xx com corpo) vira "precisa de atenção" depois disto. */
const TENTATIVAS_COM_ERRO_DO_SERVIDOR = 5;
/** Item enviado fica guardado este tempo (para quem cita o resultado dele). */
const GUARDAR_ENVIADO_MS = 7 * 24 * 3600 * 1000;

const PREFIXO_REFERENCIA = '@@resultado:';

/** Códigos do servidor que significam "tente de novo daqui a pouco", não recusa. */
const CODIGOS_PASSAGEIROS = new Set(['IDEMPOTENCY_IN_PROGRESS', 'CONCURRENCY_CONFLICT', 'INTERNAL_ERROR', 'RATE_LIMITED']);

/** @type {Map<string, TipoDeEnvio>} */
const TIPOS = new Map();

/**
 * D-PROD-298 (revisão): mudanças num item da fila acontecem uma de cada vez —
 * editar, excluir, "tentar de novo" e o envio tomando o item para si. Sem isto,
 * uma edição feita enquanto a passada esperava o item anterior era sobrescrita
 * pela cópia antiga que a passada levava.
 */
/** @type {Promise<unknown>} */
let cadeiaDaFila = Promise.resolve();
/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
const exclusivo = (fn) => {
  const r = cadeiaDaFila.then(fn);
  cadeiaDaFila = r.catch(() => {});
  return r;
};

/** @type {PortaDaFila|null} */
let porta = null;
/** @type {SessaoDaFila|null} */
let sessao = null;
/** @type {() => number} */
let agora = () => Date.now();
/** @type {() => boolean} */
let online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
/** @type {Promise<ResumoDaFila>|null} */
let passadaEmCurso = null;

const portaDaFila = () => {
  if (!porta && filaDeEnvioDisponivel()) porta = criarFilaIndexedDB();
  return porta;
};

/** @param {string[]} [atualizar] o que as telas devem reler (registros que chegaram ao servidor) */
const emitir = (atualizar) => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_FILA_DE_ENVIO, { detail: { atualizar: atualizar ?? [] } }));
  } catch {
    // sem window: nada a avisar
  }
};

/**
 * Só para teste: troca a porta, o relógio e o detector de rede, e zera o
 * estado do motor.
 *
 * @param {{porta?: PortaDaFila|null, agora?: () => number, online?: () => boolean}} [opcoes]
 */
export const configurarMotorDeSincronizacao = (opcoes = {}) => {
  TIPOS.clear();
  porta = opcoes.porta ?? null;
  sessao = null;
  passadaEmCurso = null;
  if (opcoes.agora) agora = opcoes.agora;
  if (opcoes.online) online = opcoes.online;
};

/**
 * Registra um tipo de envio. Registrar o mesmo tipo de novo substitui (o módulo
 * pode ser recarregado); nome vazio, versão inválida ou sem `enviar` é erro de
 * programação e para na hora.
 *
 * @param {TipoDeEnvio} definicao
 */
export const registrarTipoDeEnvio = (definicao) => {
  const { tipo, versao, enviar, offline } = definicao ?? /** @type {any} */ ({});
  if (typeof tipo !== 'string' || !/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/.test(tipo)) {
    throw new Error(`sincronização: nome de tipo inválido "${tipo}" (use "modulo.acao")`);
  }
  if (!Number.isInteger(versao) || versao < 1) throw new Error(`sincronização: versão inválida em "${tipo}"`);
  if (typeof enviar !== 'function') throw new Error(`sincronização: "${tipo}" precisa de enviar()`);
  if (typeof offline !== 'boolean') throw new Error(`sincronização: "${tipo}" precisa declarar offline: true|false`);
  TIPOS.set(tipo, Object.freeze({ ...definicao }));
};

/** Tipos registrados e se cada um usa offline (para inventário e testes). */
export const tiposDeEnvioRegistrados = () =>
  [...TIPOS.values()].map(({ tipo, versao, offline }) => ({ tipo, versao, offline }));

/**
 * Dono da fila nesta sessão. `null` no logout: nada é enviado sem dono.
 * @param {SessaoDaFila|null} nova
 */
export const definirSessaoDaFila = (nova) => {
  sessao = nova && nova.cliente_id ? { cliente_id: String(nova.cliente_id), usuario_id: nova.usuario_id ? String(nova.usuario_id) : null } : null;
  emitir();
};

/** @param {ItemDaFila} item */
const eDaSessao = (item) =>
  Boolean(sessao) && item.cliente_id === sessao?.cliente_id && (item.usuario_id ?? null) === (sessao?.usuario_id ?? null);

const novoOperationId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // segue para o reserva
  }
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
};

/**
 * Marca, dentro de um payload, "o valor X do resultado do registro Y". Trocada
 * pelo valor real no envio, quando Y já foi confirmado pelo servidor.
 *
 * @param {string} operationId do registro de quem se quer o resultado
 * @param {string} caminho no resultado, com pontos (ex.: 'evento.id')
 */
export const referenciaAoResultado = (operationId, caminho) => `${PREFIXO_REFERENCIA}${operationId}:${caminho}`;

/**
 * O registro citado por uma referência (`referenciaAoResultado`), ou null.
 * @param {unknown} valor
 * @returns {string|null}
 */
export const operacaoDaReferencia = (valor) => {
  if (typeof valor !== 'string' || !valor.startsWith(PREFIXO_REFERENCIA)) return null;
  const resto = valor.slice(PREFIXO_REFERENCIA.length);
  const fim = resto.indexOf(':');
  return fim > 0 ? resto.slice(0, fim) : null;
};

/** @param {unknown} valor @param {Set<string>} [acc] */
const referenciasNoPayload = (valor, acc = new Set()) => {
  if (typeof valor === 'string' && valor.startsWith(PREFIXO_REFERENCIA)) {
    const resto = valor.slice(PREFIXO_REFERENCIA.length);
    const fim = resto.indexOf(':');
    if (fim > 0) acc.add(resto.slice(0, fim));
  } else if (Array.isArray(valor)) {
    valor.forEach((v) => referenciasNoPayload(v, acc));
  } else if (valor && typeof valor === 'object') {
    Object.values(valor).forEach((v) => referenciasNoPayload(v, acc));
  }
  return acc;
};

/** @param {unknown} obj @param {string} caminho */
const lerCaminho = (obj, caminho) =>
  caminho.split('.').reduce((/** @type {any} */ atual, chave) => (atual == null ? undefined : atual[chave]), obj);

/**
 * Troca cada referência pelo valor do resultado já confirmado.
 * @param {unknown} valor
 * @param {Map<string, unknown>} resultados
 * @returns {unknown}
 */
const resolverReferencias = (valor, resultados) => {
  if (typeof valor === 'string' && valor.startsWith(PREFIXO_REFERENCIA)) {
    const resto = valor.slice(PREFIXO_REFERENCIA.length);
    const fim = resto.indexOf(':');
    const id = resto.slice(0, fim);
    const achado = lerCaminho(resultados.get(id), resto.slice(fim + 1));
    if (achado === undefined) throw new ErroDeReferencia(id);
    return achado;
  }
  if (Array.isArray(valor)) return valor.map((v) => resolverReferencias(v, resultados));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, resolverReferencias(v, resultados)]));
  }
  return valor;
};

class ErroDeReferencia extends Error {
  /** @param {string} operationId */
  constructor(operationId) {
    super(`o registro ${operationId} não trouxe o valor esperado`);
    this.operationId = operationId;
  }
}

/**
 * Como tratar uma falha de envio.
 *  - 'rede'     sem resposta do servidor: tenta de novo mais tarde, sem limite;
 *  - 'sessao'   o servidor não reconheceu a sessão: espera a pessoa entrar de novo;
 *  - 'servidor' erro do servidor sem motivo de negócio, ou a mesma operação
 *               ainda em processamento: tenta algumas vezes;
 *  - 'recusado' o servidor respondeu "não": precisa de atenção da pessoa.
 *
 * @param {unknown} erro
 * @returns {'rede'|'sessao'|'servidor'|'recusado'}
 */
export const classificarFalhaDeEnvio = (erro) => {
  const codigo = /** @type {any} */ (erro)?.code;
  const doServidor = /** @type {any} */ (erro)?.cause?.code;
  if (codigo === API_ERROR_CODES.PROVIDER_UNAVAILABLE) return 'rede';
  if (codigo === API_ERROR_CODES.TENANT_CONTEXT_REQUIRED) return 'sessao';
  // Passageiro do lado do servidor (a mesma operação ainda em processamento,
  // trava concorrente, erro interno): esperar e perguntar de novo.
  if (typeof doServidor === 'string' && CODIGOS_PASSAGEIROS.has(doServidor)) return 'servidor';
  // O cliente HTTP traduz para OPERATION_FAILED todo código que não está no
  // catálogo do app. Com o código do servidor junto, é uma resposta de negócio
  // ("o cocho mudou", "saldo insuficiente"): definitiva. Sem código, é erro do
  // servidor sem motivo: tenta mais algumas vezes.
  if (codigo === API_ERROR_CODES.OPERATION_FAILED && !(typeof doServidor === 'string' && doServidor)) return 'servidor';
  return 'recusado';
};

/**
 * Motivo guardado no item. O tipo pode explicar melhor o que fazer
 * (`erro.mensagemDaFila`, ex.: "a baixa já foi feita; tente de novo").
 * @param {unknown} erro
 */
const resumoDoErro = (erro) => {
  const base = getApiErrorMessage(erro, /** @type {any} */ (erro)?.message || 'O servidor recusou este registro.');
  const extra = /** @type {any} */ (erro)?.mensagemDaFila;
  return {
    codigo: String(/** @type {any} */ (erro)?.cause?.code ?? /** @type {any} */ (erro)?.code ?? 'ERRO'),
    mensagem: typeof extra === 'string' && extra.trim() ? `${base} ${extra.trim()}` : base,
    em: new Date(agora()).toISOString(),
  };
};

/** @param {number} tentativas */
const esperaDepoisDe = (tentativas) => ESPERAS_MS[Math.min(Math.max(tentativas - 1, 0), ESPERAS_MS.length - 1)];

/**
 * Ordem de criação. A `sequencia` (monotônica, gravada no item) decide; o
 * horário só desempata itens sem ela. Dois registros no mesmo milissegundo
 * nunca trocam de lugar.
 * @param {ItemDaFila} a @param {ItemDaFila} b
 */
const emOrdem = (a, b) => {
  const sa = Number.isFinite(a.sequencia) ? /** @type {number} */ (a.sequencia) : null;
  const sb = Number.isFinite(b.sequencia) ? /** @type {number} */ (b.sequencia) : null;
  if (sa !== null && sb !== null && sa !== sb) return sa - sb;
  if (a.criado_em !== b.criado_em) return a.criado_em < b.criado_em ? -1 : 1;
  return a.id < b.id ? -1 : 1;
};

/** Última sequência dada nesta carga do app (junta com a maior já gravada). */
let ultimaSequencia = 0;
/** @param {ItemDaFila[]} itens */
const proximaSequencia = (itens) => {
  const maiorGravada = itens.reduce((m, i) => (Number.isFinite(i.sequencia) ? Math.max(m, /** @type {number} */ (i.sequencia)) : m), 0);
  ultimaSequencia = Math.max(ultimaSequencia, maiorGravada) + 1;
  return ultimaSequencia;
};

/** A sessão ainda é a mesma de quando a passada começou? */
const mesmaSessao = (/** @type {SessaoDaFila} */ dono) =>
  Boolean(sessao) && sessao?.cliente_id === dono.cliente_id && (sessao?.usuario_id ?? null) === (dono.usuario_id ?? null);

/** @param {TipoDeEnvio} def @param {unknown} payload */
const recursosDe = (def, payload) => {
  const lista = typeof def.recursos === 'function' ? def.recursos(payload) : [];
  return [...new Set((Array.isArray(lista) ? lista : []).filter((r) => typeof r === 'string' && r))];
};

/** @param {TipoDeEnvio} def @param {unknown} payload */
const rotuloDe = (def, payload) => {
  try {
    const texto = typeof def.rotulo === 'function' ? def.rotulo(payload) : '';
    return typeof texto === 'string' && texto.trim() ? texto.trim().slice(0, 160) : def.tipo;
  } catch {
    return def.tipo;
  }
};

const erroSemInternet = (/** @type {string} */ tipo) => {
  const erro = new Error('Este registro precisa de internet para ser salvo.');
  /** @type {any} */ (erro).code = API_ERROR_CODES.PROVIDER_UNAVAILABLE;
  /** @type {any} */ (erro).tipo = tipo;
  return erro;
};

/**
 * Grava um registro: com internet, vai direto ao servidor; sem internet (ou se
 * a rede cair no meio), fica na fila com o mesmo código e sai depois.
 *
 * Com internet e o servidor recusando, o erro volta para a tela na hora, como
 * sempre: a pessoa está ali para corrigir. Só a falta de rede vira fila.
 *
 * Também vai para a fila, mesmo com internet, o registro que cita outro ainda
 * não confirmado ou que toca um recurso com item esperando na fila — enviar
 * agora passaria na frente.
 *
 * @param {string} tipo
 * @param {unknown} payload
 * @param {{empresaId?: string|null, operationId?: string, rotulo?: string}} [opcoes]
 *        `rotulo`: texto da lista de envio, quando a tela sabe mais que o payload
 *        (ex.: o nome do cocho).
 * @returns {Promise<ResultadoDoEnvio>}
 */
export const enviarOuGuardar = async (tipo, payload, opcoes = {}) => {
  const def = TIPOS.get(tipo);
  if (!def) throw new Error(`sincronização: tipo "${tipo}" não registrado`);
  const operationId = opcoes.operationId || novoOperationId();
  const empresaId = opcoes.empresaId ?? null;
  const fila = portaDaFila();
  const podeGuardar = def.offline && Boolean(fila) && Boolean(sessao);
  const recursos = recursosDe(def, payload);
  const referencias = [...referenciasNoPayload(payload)];

  const itens = fila && sessao ? (await fila.listar()).filter(eDaSessao) : [];
  const porId = new Map(itens.map((i) => [i.id, i]));
  // O mesmo registro de novo (a tela reenviou o mesmo código): não duplica nem
  // regrava. Na fila, continua esperando; já enviado, devolve o resultado.
  const jaNaFila = porId.get(operationId);
  if (jaNaFila && jaNaFila.tipo === tipo) {
    if (jaNaFila.estado === 'enviado') return { estado: 'enviado', operationId, resultado: jaNaFila.resultado };
    return { estado: 'aguardando', operationId };
  }
  const naoConfirmado = (/** @type {string} */ id) => porId.get(id)?.estado !== 'enviado';
  const temQueEsperar =
    referencias.some(naoConfirmado) ||
    itens.some((i) => i.estado !== 'enviado' && i.recursos.some((r) => recursos.includes(r)));

  /**
   * Grava o item. 'pendente' espera envio; 'enviado' guarda o resultado de um
   * envio direto, para quem citar este registro depois (referência).
   * @param {'pendente'|'enviado'} [estado]
   * @param {unknown} [resultado]
   * @param {boolean} [tentado] já houve tentativa de envio (a rede caiu no meio)
   */
  const guardar = async (estado = 'pendente', resultado = undefined, tentado = false, progresso = undefined) => {
    if (!podeGuardar || !fila || !sessao) throw erroSemInternet(tipo);
    const enviado = estado === 'enviado';
    /** @type {ItemDaFila} */
    const item = {
      id: operationId,
      formato: FORMATO_DA_FILA,
      tipo,
      versao: def.versao,
      cliente_id: sessao.cliente_id,
      usuario_id: sessao.usuario_id,
      empresa_id: empresaId,
      payload: JSON.parse(JSON.stringify(payload ?? null)),
      recursos,
      referencias,
      rotulo: typeof opcoes.rotulo === 'string' && opcoes.rotulo.trim() ? opcoes.rotulo.trim().slice(0, 160) : rotuloDe(def, payload),
      criado_em: new Date(agora()).toISOString(),
      sequencia: proximaSequencia(itens),
      estado,
      tentado: tentado || estado === 'enviado',
      tentativas: 0,
      proxima_tentativa_em: 0,
      ultimo_erro: null,
      enviado_em: enviado ? new Date(agora()).toISOString() : null,
      ...(enviado ? { resultado: JSON.parse(JSON.stringify(resultado ?? null)) } : {}),
      ...(progresso && Object.keys(progresso).length ? { progresso: JSON.parse(JSON.stringify(progresso)) } : {}),
    };
    await fila.gravar(item);
    emitir();
    if (!enviado) agendarSincronizacao();
    return /** @type {ResultadoDoEnvio} */ ({ estado: 'aguardando', operationId });
  };

  if (!online() || temQueEsperar) return guardar();

  const resultados = new Map(itens.filter((i) => i.estado === 'enviado').map((i) => [i.id, i.resultado]));
  /** @type {Record<string, unknown>} */
  const progressoDoEnvio = {};
  try {
    const resultado = await def.enviar(resolverReferencias(payload, resultados), {
      operationId,
      empresaId,
      registrarProgresso: async (p) => {
        Object.assign(progressoDoEnvio, p);
      },
    });
    // O resultado fica guardado (como no envio pela fila): um registro seguinte
    // pode citar o id que o servidor deu a este.
    if (podeGuardar) {
      try {
        await guardar('enviado', resultado);
      } catch {
        // o registro já está no servidor; só a referência futura fica sem ele
      }
    }
    return { estado: 'enviado', operationId, resultado };
  } catch (erro) {
    // A rede caiu no meio: o servidor pode ter gravado ou não. Na fila, com o
    // MESMO código, o reenvio é deduplicado — nunca duas vezes.
    if (classificarFalhaDeEnvio(erro) === 'rede' && podeGuardar) return guardar('pendente', undefined, true, progressoDoEnvio);
    throw erro;
  }
};

/** @type {ReturnType<typeof setTimeout>|null} */
let agendada = null;

/** Pede uma passada logo (junta pedidos seguidos numa só). */
export const agendarSincronizacao = (atrasoMs = 1500) => {
  if (agendada || typeof setTimeout === 'undefined') return;
  agendada = setTimeout(() => {
    agendada = null;
    void sincronizar();
  }, atrasoMs);
};

/**
 * Uma passada pela fila desta sessão, em ordem. Nunca roda duas ao mesmo tempo
 * (quem pede durante uma passada recebe a mesma).
 *
 * @returns {Promise<ResumoDaFila>}
 */
export const sincronizar = () => {
  if (!passadaEmCurso) {
    let atualizar = /** @type {string[]} */ ([]);
    passadaEmCurso = passada()
      .then((r) => {
        atualizar = r.atualizar ?? [];
        return r;
      })
      .finally(() => {
        passadaEmCurso = null;
        emitir(atualizar);
      });
    emitir();
  }
  return passadaEmCurso;
};

const passada = async () => {
  const fila = portaDaFila();
  if (!fila || !sessao || !online()) return resumoDaFila();
  // Dono desta passada. Se a sessão mudar no meio (saiu e outra conta entrou),
  // a passada para antes do próximo envio: o token já seria o da outra conta.
  const dono = { ...sessao };

  const todos = (await fila.listar()).filter(eDaSessao).sort(emOrdem);
  /** @type {Map<string, unknown>} */
  const resultados = new Map(todos.filter((i) => i.estado === 'enviado').map((i) => [i.id, i.resultado]));
  const existentes = new Set(todos.map((i) => i.id));
  const recursosParados = new Set();
  const itensParados = new Set();
  /** O que as telas precisam reler: `atualiza` dos tipos que chegaram ao servidor nesta passada. */
  const atualizar = new Set();
  const fim = async () => ({ ...(await resumoDaFila()), atualizar: [...atualizar] });

  /** @param {ItemDaFila} item */
  const parar = (item) => {
    item.recursos.forEach((r) => recursosParados.add(r));
    itensParados.add(item.id);
  };

  /** @param {ItemDaFila} item @param {ItemDaFila['ultimo_erro']} motivo */
  const precisaDeAtencao = async (item, motivo) => {
    await fila.gravar({ ...item, estado: 'atencao', ultimo_erro: motivo });
    parar(item);
    emitir();
  };

  for (const doRetrato of todos) {
    if (doRetrato.estado === 'enviado') continue;
    // A versão mais nova do item (pode ter sido editado ou excluído desde o retrato).
    /** @type {ItemDaFila|undefined} */
    let item = await fila.ler(doRetrato.id);
    if (!item || !eDaSessao(item)) continue;
    if (item.estado === 'enviado') continue;
    if (item.estado === 'atencao') {
      parar(item);
      continue;
    }
    if (!mesmaSessao(dono)) return fim();
    const def = TIPOS.get(item.tipo);
    // Formato ou versão que este app não conhece, tipo ainda não carregado, ou
    // versão antiga sem migração declarada: fica intocado e segura quem vem
    // atrás no mesmo recurso (enviar o payload antigo como se fosse o novo
    // gravaria errado).
    const versaoSemMigracao = Boolean(def) && item.versao < /** @type {TipoDeEnvio} */ (def).versao && typeof def?.migrar !== 'function';
    if (item.formato !== FORMATO_DA_FILA || !def || item.versao > def.versao || versaoSemMigracao) {
      parar(item);
      continue;
    }
    if (item.recursos.some((r) => recursosParados.has(r)) || item.referencias.some((id) => itensParados.has(id))) {
      parar(item);
      continue;
    }
    if (item.proxima_tentativa_em > agora()) {
      parar(item);
      continue;
    }
    const perdida = item.referencias.find((id) => !existentes.has(id));
    if (perdida) {
      await precisaDeAtencao(item, {
        codigo: 'REFERENCIA_DESCARTADA',
        mensagem: 'Este registro dependia de outro que foi descartado da fila.',
        em: new Date(agora()).toISOString(),
      });
      continue;
    }

    let payload = item.payload;
    let erroAoMontar = null;
    try {
      if (item.versao < def.versao && typeof def.migrar === 'function') payload = def.migrar(payload, item.versao);
      payload = resolverReferencias(payload, resultados);
    } catch (erro) {
      erroAoMontar = erro;
    }
    if (erroAoMontar) {
      await precisaDeAtencao(item, {
        codigo: erroAoMontar instanceof ErroDeReferencia ? 'REFERENCIA_SEM_VALOR' : 'MIGRACAO_FALHOU',
        mensagem: 'Não foi possível montar este registro para envio.',
        em: new Date(agora()).toISOString(),
      });
      continue;
    }

    if (!mesmaSessao(dono)) return fim();
    // A partir daqui o servidor pode receber: o item passa a "confirmando envio"
    // (não se exclui nem se edita até o servidor responder). Tomado de forma
    // exclusiva: se foi editado depois desta leitura, não sai nesta passada.
    const montado = item;
    const tomado = await exclusivo(async () => {
      const fresco = await fila.ler(montado.id);
      if (!fresco || fresco.estado !== 'pendente' || (fresco.revisao ?? 0) !== (montado.revisao ?? 0)) return null;
      if (!fresco.tentado) {
        fresco.tentado = true;
        await fila.gravar(fresco);
      }
      return fresco;
    });
    if (!tomado) {
      parar(montado);
      continue;
    }
    item = tomado;
    try {
      const resultado = await def.enviar(payload, {
        operationId: item.id,
        empresaId: item.empresa_id,
        registrarProgresso: async (p) => {
          const alvo = /** @type {ItemDaFila} */ (item);
          alvo.progresso = { ...(alvo.progresso ?? {}), ...p };
          await exclusivo(async () => {
            const fresco = await fila.ler(alvo.id);
            if (fresco) await fila.gravar({ ...fresco, progresso: alvo.progresso });
          });
        },
      });
      await fila.gravar({
        ...item,
        estado: 'enviado',
        resultado: JSON.parse(JSON.stringify(resultado ?? null)),
        enviado_em: new Date(agora()).toISOString(),
        ultimo_erro: null,
      });
      resultados.set(item.id, resultado);
      (def.atualiza ?? []).forEach((chave) => atualizar.add(chave));
      emitir();
    } catch (erro) {
      const tipoDeFalha = classificarFalhaDeEnvio(erro);
      if (tipoDeFalha === 'sessao') return fim();
      const tentativas = item.tentativas + 1;
      if (tipoDeFalha === 'rede') {
        await fila.gravar({ ...item, tentativas, proxima_tentativa_em: agora() + esperaDepoisDe(tentativas), ultimo_erro: resumoDoErro(erro) });
        emitir();
        // Sem rede para um, sem rede para os outros: para a passada.
        return fim();
      }
      if (tipoDeFalha === 'servidor' && tentativas < TENTATIVAS_COM_ERRO_DO_SERVIDOR) {
        await fila.gravar({ ...item, tentativas, proxima_tentativa_em: agora() + esperaDepoisDe(tentativas), ultimo_erro: resumoDoErro(erro) });
        parar(item);
        emitir();
        continue;
      }
      await precisaDeAtencao({ ...item, tentativas }, resumoDoErro(erro));
    }
  }

  await limparEnviadosAntigos(fila);
  return fim();
};

/** @param {PortaDaFila} fila */
const limparEnviadosAntigos = async (fila) => {
  const todos = await fila.listar();
  const citados = new Set(todos.filter((i) => i.estado !== 'enviado').flatMap((i) => i.referencias ?? []));
  const limite = agora() - GUARDAR_ENVIADO_MS;
  for (const item of todos) {
    if (item.estado !== 'enviado' || citados.has(item.id)) continue;
    const quando = Date.parse(item.enviado_em ?? '') || 0;
    if (quando < limite) await fila.remover(item.id);
  }
};

/**
 * O que está na fila desta sessão, para a tela.
 * @returns {Promise<ResumoDaFila>}
 */
export const resumoDaFila = async () => {
  const fila = portaDaFila();
  const itens = fila && sessao ? (await fila.listar()).filter(eDaSessao).filter((i) => i.estado !== 'enviado').sort(emOrdem) : [];
  return {
    aguardando: itens.filter((i) => i.estado === 'pendente').length,
    atencao: itens.filter((i) => i.estado === 'atencao').length,
    enviando: Boolean(passadaEmCurso),
    itens: itens.map((i) => ({
      id: i.id,
      tipo: i.tipo,
      rotulo: i.rotulo,
      estado: i.estado,
      criado_em: i.criado_em,
      tentativas: i.tentativas,
      ultimo_erro: i.ultimo_erro,
      esperando: i.estado === 'pendente' && i.proxima_tentativa_em > agora(),
      confirmando: i.estado === 'pendente' && Boolean(i.tentado),
      progresso: i.progresso ?? {},
    })),
  };
};

/**
 * Registros desta sessão ainda não confirmados, de um tipo — para a tela
 * mostrar na hora o que foi feito sem internet.
 *
 * @param {string} tipo
 * @returns {Promise<Array<{operationId: string, payload: unknown, estado: string, criado_em: string,
 *   tentado: boolean, progresso: Record<string, any>}>>}
 */
export const registrosAguardandoDoTipo = async (tipo) => {
  const fila = portaDaFila();
  if (!fila || !sessao) return [];
  return (await fila.listar())
    .filter((i) => eDaSessao(i) && i.tipo === tipo && i.estado !== 'enviado')
    .sort(emOrdem)
    .map((i) => ({
      operationId: i.id,
      payload: i.payload,
      estado: i.estado,
      criado_em: i.criado_em,
      // Já tentou subir: o servidor pode ter gravado (ou gravado parte, ver `progresso`).
      tentado: Boolean(i.tentado),
      progresso: i.progresso ?? {},
    }));
};

/**
 * Situação de um registro na fila desta sessão:
 *  - 'aguardando'   nunca tentou subir: pode excluir ou editar;
 *  - 'confirmando'  tentou e o servidor não respondeu: espera;
 *  - 'atencao'      o servidor recusou;
 *  - 'enviado'      está no servidor;
 *  - null           não está na fila.
 * @param {string} id
 * @returns {Promise<'aguardando'|'confirmando'|'atencao'|'enviado'|null>}
 */
export const situacaoNaFila = async (id) => {
  const fila = portaDaFila();
  const item = fila && id ? await fila.ler(id) : undefined;
  if (!item || !eDaSessao(item)) return null;
  if (item.estado === 'enviado' || item.estado === 'atencao') return item.estado;
  return item.tentado ? 'confirmando' : 'aguardando';
};

/** Há registro desta sessão que ainda não chegou ao servidor? (aviso ao sair) */
export const temRegistrosNaoEnviados = async () => {
  const r = await resumoDaFila();
  return r.aguardando + r.atencao > 0;
};

/**
 * "Tentar de novo": o item volta para a fila (ex.: a pessoa deu entrada no
 * estoque que faltava). Só itens desta sessão.
 * @param {string} id
 */
export const tentarDeNovo = (id) => exclusivo(() => tentarDeNovoJa(id));

/** @param {string} id */
const tentarDeNovoJa = async (id) => {
  const fila = portaDaFila();
  const item = fila ? await fila.ler(id) : undefined;
  if (!fila || !item || !eDaSessao(item) || item.estado === 'enviado') return false;
  const def = TIPOS.get(item.tipo);
  let payload = item.payload;
  if (item.estado === 'atencao' && typeof def?.reajustar === 'function') {
    try {
      payload = await def.reajustar(item.payload, { ultimoErro: item.ultimo_erro, progresso: item.progresso ?? {} });
    } catch (erro) {
      // Sem conseguir reajustar (sem rede, por exemplo): continua em atenção, com o motivo.
      await fila.gravar({ ...item, ultimo_erro: resumoDoErro(erro) });
      emitir();
      return false;
    }
  }
  await fila.gravar({
    ...item,
    payload: JSON.parse(JSON.stringify(payload ?? null)),
    referencias: [...referenciasNoPayload(payload)],
    estado: 'pendente',
    tentativas: 0,
    proxima_tentativa_em: 0,
  });
  emitir();
  agendarSincronizacao(0);
  return true;
};

/**
 * Descartar: a pessoa decidiu que este registro não vai ao servidor. Única
 * forma de um item não enviado sair da fila. Quem dependia dele vai para
 * "precisa de atenção" na próxima passada.
 * @param {string} id
 */
export const descartarDaFila = (id) => exclusivo(() => descartarDaFilaJa(id));

/** @param {string} id */
const descartarDaFilaJa = async (id) => {
  const fila = portaDaFila();
  const item = fila ? await fila.ler(id) : undefined;
  if (!fila || !item || !eDaSessao(item) || item.estado === 'enviado') return false;
  // Já tentou subir e o servidor não respondeu: pode ter gravado. Só depois da
  // resposta (enviado, ou recusado → atenção) dá para decidir.
  if (item.estado === 'pendente' && item.tentado) return false;
  // Lá vai "precisa de atenção" quem citava este (próxima passada): avisar antes é da tela.
  await fila.remover(id);
  emitir();
  return true;
};

/**
 * D-PROD-298 — dá para editar este registro na fila? Só quando o servidor
 * certamente não tem nada dele:
 *  - esperando e nunca tentou subir; ou
 *  - recusado ("precisa de atenção") sem nenhum passo confirmado (`progresso`
 *    vazio) — a recusa não gravou nada.
 * @param {ItemDaFila} item
 */
const podeAlterar = (item) =>
  (item.estado === 'pendente' && !item.tentado) ||
  (item.estado === 'atencao' && Object.keys(item.progresso ?? {}).length === 0);

/**
 * Corrige o registro na fila: o payload novo toma o lugar do antigo, na MESMA
 * posição (sequência) e com o MESMO código. Quem cita este registro continua
 * citando. Devolve false quando não dá mais (subindo, já enviado, passo já
 * confirmado no servidor).
 *
 * @param {string} id
 * @param {unknown} payload
 * @param {{ rotulo?: string }} [opcoes]
 */
export const alterarNaFila = (id, payload, opcoes = {}) => exclusivo(() => alterarNaFilaJa(id, payload, opcoes));

/** @param {string} id @param {unknown} payload @param {{ rotulo?: string }} opcoes */
const alterarNaFilaJa = async (id, payload, opcoes) => {
  const fila = portaDaFila();
  const item = fila ? await fila.ler(id) : undefined;
  if (!fila || !item || !eDaSessao(item) || !podeAlterar(item)) return false;
  const def = TIPOS.get(item.tipo);
  if (!def) return false;
  const referencias = [...referenciasNoPayload(payload)];
  if (referencias.includes(id)) return false;
  await fila.gravar({
    ...item,
    payload: JSON.parse(JSON.stringify(payload ?? null)),
    versao: def.versao,
    recursos: recursosDe(def, payload),
    referencias,
    rotulo: typeof opcoes.rotulo === 'string' && opcoes.rotulo.trim() ? opcoes.rotulo.trim().slice(0, 160) : rotuloDe(def, payload),
    estado: 'pendente',
    revisao: (item.revisao ?? 0) + 1,
    tentativas: 0,
    proxima_tentativa_em: 0,
    ultimo_erro: null,
  });
  emitir();
  agendarSincronizacao();
  return true;
};

/**
 * Registros desta sessão, ainda não enviados, que citam este (o 2º lançamento
 * do cocho cita o 1º). Para a tela avisar antes de excluir.
 * @param {string} id
 * @returns {Promise<Array<{id: string, rotulo: string}>>}
 */
export const dependentesNaFila = async (id) => {
  const fila = portaDaFila();
  if (!fila || !sessao) return [];
  return (await fila.listar())
    .filter((i) => eDaSessao(i) && i.estado !== 'enviado' && (i.referencias ?? []).includes(id))
    .sort(emOrdem)
    .map((i) => ({ id: i.id, rotulo: i.rotulo }));
};

/**
 * O registro da fila desta sessão (para a tela abrir o formulário de edição).
 * @param {string} id
 */
export const registroNaFila = async (id) => {
  const fila = portaDaFila();
  const item = fila && id ? await fila.ler(id) : undefined;
  if (!item || !eDaSessao(item) || item.estado === 'enviado') return null;
  return { operationId: item.id, tipo: item.tipo, payload: item.payload, estado: item.estado, podeAlterar: podeAlterar(item), progresso: item.progresso ?? {} };
};
