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
 *   - `rotulo`   texto curto para a pessoa reconhecer o registro na lista.
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
 *   enviar: (payload: any, contexto: {operationId: string, empresaId: string|null}) => Promise<unknown>,
 *   migrar?: (payload: any, versaoAntiga: number) => any,
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
 *   itens: Array<{id: string, tipo: string, rotulo: string, estado: string, criado_em: string,
 *                 tentativas: number, ultimo_erro: ItemDaFila['ultimo_erro'], esperando: boolean}>,
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

/** @type {Map<string, TipoDeEnvio>} */
const TIPOS = new Map();

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

const emitir = () => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_FILA_DE_ENVIO));
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
  if (codigo === API_ERROR_CODES.PROVIDER_UNAVAILABLE) return 'rede';
  if (codigo === API_ERROR_CODES.TENANT_CONTEXT_REQUIRED) return 'sessao';
  if (codigo === API_ERROR_CODES.OPERATION_FAILED) return 'servidor';
  // A mesma operação ainda está sendo gravada no servidor (outra tentativa
  // chegou antes): não é recusa, é esperar e perguntar de novo.
  if (/** @type {any} */ (erro)?.cause?.code === 'IDEMPOTENCY_IN_PROGRESS') return 'servidor';
  return 'recusado';
};

/** @param {unknown} erro */
const resumoDoErro = (erro) => ({
  codigo: String(/** @type {any} */ (erro)?.cause?.code ?? /** @type {any} */ (erro)?.code ?? 'ERRO'),
  mensagem: getApiErrorMessage(erro, /** @type {any} */ (erro)?.message || 'O servidor recusou este registro.'),
  em: new Date(agora()).toISOString(),
});

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
 * @param {{empresaId?: string|null, operationId?: string}} [opcoes]
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
  const naoConfirmado = (/** @type {string} */ id) => porId.get(id)?.estado !== 'enviado';
  const temQueEsperar =
    referencias.some(naoConfirmado) ||
    itens.some((i) => i.estado !== 'enviado' && i.recursos.some((r) => recursos.includes(r)));

  /**
   * Grava o item. 'pendente' espera envio; 'enviado' guarda o resultado de um
   * envio direto, para quem citar este registro depois (referência).
   * @param {'pendente'|'enviado'} [estado]
   * @param {unknown} [resultado]
   */
  const guardar = async (estado = 'pendente', resultado = undefined) => {
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
      rotulo: rotuloDe(def, payload),
      criado_em: new Date(agora()).toISOString(),
      sequencia: proximaSequencia(itens),
      estado,
      tentativas: 0,
      proxima_tentativa_em: 0,
      ultimo_erro: null,
      enviado_em: enviado ? new Date(agora()).toISOString() : null,
      ...(enviado ? { resultado: JSON.parse(JSON.stringify(resultado ?? null)) } : {}),
    };
    await fila.gravar(item);
    emitir();
    if (!enviado) agendarSincronizacao();
    return /** @type {ResultadoDoEnvio} */ ({ estado: 'aguardando', operationId });
  };

  if (!online() || temQueEsperar) return guardar();

  const resultados = new Map(itens.filter((i) => i.estado === 'enviado').map((i) => [i.id, i.resultado]));
  try {
    const resultado = await def.enviar(resolverReferencias(payload, resultados), { operationId, empresaId });
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
    if (classificarFalhaDeEnvio(erro) === 'rede' && podeGuardar) return guardar();
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
    passadaEmCurso = passada().finally(() => {
      passadaEmCurso = null;
      emitir();
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

  for (const item of todos) {
    if (item.estado === 'enviado') continue;
    if (item.estado === 'atencao') {
      parar(item);
      continue;
    }
    if (!mesmaSessao(dono)) return resumoDaFila();
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

    if (!mesmaSessao(dono)) return resumoDaFila();
    try {
      const resultado = await def.enviar(payload, { operationId: item.id, empresaId: item.empresa_id });
      await fila.gravar({
        ...item,
        estado: 'enviado',
        resultado: JSON.parse(JSON.stringify(resultado ?? null)),
        enviado_em: new Date(agora()).toISOString(),
        ultimo_erro: null,
      });
      resultados.set(item.id, resultado);
      emitir();
    } catch (erro) {
      const tipoDeFalha = classificarFalhaDeEnvio(erro);
      if (tipoDeFalha === 'sessao') return resumoDaFila();
      const tentativas = item.tentativas + 1;
      if (tipoDeFalha === 'rede') {
        await fila.gravar({ ...item, tentativas, proxima_tentativa_em: agora() + esperaDepoisDe(tentativas), ultimo_erro: resumoDoErro(erro) });
        emitir();
        // Sem rede para um, sem rede para os outros: para a passada.
        return resumoDaFila();
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
  return resumoDaFila();
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
    })),
  };
};

/**
 * Registros desta sessão ainda não confirmados, de um tipo — para a tela
 * mostrar na hora o que foi feito sem internet.
 *
 * @param {string} tipo
 * @returns {Promise<Array<{operationId: string, payload: unknown, estado: string, criado_em: string}>>}
 */
export const registrosAguardandoDoTipo = async (tipo) => {
  const fila = portaDaFila();
  if (!fila || !sessao) return [];
  return (await fila.listar())
    .filter((i) => eDaSessao(i) && i.tipo === tipo && i.estado !== 'enviado')
    .sort(emOrdem)
    .map((i) => ({ operationId: i.id, payload: i.payload, estado: i.estado, criado_em: i.criado_em }));
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
export const tentarDeNovo = async (id) => {
  const fila = portaDaFila();
  const item = fila ? await fila.ler(id) : undefined;
  if (!fila || !item || !eDaSessao(item) || item.estado === 'enviado') return false;
  await fila.gravar({ ...item, estado: 'pendente', tentativas: 0, proxima_tentativa_em: 0 });
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
export const descartarDaFila = async (id) => {
  const fila = portaDaFila();
  const item = fila ? await fila.ler(id) : undefined;
  if (!fila || !item || !eDaSessao(item) || item.estado === 'enviado') return false;
  await fila.remover(id);
  emitir();
  return true;
};
