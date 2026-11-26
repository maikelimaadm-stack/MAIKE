/**
 * D-PROD-324 (MAIKE-DIARIO-GPS, fase 1) — o trajeto da máquina no Diário, com o rastreio em primeiro plano (tela ligada):
 *
 *  - `abrirTrajeto`: abre um trajeto ABERTO, preso à atividade, à máquina (bem de natureza MAQUINA), ao implemento e ao
 *    apontamento do dia (opcionais), no dia operacional. Idempotente por `operation_id` (replay → 200). Uma máquina só
 *    tem um trajeto aberto por atividade (409 TRAJETO_ABERTO).
 *  - `enviarPontos`: recebe um lote de 1 a 200 pontos. `INSERT ... ON CONFLICT DO NOTHING` em (trajeto, seq): o reenvio
 *    do mesmo lote não duplica. Trajeto que não está ABERTO recusa o lote (409). Devolve `{ recebidos, novos }`.
 *  - `encerrarTrajeto`: fecha o trajeto e grava `distancia_m` (soma dos trechos entre pontos consecutivos por seq, sem
 *    trechos que implicam mais de 60 km/h). Idempotente: encerrar de novo devolve 200 com `replay: true`.
 *  - `listarTrajetosDoDia`: os trajetos de um dia operacional, com a distância e uma linha simplificada (no máximo 500
 *    pontos, amostrados, sempre com o primeiro e o último).
 *
 * Escrita e leitura passam pela guarda da tela de apontamentos (`lancar_apontamento` e `visualizar`). NÃO escreve em
 * estoque nem em custo. Coordenadas chegam como número (JSON); o resto dos decimais de saída é número arredondado.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError, atividadeApontamentoNotFound, atividadeNotFound, atividadeStatusInvalido } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { MENSAGEM_CONFLITO_IDEMPOTENTE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { operationIdDoCorpo, travarAtividade } from './atividadeComum.js';

export const STATUS_TRAJETO = Object.freeze({ ABERTO: 'ABERTO', ENCERRADO: 'ENCERRADO', CANCELADO: 'CANCELADO' });
/** Pontos por lote (o aparelho envia até isto de uma vez). */
export const LOTE_MAXIMO = 200;
/** Pontos na linha devolvida pelo GET (amostrados). */
export const LINHA_MAXIMA = 500;
/** Trecho que implica mais que isto (km/h) é salto de GPS: não entra na distância. */
export const VELOCIDADE_MAXIMA_KMH = 60;
const RAIO_TERRA_M = 6371000;
const PADRAO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} campo @param {string} motivo @param {Record<string, unknown>} [extra] */
const recusaTrajeto = (campo, motivo, extra = {}) =>
  new AppError('TRAJETO_INVALIDO', 'trajeto recusado; nada foi gravado', { details: { field: campo, reason: motivo, ...extra } });
/** @param {string|number} indice @param {string} campo @param {string} motivo */
const recusaPontos = (indice, campo, motivo) =>
  new AppError('TRAJETO_PONTOS_INVALIDOS', 'lote de pontos recusado; nada foi gravado', { details: { index: indice, field: campo, reason: motivo } });

// ───────────────────────── regras puras (sem banco) ─────────────────────────

/**
 * Distância entre dois pontos (metros), pela fórmula de haversine.
 * @param {{ lat: number, lng: number }} a @param {{ lat: number, lng: number }} b
 */
export const haversineM = (a, b) => {
  const rad = (/** @type {number} */ g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Distância de uma linha (pontos já em ordem de seq; `t` = instante em ms). Trechos sem tempo positivo, ou que implicam
 * mais de 60 km/h, não contam.
 * @param {Array<{ lat: number, lng: number, t: number }>} pontos
 */
export const distanciaDaLinhaM = (pontos) => {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1];
    const b = pontos[i];
    const dtS = (b.t - a.t) / 1000;
    if (!(dtS > 0)) continue;
    const d = haversineM(a, b);
    if ((d / dtS) * 3.6 > VELOCIDADE_MAXIMA_KMH) continue;
    total += d;
  }
  return total;
};

/**
 * Amostra uniforme de uma linha: no máximo `maximo` pontos, sempre com o primeiro e o último.
 * @template T @param {T[]} pontos @param {number} [maximo]
 * @returns {T[]}
 */
export const amostrarLinha = (pontos, maximo = LINHA_MAXIMA) => {
  if (pontos.length <= maximo) return pontos;
  const saida = [];
  for (let k = 0; k < maximo; k++) saida.push(pontos[Math.round((k * (pontos.length - 1)) / (maximo - 1))]);
  return saida;
};

/** Coordenada dentro da faixa do globo (sem NaN). @param {unknown} p */
export const pontoTemCoordenadaValida = (p) => {
  const x = /** @type {{ lat: unknown, lng: unknown }} */ (p);
  return typeof x.lat === 'number' && typeof x.lng === 'number' && Number.isFinite(x.lat) && Number.isFinite(x.lng) &&
    x.lat >= -90 && x.lat <= 90 && x.lng >= -180 && x.lng <= 180;
};

/**
 * Confere o lote (1..200, coordenadas, horário ISO) e tira seq repetido dentro do próprio lote (fica o primeiro).
 * Recusa o lote inteiro se algum ponto estiver errado: nada é gravado.
 * @param {unknown} pontos
 * @returns {Array<{ seq: number, lat: number, lng: number, precisao_m: number|null, velocidade_ms: number|null, capturado_em: Date }>}
 */
export const validarLotePontos = (pontos) => {
  if (!Array.isArray(pontos) || pontos.length < 1 || pontos.length > LOTE_MAXIMO) throw recusaPontos(null, 'pontos', 'tamanho');
  const vistos = new Set();
  const saida = [];
  for (const [i, p] of pontos.entries()) {
    if (!pontoTemCoordenadaValida(p)) throw recusaPontos(i, 'coordenada', 'lat −90..90 e lng −180..180');
    const quando = typeof p.capturado_em === 'string' ? Date.parse(p.capturado_em) : Number.NaN;
    if (Number.isNaN(quando)) throw recusaPontos(i, 'capturado_em', 'horário ISO inválido');
    if (typeof p.seq !== 'number' || !Number.isInteger(p.seq) || p.seq < 0) throw recusaPontos(i, 'seq', 'inteiro ≥ 0');
    if (vistos.has(p.seq)) continue;
    vistos.add(p.seq);
    saida.push({
      seq: p.seq,
      lat: p.lat,
      lng: p.lng,
      precisao_m: typeof p.precisao_m === 'number' ? p.precisao_m : null,
      velocidade_ms: typeof p.velocidade_ms === 'number' ? p.velocidade_ms : null,
      capturado_em: new Date(quando),
    });
  }
  return saida;
};

/** Dia operacional `YYYY-MM-DD` → Date em UTC meia-noite (coluna DATE). @param {unknown} dia @param {string} campo */
const diaDeTrajeto = (dia, campo) => {
  if (typeof dia !== 'string' || !PADRAO_DIA.test(dia)) throw recusaTrajeto(campo, 'formato', { esperado: 'YYYY-MM-DD' });
  const d = new Date(`${dia}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dia) throw recusaTrajeto(campo, 'data_inexistente');
  return d;
};

/** @param {any} t */
const diaTexto = (t) => t.data_operacional.toISOString().slice(0, 10);
/** @param {unknown} v */
const numeroOuNulo = (v) => (v === null || v === undefined ? null : Number(v));
const arredondar2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** Trajeto como a tela usa (distância em metros, número; datas ISO). @param {any} t @param {number|null} [distanciaM] */
export const comoTrajetoPublico = (t, distanciaM = undefined) => ({
  id: t.id,
  atividade_id: t.atividade_id,
  apontamento_id: t.apontamento_id ?? null,
  bem_id: t.bem_id,
  implemento_bem_id: t.implemento_bem_id ?? null,
  data_operacional: diaTexto(t),
  status: t.status,
  iniciado_em: t.iniciado_em.toISOString(),
  encerrado_em: t.encerrado_em ? t.encerrado_em.toISOString() : null,
  pontos_total: t.pontos_total,
  distancia_m: distanciaM !== undefined ? distanciaM : numeroOuNulo(t.distancia_m),
});

// ───────────────────────── escrita ─────────────────────────

/**
 * Sob recibo de idempotência (abrir): reenvio igual → replay (200), reenvio diferente → 409.
 * @param {any} contexto @param {{ operationId: string, fingerprint: string, executar: (tx: any) => Promise<{ httpStatus: number, body: Record<string, unknown> }> }} a
 */
const comRecibo = async (contexto, { operationId, fingerprint, executar }) => {
  const clienteId = exigirAuthContext(contexto?.auth).clienteId;
  const unicos = {
    operation_id: {
      erro: () => new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', { details: { operation_id: operationId } }),
      conferir: (tx) => tx.atividadeTrajeto.findFirst({ where: { cliente_id: clienteId, operation_id: operationId }, select: { id: true } }),
    },
  };
  const r = await emTransacao(
    TRANSACAO_CURTA,
    (tx) => executarComIdempotencia(tx, { clienteId, operationKey: operationId, tipoOperacao: 'TRAJETO_ABRIR', fingerprint, executar: () => executar(tx) }),
    unicos,
    MENSAGEM_CONFLITO_IDEMPOTENTE
  );
  return { status: r.replay ? 200 : r.httpStatus, body: { ...r.body, replay: r.replay } };
};

/**
 * Atividade travada (FOR UPDATE) e lida. Outra empresa ou tenant → 404.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
const travarAtividadeDoTrajeto = async (tx, clienteId, empresaId, atividadeId) => {
  if (!(await travarAtividade(tx, clienteId, empresaId, atividadeId))) throw atividadeNotFound();
  const atividade = await tx.atividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId }, select: { id: true, status: true } });
  if (!atividade) throw atividadeNotFound();
  return atividade;
};

/** Trajeto desta atividade e empresa (lido). Outro → 404. @param {any} db @param {string} cli @param {string} empresaId @param {string} atividadeId @param {string} id */
const lerTrajetoDaAtividade = async (db, cli, empresaId, atividadeId, id) => {
  const t = await db.atividadeTrajeto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, id } });
  if (!t) throw new AppError('TRAJETO_NOT_FOUND', 'trajeto não encontrado nesta atividade; nada foi gravado');
  return t;
};

/**
 * `POST /atividades/:id/trajetos` — abre o trajeto (201) ou devolve o mesmo (200, replay) para a mesma `operation_id`.
 * @param {any} contexto @param {string} atividadeId @param {Record<string, any>} corpo
 */
export const abrirTrajeto = async (contexto, atividadeId, corpo) => {
  const { clienteId: cli, usuarioId } = exigirAuthContext(contexto?.auth);
  const operationId = operationIdDoCorpo(corpo.operation_id);
  const fingerprint = fingerprintDePayload({ v: 1, op: 'trajeto_abrir', atividade_id: atividadeId, corpo: { ...corpo, operation_id: undefined } });
  return comRecibo(contexto, {
    operationId,
    fingerprint,
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const atividade = await travarAtividadeDoTrajeto(tx, cli, empresaId, atividadeId);
      if (atividade.status !== 'ABERTA') throw atividadeStatusInvalido({ status: atividade.status, acao: 'abrir_trajeto', entidade: 'atividade' });
      const dia = diaDeTrajeto(corpo.data_operacional, 'data_operacional');

      const bem = await tx.bemPatrimonial.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: corpo.bem_id }, select: { id: true, natureza: true } });
      if (!bem) throw recusaTrajeto('bem_id', 'inexistente');
      if (bem.natureza !== 'MAQUINA') throw recusaTrajeto('bem_id', 'nao_maquina');

      let implementoId = null;
      if (corpo.implemento_bem_id) {
        const impl = await tx.bemPatrimonial.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: corpo.implemento_bem_id }, select: { id: true, natureza: true } });
        if (!impl) throw recusaTrajeto('implemento_bem_id', 'inexistente');
        if (impl.natureza !== 'IMPLEMENTO') throw recusaTrajeto('implemento_bem_id', 'nao_implemento');
        implementoId = impl.id;
      }

      let apontamentoId = null;
      if (corpo.apontamento_id) {
        const ap = await tx.atividadeApontamento.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, id: corpo.apontamento_id }, select: { id: true } });
        if (!ap) throw atividadeApontamentoNotFound();
        apontamentoId = ap.id;
      }

      const aberto = await tx.atividadeTrajeto.findFirst({
        where: { cliente_id: cli, atividade_id: atividadeId, bem_id: bem.id, status: STATUS_TRAJETO.ABERTO },
        select: { id: true },
      });
      if (aberto) {
        throw new AppError('TRAJETO_ABERTO', 'já há trajeto aberto desta máquina nesta atividade; encerre antes de abrir outro', { details: { trajeto_id: aberto.id } });
      }

      const t = await tx.atividadeTrajeto.create({
        data: {
          cliente_id: cli,
          empresa_id: empresaId,
          atividade_id: atividadeId,
          apontamento_id: apontamentoId,
          bem_id: bem.id,
          implemento_bem_id: implementoId,
          usuario_id: usuarioId ?? null,
          data_operacional: dia,
          status: STATUS_TRAJETO.ABERTO,
          iniciado_em: new Date(),
          pontos_total: 0,
          operation_id: operationId,
        },
      });
      return { httpStatus: 201, body: { trajeto: comoTrajetoPublico(t) } };
    },
  });
};

/**
 * `POST /atividades/:id/trajetos/:trajetoId/pontos` — lote de pontos (1..200). Trajeto fora de ABERTO → 409.
 * Trava o trajeto em modo compartilhado, para o encerramento (que trava em modo exclusivo) não se cruzar com um lote.
 * @param {any} contexto @param {string} atividadeId @param {string} trajetoId @param {Record<string, any>} corpo
 */
export const enviarPontos = async (contexto, atividadeId, trajetoId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const pontos = validarLotePontos(corpo.pontos);
  return emTransacao(TRANSACAO_CURTA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
    const t = await lerTrajetoDaAtividade(tx, cli, empresaId, atividadeId, trajetoId);
    const [trava] = /** @type {Array<{ status: string }>} */ (
      await tx.$queryRaw`SELECT status FROM "AtividadeTrajeto" WHERE cliente_id = ${cli} AND id = ${t.id} FOR SHARE`
    );
    if (!trava || trava.status !== STATUS_TRAJETO.ABERTO) {
      throw new AppError('TRAJETO_STATUS_INVALIDO', 'o trajeto não está aberto; o lote não foi gravado', { details: { status: trava?.status ?? null, acao: 'enviar_pontos' } });
    }
    const r = await tx.atividadeTrajetoPonto.createMany({
      data: pontos.map((p) => ({ cliente_id: cli, trajeto_id: t.id, seq: p.seq, lat: p.lat, lng: p.lng, precisao_m: p.precisao_m, velocidade_ms: p.velocidade_ms, capturado_em: p.capturado_em })),
      skipDuplicates: true,
    });
    if (r.count > 0) {
      await tx.atividadeTrajeto.update({ where: { cliente_id_id: { cliente_id: cli, id: t.id } }, data: { pontos_total: { increment: r.count } } });
    }
    return { recebidos: corpo.pontos.length, novos: r.count };
  }, {}, MENSAGEM_CONFLITO_IDEMPOTENTE);
};

/**
 * `POST /atividades/:id/trajetos/:trajetoId/encerrar` — fecha o trajeto e grava a distância. Já encerrado → 200 com
 * `replay: true` (sem regravar). CANCELADO → 409.
 * @param {any} contexto @param {string} atividadeId @param {string} trajetoId @param {Record<string, any>} corpo
 */
export const encerrarTrajeto = async (contexto, atividadeId, trajetoId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emTransacao(TRANSACAO_CURTA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
    const [trava] = /** @type {Array<{ id: string, status: string }>} */ (
      await tx.$queryRaw`SELECT id, status FROM "AtividadeTrajeto" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND atividade_id = ${atividadeId} AND id = ${trajetoId} FOR UPDATE`
    );
    if (!trava) throw new AppError('TRAJETO_NOT_FOUND', 'trajeto não encontrado nesta atividade; nada foi gravado');
    if (trava.status === STATUS_TRAJETO.ENCERRADO) {
      const atual = await tx.atividadeTrajeto.findFirst({ where: { cliente_id: cli, id: trajetoId } });
      return { status: 200, body: { trajeto: comoTrajetoPublico(atual), replay: true } };
    }
    if (trava.status !== STATUS_TRAJETO.ABERTO) {
      throw new AppError('TRAJETO_STATUS_INVALIDO', 'o trajeto não está aberto para encerrar; nada foi gravado', { details: { status: trava.status, acao: 'encerrar_trajeto' } });
    }
    const pontos = await tx.atividadeTrajetoPonto.findMany({
      where: { cliente_id: cli, trajeto_id: trajetoId },
      orderBy: { seq: 'asc' },
      select: { lat: true, lng: true, capturado_em: true },
    });
    const distancia = arredondar2(distanciaDaLinhaM(pontos.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), t: p.capturado_em.getTime() }))));
    const t = await tx.atividadeTrajeto.update({
      where: { cliente_id_id: { cliente_id: cli, id: trajetoId } },
      data: { status: STATUS_TRAJETO.ENCERRADO, encerrado_em: new Date(), pontos_total: pontos.length, distancia_m: distancia },
    });
    return { status: 200, body: { trajeto: comoTrajetoPublico(t), replay: false } };
  }, {}, MENSAGEM_CONFLITO_IDEMPOTENTE);
};

// ───────────────────────── leitura ─────────────────────────

/**
 * `GET /atividades/:id/trajetos?empresa_id=&dia=YYYY-MM-DD` — trajetos do dia, com distância e linha simplificada.
 * Trajeto ABERTO: a distância é calculada na hora (o encerramento a grava).
 * @param {any} contexto @param {string} atividadeId @param {{ empresa_id: string, dia: string }} consulta
 */
export const listarTrajetosDoDia = async (contexto, atividadeId, consulta) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const db = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(db, cli, consulta.empresa_id);
  const atividade = await db.atividade.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: atividadeId }, select: { id: true } });
  if (!atividade) throw atividadeNotFound();
  const dia = diaDeTrajeto(consulta.dia, 'dia');
  const trajetos = await db.atividadeTrajeto.findMany({
    where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, data_operacional: dia },
    orderBy: { iniciado_em: 'asc' },
  });
  const itens = [];
  for (const t of trajetos) {
    const pontos = await db.atividadeTrajetoPonto.findMany({
      where: { cliente_id: cli, trajeto_id: t.id },
      orderBy: { seq: 'asc' },
      select: { lat: true, lng: true, capturado_em: true },
    });
    const norm = pontos.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), t: p.capturado_em.getTime() }));
    const distancia = t.status === STATUS_TRAJETO.ENCERRADO && t.distancia_m !== null
      ? numeroOuNulo(t.distancia_m)
      : arredondar2(distanciaDaLinhaM(norm));
    itens.push({
      ...comoTrajetoPublico(t, distancia),
      linha: amostrarLinha(norm).map((p) => ({ lat: p.lat, lng: p.lng })),
    });
  }
  return { trajetos: itens };
};
