/**
 * Serviço transacional do ledger pecuário (L1 — backend isolado, SEM rota).
 *
 * Cada comando é UMA transação PostgreSQL:
 *   idempotência (OperacaoIdempotente, chave tenant+operation_id)
 *   → valida empresa/áreas/categoria/lote no tenant do auth_context
 *   → trava posições em ordem determinística (SELECT … FOR UPDATE)
 *   → confere saldo, grava evento + partidas (append-only), aplica deltas
 *   → commit. Qualquer erro = rollback total (nada parcial).
 *
 * Conflitos transitórios (unique concorrente, deadlock, serialização) têm
 * retry limitado com backoff curto; na 2ª tentativa a idempotência devolve o
 * resultado já gravado (replay) ou o conflito real.
 *
 * O tenant vem SÓ de `contexto.auth` (R11). O esquema das tabelas é injetado
 * e não pode ser `public` (L1 não cria tabela fora do schema Prisma).
 * Nada aqui escreve em `Lote`: a entrada histórica é preservada (decisão A).
 */

import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import {
  TIPOS_EVENTO,
  chavesDeTravaOrdenadas,
  normalizarOperationId,
  payloadCanonico,
  planejarEntrada,
  planejarEstorno,
  planejarTransferencia,
} from './ledgerPecuarioContrato.js';
import { esquemaSeguro } from './ledgerPecuarioDdl.js';
import { CODIGOS_LEDGER_PECUARIO as C, LedgerPecuarioError } from './ledgerPecuarioErros.js';
import * as repo from './ledgerPecuarioRepositorioPg.js';

/** Um só tipo de operação: reusar operation_id entre comandos diferentes é conflito. */
export const TIPO_OPERACAO_IDEMPOTENTE = 'ledger_pecuario';
const TENTATIVAS = 3;

/**
 * @typedef {{ clienteId: string, usuarioId: string, login?: string }} AuthLedger
 * @typedef {{ auth: AuthLedger, requestId?: string }} ContextoLedger
 * @typedef {{
 *   prisma: { $transaction: Function, $queryRawUnsafe: Function, $executeRawUnsafe: Function },
 *   esquema: string,
 *   ganchoTeste?: { aposPrimeiraPartida?: () => Promise<void> | void },
 * }} DependenciasLedger
 */

/**
 * @param {ContextoLedger | undefined} contexto
 * @returns {AuthLedger}
 */
const exigirAuth = (contexto) => {
  const auth = contexto?.auth;
  if (!auth?.clienteId || !auth?.usuarioId) {
    throw new LedgerPecuarioError(C.CONTEXTO_OBRIGATORIO, 'auth_context obrigatório');
  }
  return auth;
};

/**
 * Conflito transitório que merece nova tentativa (corrida entre transações),
 * em oposição a erro de negócio/validação.
 * @param {unknown} erro
 */
const SQLSTATE_TRANSITORIOS = ['23505', '40001', '40P01', '25P02'];
const ehTransitorio = (erro) => {
  const e = /** @type {{ code?: string, meta?: { code?: string }, message?: string }} */ (erro);
  if (e?.code === 'P2002' || e?.code === 'P2034') return true;
  if (e?.code === 'P2010' && SQLSTATE_TRANSITORIOS.includes(String(e?.meta?.code))) return true;
  // Transação abortada após unique concorrente (ex.: OperacaoIdempotente):
  // o Prisma devolve erro "desconhecido", só com o SQLSTATE na mensagem.
  const msg = String(e?.message ?? '');
  return /code: "(23505|40001|40P01|25P02)"/.test(msg);
};

/** @param {number} ms */
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Traduz os códigos da idempotência compartilhada para os do ledger.
 * @param {unknown} erro
 */
const traduzirIdempotencia = (erro) => {
  if (erro instanceof AppError && erro.code === 'IDEMPOTENCY_CONFLICT') {
    return new LedgerPecuarioError(C.IDEMPOTENCIA_CONFLITO, 'operation_id reutilizado com payload diferente', { cause: erro });
  }
  if (erro instanceof AppError && erro.code === 'IDEMPOTENCY_IN_PROGRESS') {
    return new LedgerPecuarioError(C.IDEMPOTENCIA_EM_PROCESSAMENTO, 'operação com o mesmo operation_id em processamento', { cause: erro });
  }
  return erro;
};

/**
 * @param {DependenciasLedger} deps
 */
export const criarLedgerPecuario = (deps) => {
  const { prisma, esquema } = deps;
  esquemaSeguro(esquema); // falha cedo: nunca public, sempre identificador válido

  /**
   * @param {any} tx
   * @param {string} clienteId
   * @param {string} empresaId
   */
  const exigirEmpresa = async (tx, clienteId, empresaId) => {
    const empresa = await tx.empresa.findFirst({ where: { cliente_id: clienteId, id: empresaId }, select: { id: true } });
    if (!empresa) throw new LedgerPecuarioError(C.EMPRESA_INVALIDA, 'empresa não encontrada neste tenant', { details: { field: 'empresa_id' } });
  };

  /**
   * Área precisa ser do tenant E da empresa do evento (bloqueia cruzar empresas).
   * Destino inativo é recusado; origem inativa é aceita (tirar animais de lá).
   * @param {any} tx
   * @param {string} clienteId
   * @param {string} empresaId
   * @param {string} areaId
   * @param {'origem' | 'destino'} papel
   */
  const exigirArea = async (tx, clienteId, empresaId, areaId, papel) => {
    const area = await tx.areaPastagem.findFirst({
      where: { cliente_id: clienteId, empresa_id: empresaId, id: areaId },
      select: { id: true, ativo: true },
    });
    const codigo = papel === 'origem' ? C.ORIGEM_INVALIDA : C.DESTINO_INVALIDO;
    if (!area) throw new LedgerPecuarioError(codigo, `área de ${papel} não pertence a esta empresa/tenant`, { details: { field: `area_${papel}_id` } });
    if (papel === 'destino' && area.ativo === false) {
      throw new LedgerPecuarioError(codigo, 'área de destino inativa', { details: { field: 'area_destino_id' } });
    }
  };

  /**
   * @param {any} tx
   * @param {string} clienteId
   * @param {string} empresaId
   * @param {string | null} categoriaManejoId
   */
  const exigirCategoria = async (tx, clienteId, empresaId, categoriaManejoId) => {
    if (!categoriaManejoId) return;
    const cat = await tx.categoriaManejo.findFirst({
      where: { cliente_id: clienteId, empresa_id: empresaId, id: categoriaManejoId },
      select: { id: true },
    });
    if (!cat) throw new LedgerPecuarioError(C.CATEGORIA_INVALIDA, 'categoria de manejo não pertence a esta empresa/tenant', { details: { field: 'categoria_manejo_id' } });
  };

  /**
   * Trava, confere e aplica as partidas; grava evento + partidas.
   * @param {any} tx
   * @param {AuthLedger} auth
   * @param {ContextoLedger} contexto
   * @param {string} operationId
   * @param {import('./ledgerPecuarioContrato.js').EventoPlanejado} plano
   * @param {string | null} estornoDe
   */
  const gravar = async (tx, auth, contexto, operationId, plano, estornoDe) => {
    const chaves = chavesDeTravaOrdenadas(plano.partidas);
    /** @type {Map<string, number>} */
    const saldos = new Map();
    for (const chave of chaves) {
      await repo.garantirPosicao(tx, esquema, auth.clienteId, plano.empresa_id, chave);
      saldos.set(`${chave.area_id}\u0000${chave.categoria_chave}`, await repo.travarPosicao(tx, esquema, auth.clienteId, plano.empresa_id, chave));
    }
    for (const p of plano.partidas) {
      const k = `${p.area_id}\u0000${p.categoria_chave}`;
      const saldo = saldos.get(k) ?? 0;
      if (saldo + p.delta < 0) {
        throw new LedgerPecuarioError(C.SALDO_INSUFICIENTE, 'saldo insuficiente na posição', {
          details: { area_id: p.area_id, categoria_chave: p.categoria_chave, saldo, solicitado: -p.delta },
        });
      }
      saldos.set(k, saldo + p.delta);
    }

    const evento = await repo.inserirEvento(tx, esquema, {
      cliente_id: auth.clienteId,
      empresa_id: plano.empresa_id,
      tipo: plano.tipo,
      operation_id: operationId,
      data_operacional: plano.data_operacional,
      quantidade: plano.quantidade,
      categoria_chave: plano.categoria_chave,
      area_origem_id: plano.area_origem_id,
      area_destino_id: plano.area_destino_id,
      lote_referencia_id: plano.lote_referencia_id,
      estorno_de_evento_id: estornoDe,
      motivo: plano.motivo,
      autor_usuario_id: auth.usuarioId,
      request_id: contexto.requestId ? String(contexto.requestId).slice(0, 128) : null,
    });

    let primeira = true;
    /** @type {Array<{ area_id: string, categoria_chave: string, saldo: number }>} */
    const posicoes = [];
    for (const p of plano.partidas) {
      const novo = await repo.aplicarDeltaPosicao(tx, esquema, auth.clienteId, plano.empresa_id, p);
      if (novo === null) {
        throw new LedgerPecuarioError(C.SALDO_INSUFICIENTE, 'saldo insuficiente na posição', { details: { area_id: p.area_id } });
      }
      posicoes.push({ area_id: p.area_id, categoria_chave: p.categoria_chave, saldo: novo });
      if (primeira && deps.ganchoTeste?.aposPrimeiraPartida) await deps.ganchoTeste.aposPrimeiraPartida();
      primeira = false;
    }
    await repo.inserirPartidas(tx, esquema, { evento_id: String(evento.id), cliente_id: auth.clienteId, empresa_id: plano.empresa_id }, plano.partidas);

    return {
      committed: true,
      operation_id: operationId,
      replay: false,
      evento: { ...evento, quantidade: Number(evento.quantidade), created_at: new Date(/** @type {any} */ (evento.created_at)).toISOString() },
      partidas: plano.partidas,
      posicoes,
    };
  };

  /**
   * Envelope comum: idempotência + transação + retry limitado.
   * @param {ContextoLedger} contexto
   * @param {string} comando
   * @param {Record<string, unknown>} entrada
   * @param {(tx: any, auth: AuthLedger, operationId: string) => Promise<Record<string, unknown>>} executar
   */
  const executarComando = async (contexto, comando, entrada, executar) => {
    const auth = exigirAuth(contexto);
    const operationId = normalizarOperationId(entrada.operation_id);
    const fingerprint = fingerprintDePayload(payloadCanonico(comando, entrada));

    let ultimoErro;
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
      try {
        const r = await prisma.$transaction(async (/** @type {any} */ tx) =>
          executarComIdempotencia(tx, {
            clienteId: auth.clienteId,
            operationKey: operationId,
            tipoOperacao: TIPO_OPERACAO_IDEMPOTENTE,
            fingerprint,
            executar: async () => ({ httpStatus: 201, body: await executar(tx, auth, operationId) }),
          })
        );
        return r.replay ? { ...r.body, replay: true } : r.body;
      } catch (erro) {
        const traduzido = traduzirIdempotencia(erro);
        if (traduzido !== erro) throw traduzido;
        if (!ehTransitorio(erro)) throw erro;
        ultimoErro = erro;
        await esperar(15 * tentativa);
      }
    }
    throw new LedgerPecuarioError(C.CONCORRENCIA_ESGOTADA, 'conflito de concorrência persistente; tente novamente', { cause: ultimoErro });
  };

  return {
    /**
     * Lançamento histórico de ENTRADA (compra/nascimento) numa área.
     * @param {ContextoLedger} contexto
     * @param {Record<string, unknown>} entrada
     */
    registrarEntrada: async (contexto, entrada) => {
      const plano = planejarEntrada(entrada);
      return executarComando(contexto, TIPOS_EVENTO.ENTRADA, entrada, async (tx, auth, operationId) => {
        await exigirEmpresa(tx, auth.clienteId, plano.empresa_id);
        await exigirArea(tx, auth.clienteId, plano.empresa_id, /** @type {string} */ (plano.area_destino_id), 'destino');
        await exigirCategoria(tx, auth.clienteId, plano.empresa_id, plano.categoria_manejo_id);
        if (plano.lote_referencia_id) {
          const lote = await tx.lote.findFirst({
            where: { cliente_id: auth.clienteId, empresa_id: plano.empresa_id, id: plano.lote_referencia_id },
            select: { id: true },
          });
          if (!lote) throw new LedgerPecuarioError(C.LOTE_REFERENCIA_INVALIDO, 'lote de referência não pertence a esta empresa/tenant', { details: { field: 'lote_referencia_id' } });
          if (await repo.loteTemEntradaAtiva(tx, esquema, auth.clienteId, plano.lote_referencia_id)) {
            throw new LedgerPecuarioError(C.LOTE_REFERENCIA_INVALIDO, 'este lote já tem entrada lançada no ledger', { details: { field: 'lote_referencia_id' } });
          }
        }
        return gravar(tx, auth, contexto, operationId, plano, null);
      });
    },

    /**
     * TRANSFERÊNCIA interna conservativa entre duas áreas da mesma empresa.
     * @param {ContextoLedger} contexto
     * @param {Record<string, unknown>} entrada
     */
    registrarTransferencia: async (contexto, entrada) => {
      const plano = planejarTransferencia(entrada);
      return executarComando(contexto, TIPOS_EVENTO.TRANSFERENCIA, entrada, async (tx, auth, operationId) => {
        await exigirEmpresa(tx, auth.clienteId, plano.empresa_id);
        await exigirArea(tx, auth.clienteId, plano.empresa_id, /** @type {string} */ (plano.area_origem_id), 'origem');
        await exigirArea(tx, auth.clienteId, plano.empresa_id, /** @type {string} */ (plano.area_destino_id), 'destino');
        await exigirCategoria(tx, auth.clienteId, plano.empresa_id, plano.categoria_manejo_id);
        return gravar(tx, auth, contexto, operationId, plano, null);
      });
    },

    /**
     * ESTORNO append-only de um evento (partidas inversas). Um por original.
     * @param {ContextoLedger} contexto
     * @param {Record<string, unknown>} entrada { operation_id, evento_id, motivo, data_operacional }
     */
    registrarEstorno: async (contexto, entrada) =>
      executarComando(contexto, TIPOS_EVENTO.ESTORNO, entrada, async (tx, auth, operationId) => {
        const eventoId = typeof entrada.evento_id === 'string' ? entrada.evento_id.trim() : '';
        const achado = eventoId ? await repo.buscarEventoParaEstorno(tx, esquema, auth.clienteId, eventoId) : null;
        if (!achado) throw new LedgerPecuarioError(C.EVENTO_NAO_ENCONTRADO, 'evento não encontrado neste tenant', { details: { field: 'evento_id' } });
        if (achado.jaEstornado) throw new LedgerPecuarioError(C.ESTORNO_DUPLICADO, 'evento já estornado', { details: { field: 'evento_id' } });
        const plano = planejarEstorno(/** @type {any} */ (achado.evento), { partidas: achado.partidas }, entrada);
        return gravar(tx, auth, contexto, operationId, plano, eventoId);
      }),

    /**
     * Posição atual (projeção) da empresa no tenant do contexto.
     * @param {ContextoLedger} contexto
     * @param {string} empresaId
     */
    listarPosicoes: async (contexto, empresaId) => repo.listarPosicoes(prisma, esquema, exigirAuth(contexto).clienteId, empresaId),

    /**
     * Posição reconstruída dos fatos (para auditoria de consistência).
     * @param {ContextoLedger} contexto
     * @param {string} empresaId
     */
    reconstruirPosicoes: async (contexto, empresaId) =>
      repo.reconstruirPosicoesDosFatos(prisma, esquema, exigirAuth(contexto).clienteId, empresaId),
  };
};
