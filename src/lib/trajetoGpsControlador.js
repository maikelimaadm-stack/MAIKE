/**
 * Controlador do rastreio do trajeto (GPS fase 1). Fica FORA do React: o GPS continua ligado se o Diário for fechado (o
 * operador ainda está na atividade), e o mapa lê a mesma linha. O hook `useRastreioGps` só assina este estado.
 *
 * Regras (ver também `trajetoGpsRegras.js`):
 *  - o rastreio liga só por toque do operador (`iniciar`); nunca automático;
 *  - cada ponto aceito vai para o buffer do aparelho (IndexedDB) antes de qualquer envio; o envio apaga só o lote que
 *    o servidor confirmou (200). Reenvio é seguro pelo `seq` (o servidor não duplica);
 *  - envio a cada 30 s com o trajeto aberto, e na volta da internet; "Encerrar o dia" envia o resto e encerra o trajeto;
 *  - o trajeto aberto fica guardado no aparelho (localStorage): recarregar a página não perde o trajeto nem o buffer;
 *  - "rota não existe" no servidor (degradação) desliga o rastreio nesta sessão e não tenta de novo.
 *
 * Não faz nada com estoque nem custo.
 */

import { novoIdDoAparelho } from '@/lib/offline/idDoAparelho';
import { apagarPontosDoTrajeto, contarPontosGuardados, gravarPontosDoTrajeto, listarPontosDoTrajeto } from '@/lib/offline/trajetoPontosOffline';
import {
  ENVIO_A_CADA_MS,
  LOTE_MAX_PONTOS,
  TETO_PONTOS_BUFFER,
  deveGravar,
  filtroDePonto,
  haversineM,
  paraPontoDoServidor,
} from '@/lib/trajetoGpsRegras';
import { abrirTrajeto, codigoDoErroTrajeto, enviarPontos, encerrarTrajeto } from '@/services/trajetoGpsService';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';

const CHAVE_LOCAL = 'maike.diario.trajetoGps';
const OPCOES_GPS = Object.freeze({ enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 });

export const AVISO_SEM_ROTA = 'Rastreio do trajeto ainda não está ligado no servidor.';
export const AVISO_TETO = 'Muitos pontos guardados no aparelho. Conecte à internet para enviar antes de continuar.';
export const AVISO_PONTOS_RECUSADOS = 'O servidor recusou alguns pontos do trajeto. Eles ficaram guardados no aparelho.';

/**
 * @typedef {{ trajetoId: string, atividadeId: string, empresaId: string, bemId: string, dataOperacional: string,
 *   implementoBemId: string|null, apontamentoId: string|null, operationId: string, seq: number, distanciaM: number,
 *   desejado: boolean, encerrarPendente: boolean }} TrajetoAberto
 */

/** Estado público (o que o hook e o mapa leem). */
let estado = {
  /** Trajeto aberto no servidor (ou null). */
  trajeto: /** @type {TrajetoAberto|null} */ (null),
  /** Watch do GPS ligado agora. */
  gravando: false,
  /** Rota indisponível no servidor nesta sessão: o rastreio não tenta de novo. */
  indisponivel: false,
  /** Aviso curto para a tela (ou null). */
  aviso: /** @type {string|null} */ (null),
  /** Pontos guardados que ainda não foram confirmados pelo servidor. */
  pendentes: 0,
  /** Linha do trajeto aberto nesta sessão (pontos gravados em memória, ordem de chegada). */
  linha: /** @type {Array<{ lat: number, lng: number }>} */ ([]),
};

const ouvintes = new Set();
let ultimoGravado = /** @type {{ lat: number, lng: number, em: number }|null} */ (null);
let idWatch = /** @type {number|null} */ (null);
let idIntervalo = /** @type {ReturnType<typeof setInterval>|null} */ (null);
let envio = /** @type {Promise<void>|null} */ (null);
let ouveOnline = false;

const notificar = () => ouvintes.forEach((fn) => fn(estado));
const mudar = (parcial) => {
  estado = { ...estado, ...parcial };
  notificar();
};

// ─── Persistência do trajeto aberto (localStorage) ───────────────────────
const lerLocal = () => {
  try {
    const bruto = globalThis.localStorage?.getItem(CHAVE_LOCAL);
    const dados = bruto ? JSON.parse(bruto) : null;
    return dados && typeof dados.trajetoId === 'string' ? /** @type {TrajetoAberto} */ (dados) : null;
  } catch {
    return null;
  }
};
const gravarLocal = (trajeto) => {
  try {
    if (trajeto) globalThis.localStorage?.setItem(CHAVE_LOCAL, JSON.stringify(trajeto));
    else globalThis.localStorage?.removeItem(CHAVE_LOCAL);
  } catch {
    /* sem armazenamento: o trajeto some no recarregar (limite registrado) */
  }
};
/** @param {Partial<TrajetoAberto>} parcial */
const atualizarTrajeto = (parcial) => {
  if (!estado.trajeto) return;
  const novo = { ...estado.trajeto, ...parcial };
  gravarLocal(novo);
  mudar({ trajeto: novo });
};

// ─── GPS ─────────────────────────────────────────────────────────────────
const geoDisponivel = () => typeof navigator !== 'undefined' && typeof navigator.geolocation?.watchPosition === 'function';

/** Lê uma leitura do navegador para o formato interno. @param {GeolocationPosition} pos */
const deGeo = (pos) => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  precisao_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
  velocidade_ms: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
  em: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now(),
});

/** Uma leitura nova: filtro, amostragem, buffer. Nunca lança (o GPS chega fora de hora). @param {GeolocationPosition} pos */
export const receberLeitura = async (pos) => {
  const trajeto = estado.trajeto;
  if (!trajeto || !estado.gravando) return;
  const ponto = deGeo(pos);
  if (!filtroDePonto(ultimoGravado, ponto).aceito) return;
  if (!deveGravar(ultimoGravado, ponto)) return;
  if (estado.pendentes >= TETO_PONTOS_BUFFER) {
    mudar({ aviso: AVISO_TETO, gravando: false });
    pararWatch();
    return;
  }
  const seq = trajeto.seq + 1;
  const distanciaM = trajeto.distanciaM + (ultimoGravado ? haversineM(ultimoGravado, ponto) : 0);
  ultimoGravado = { lat: ponto.lat, lng: ponto.lng, em: ponto.em };
  // Antes do await: o envio que correr nesse meio já conta este ponto como pendente.
  atualizarTrajeto({ seq, distanciaM });
  mudar({ pendentes: estado.pendentes + 1, linha: [...estado.linha, { lat: ponto.lat, lng: ponto.lng }] });
  await gravarPontosDoTrajeto(trajeto.trajetoId, [{ seq, ...ponto }]);
};

const erroDoGps = (erro) => {
  if (erro?.code === 1) mudar({ aviso: 'Permita a localização do MAK Gestão nas configurações do celular.', gravando: false });
  else if (erro?.code === 2) mudar({ aviso: 'Não foi possível obter o GPS. Ligue a localização do celular.' });
  // tempo esgotado: o GPS continua tentando, sem aviso
};

const ligarWatch = () => {
  if (idWatch !== null || !geoDisponivel()) return;
  idWatch = navigator.geolocation.watchPosition((pos) => void receberLeitura(pos), erroDoGps, OPCOES_GPS);
  mudar({ gravando: true });
};
const pararWatch = () => {
  if (idWatch !== null && geoDisponivel()) navigator.geolocation.clearWatch(idWatch);
  idWatch = null;
  if (estado.gravando) mudar({ gravando: false });
};

// ─── Envio ───────────────────────────────────────────────────────────────
const aoVoltarInternet = () => void enviarPendentes();

const ligarEnvio = () => {
  if (idIntervalo === null) idIntervalo = setInterval(() => void enviarPendentes(), ENVIO_A_CADA_MS);
  if (!ouveOnline && typeof window !== 'undefined') {
    window.addEventListener('online', aoVoltarInternet);
    ouveOnline = true;
  }
};
const desligarEnvio = () => {
  if (idIntervalo !== null) clearInterval(idIntervalo);
  idIntervalo = null;
  if (ouveOnline && typeof window !== 'undefined') window.removeEventListener('online', aoVoltarInternet);
  ouveOnline = false;
};

/** Desliga o rastreio por causa de rota indisponível (degradação) e não tenta de novo nesta sessão. */
const degradar = () => {
  pararWatch();
  desligarEnvio();
  mudar({ indisponivel: true, aviso: AVISO_SEM_ROTA });
};

/** Limpa o trajeto do aparelho (encerrado, ou a rota sumiu). Só chamar com o buffer vazio ou descartado de propósito. */
const soltarTrajeto = () => {
  pararWatch();
  desligarEnvio();
  ultimoGravado = null;
  gravarLocal(null);
  mudar({ trajeto: null, linha: [], pendentes: 0 });
};

/**
 * Envia o buffer do trajeto aberto em lotes de até 200, um por vez. Só apaga o lote depois do 200. Falta de rede para
 * e tenta de novo depois (timer ou volta da internet). Single-flight: chamadas simultâneas reaproveitam o envio em curso.
 */
export const enviarPendentes = () => {
  if (envio) return envio;
  envio = (async () => {
    try {
      let trajeto = estado.trajeto;
      while (trajeto) {
        const lote = await listarPontosDoTrajeto(trajeto.trajetoId, LOTE_MAX_PONTOS);
        if (lote.length === 0) break;
        const r = await enviarPontos({
          atividadeId: trajeto.atividadeId,
          trajetoId: trajeto.trajetoId,
          empresaId: trajeto.empresaId,
          pontos: lote.map((p) => paraPontoDoServidor(p, p.seq)),
        });
        if (r.estado === 'indisponivel') {
          degradar();
          return;
        }
        await apagarPontosDoTrajeto(trajeto.trajetoId, lote.map((p) => p.seq));
        mudar({ pendentes: Math.max(0, estado.pendentes - lote.length) });
        trajeto = estado.trajeto;
      }
      if (estado.trajeto?.encerrarPendente && estado.pendentes === 0) await encerrarAgoraNoServidor();
    } catch (erro) {
      const codigo = codigoDoErroTrajeto(erro);
      if (codigo === API_ERROR_CODES.PROVIDER_UNAVAILABLE) return; // sem rede: o buffer fica, tenta de novo
      if (codigo === API_ERROR_CODES.TRAJETO_STATUS_INVALIDO || codigo === API_ERROR_CODES.TRAJETO_NOT_FOUND) {
        // O servidor já fechou este trajeto: não há para onde mandar os pontos. Libera o buffer deste trajeto.
        const id = estado.trajeto?.trajetoId ?? '';
        const restantes = id ? await listarPontosDoTrajeto(id) : [];
        await apagarPontosDoTrajeto(id, restantes.map((p) => p.seq));
        soltarTrajeto();
        mudar({ aviso: 'O trajeto já foi encerrado no servidor. Os pontos que faltavam não foram enviados.' });
        return;
      }
      // Recusa de contrato (pontos): fica guardado, não reenvia em loop.
      pararWatch();
      mudar({ aviso: AVISO_PONTOS_RECUSADOS });
    } finally {
      envio = null;
    }
  })();
  return envio;
};

/** Encerra o trajeto no servidor (idempotente). Com buffer ainda cheio, não encerra: fica para a volta da internet. */
const encerrarAgoraNoServidor = async () => {
  const trajeto = estado.trajeto;
  if (!trajeto) return { estado: 'ok' };
  try {
    const r = await encerrarTrajeto({ atividadeId: trajeto.atividadeId, trajetoId: trajeto.trajetoId, empresaId: trajeto.empresaId });
    if (r.estado === 'indisponivel') {
      degradar();
      return { estado: 'indisponivel' };
    }
    soltarTrajeto();
    return { estado: 'ok' };
  } catch (erro) {
    if (codigoDoErroTrajeto(erro) === API_ERROR_CODES.PROVIDER_UNAVAILABLE) {
      atualizarTrajeto({ encerrarPendente: true });
      return { estado: 'pendente' };
    }
    if (codigoDoErroTrajeto(erro) === API_ERROR_CODES.TRAJETO_STATUS_INVALIDO || codigoDoErroTrajeto(erro) === API_ERROR_CODES.TRAJETO_NOT_FOUND) {
      soltarTrajeto();
      return { estado: 'ok' };
    }
    throw erro;
  }
};

// ─── Ações da tela ───────────────────────────────────────────────────────

/**
 * "Iniciar rastreio" (toque do operador). Abre o trajeto no servidor se ainda não há um aberto; depois liga o GPS.
 * Erros de negócio e de rede são lançados (a tela mostra a mensagem). Rota indisponível: `{estado:'indisponivel'}`.
 * @param {{ atividadeId: string, empresaId: string, bemId: string, dataOperacional: string, implementoBemId?: string|null, apontamentoId?: string|null }} ctx
 */
export const iniciarRastreio = async (ctx) => {
  if (estado.indisponivel) return { estado: 'indisponivel' };
  if (!geoDisponivel()) {
    mudar({ aviso: 'Este aparelho não tem GPS disponível.' });
    return { estado: 'sem-gps' };
  }
  if (estado.trajeto && estado.trajeto.atividadeId !== String(ctx.atividadeId)) {
    return { estado: 'outra-atividade' };
  }
  if (!estado.trajeto) {
    const operationId = novoIdDoAparelho();
    const r = await abrirTrajeto({
      atividadeId: ctx.atividadeId,
      empresaId: ctx.empresaId,
      bemId: ctx.bemId,
      dataOperacional: ctx.dataOperacional,
      operationId,
      implementoBemId: ctx.implementoBemId ?? null,
      apontamentoId: ctx.apontamentoId ?? null,
    });
    if (r.estado === 'indisponivel') {
      degradar();
      return { estado: 'indisponivel' };
    }
    const novo = {
      trajetoId: String(r.trajeto.id),
      atividadeId: String(ctx.atividadeId),
      empresaId: String(ctx.empresaId),
      bemId: String(ctx.bemId),
      dataOperacional: String(ctx.dataOperacional),
      implementoBemId: ctx.implementoBemId ?? null,
      apontamentoId: ctx.apontamentoId ?? null,
      operationId,
      seq: 0,
      distanciaM: 0,
      desejado: true,
      encerrarPendente: false,
    };
    gravarLocal(novo);
    mudar({ trajeto: novo, linha: [], pendentes: 0, aviso: null });
  } else {
    atualizarTrajeto({ desejado: true });
  }
  ligarWatch();
  ligarEnvio();
  return { estado: 'ok' };
};

/** "Parar rastreio": desliga o GPS e envia o que falta. O trajeto continua aberto (pode retomar). */
export const pararRastreio = async () => {
  pararWatch();
  if (estado.trajeto) atualizarTrajeto({ desejado: false });
  await enviarPendentes();
};

/**
 * "Encerrar o dia": para o GPS, envia o que falta e encerra o trajeto. Sem internet, fica pendente e encerra na volta.
 * Nunca lança (o encerramento do dia não pode falhar por causa do GPS).
 */
export const encerrarRastreioDoDia = async () => {
  pararWatch();
  if (!estado.trajeto) return { estado: 'ok' };
  atualizarTrajeto({ desejado: false, encerrarPendente: true });
  await enviarPendentes();
  // Com pontos ainda no buffer, NÃO encerra: o servidor fecharia antes dos pontos e recusaria o resto. O envio encerra
  // quando o buffer zerar (ver `enviarPendentes`).
  if (!estado.trajeto) return { estado: 'ok' };
  if (estado.pendentes > 0) return { estado: 'pendente' };
  try {
    return await encerrarAgoraNoServidor();
  } catch {
    return { estado: 'pendente' };
  }
};

/**
 * Ao abrir o Diário: se havia um trajeto aberto desta atividade que estava gravando (desejado), retoma o GPS nele.
 * Nunca cria trajeto novo. @param {string} atividadeId
 */
export const retomarSeHouver = (atividadeId) => {
  if (!estado.trajeto) {
    const salvo = lerLocal();
    if (!salvo || salvo.atividadeId !== String(atividadeId)) return;
    mudar({ trajeto: salvo });
  }
  if (estado.indisponivel || estado.trajeto?.atividadeId !== String(atividadeId)) return;
  ligarEnvio();
  if (estado.trajeto.desejado && !estado.gravando) ligarWatch();
  // Pontos de antes do recarregar: envia o que ficou guardado.
  void enviarPendentes();
  void contarPontosGuardados().then((n) => mudar({ pendentes: n }));
};

/** Assina o estado (para o hook e para o mapa). @param {(s: typeof estado) => void} fn @returns {() => void} */
export const assinarRastreio = (fn) => {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
};
/** O estado atual. */
export const estadoDoRastreio = () => estado;

/** Só para testes: zera o controlador (estado, watch, timers). */
export const resetarRastreioParaTestes = () => {
  pararWatch();
  desligarEnvio();
  ultimoGravado = null;
  envio = null;
  try {
    globalThis.localStorage?.removeItem(CHAVE_LOCAL);
  } catch {
    /* ignore */
  }
  estado = { trajeto: null, gravando: false, indisponivel: false, aviso: null, pendentes: 0, linha: [] };
  notificar();
};
