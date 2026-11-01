/**
 * Cancelamento de movimentação do mapa — R2A (D-PROD-95).
 *
 * Uma transação PostgreSQL faz tudo ou nada:
 *   1. administrador ativo do tenant (`exigirAdminTenant`, relido do banco);
 *   2. idempotência por (cliente, operation_id, tipo) + fingerprint;
 *   3. trava do movimento (`FOR UPDATE`) e dos lotes afetados em ordem de id;
 *   4. elegibilidade: tipo certificado, PROVENIÊNCIA causal (o movimento nasceu
 *      do comando atômico de manejo — `efeito_servidor` reservado + operação
 *      idempotente confirmada apontando para ele; R2A-R1), estado atual coerente
 *      e nenhuma dependência posterior (consulta completa no banco, sem teto);
 *   5. aplica o delta nos lotes, marca o movimento como `situacao: 'cancelado'`
 *      (o original não é apagado nem tem a data mudada) e audita.
 *
 * Tudo vem do servidor: o corpo só traz `operation_id` e `motivo`. Na dúvida,
 * recusa com código estável — ambiguidade é proteção, não convite a heurística.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirAdminTenant, atorDoTenant, ehAdminTenantAtivo } from '../../shared/auth/exigirAdminTenant.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { buscarNomesDeAreas } from './movimentacaoMapaRepository.js';
import { COMANDO_MANEJO, TIPO_OPERACAO_MANEJO } from './manejoMapaComandoService.js';

export const TIPO_OPERACAO_CANCELAMENTO = 'cancelamento_movimentacao_mapa';
export const SITUACAO_CANCELADO = 'cancelado';

/** Tipos com cancelamento certificado neste slice. */
export const TIPOS_CANCELAVEIS = Object.freeze(['Morte', 'Abate', 'Transferência de Área']);

/** Modos de transferência gravados pelo `DetalhesLote` a partir da R2A. */
export const MODOS_TRANSFERENCIA = Object.freeze([
  'total_no_lugar',
  'total_unificado',
  'parcial_unificado',
  'parcial_novo_lote',
]);


const erroNaoEncontrado = () => new AppError('MOVIMENTACAOMAPA_NOT_FOUND', 'MovimentacaoMapa não encontrado');
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const data10 = (v) => (typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : '');

// ─── Leitura com trava ─────────────────────────────────────────────────────

const buscarMovimento = async (tx, clienteId, id, travar) => {
  if (travar) {
    await tx.$queryRaw`SELECT id FROM "MovimentacaoMapa" WHERE cliente_id = ${clienteId} AND id = ${id} FOR UPDATE`;
  }
  return tx.movimentacaoMapa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
};

const buscarLotes = async (tx, clienteId, ids, travar) => {
  const ordenados = [...new Set(ids)].sort();
  if (travar && ordenados.length) {
    await tx.$queryRaw`SELECT id FROM "Lote" WHERE cliente_id = ${clienteId} AND id = ANY(${ordenados}::text[]) ORDER BY id FOR UPDATE`;
  }
  const lotes = await tx.lote.findMany({ where: { cliente_id: clienteId, id: { in: ordenados } } });
  return new Map(lotes.map((l) => [l.id, l]));
};

// ─── Proveniência causal (R2A-R1, D-PROD-95a) ──────────────────────────────

/**
 * O efeito só é provado quando o movimento nasceu do comando atômico de manejo:
 * `efeito_servidor` é campo reservado (POST/bulk/PATCH genéricos recusam) e a
 * operação idempotente que o gerou precisa existir, confirmada, apontando
 * para ESTE movimento. Coincidência de tempo, valor, nome, área ou AuditLog
 * não prova nada — registro sem isso é recusado (fail-closed).
 */
const exigirProveniencia = async (tx, clienteId, mov) => {
  const efeito = mov.dados?.efeito_servidor;
  const valido =
    efeito &&
    typeof efeito === 'object' &&
    efeito.comando === COMANDO_MANEJO &&
    typeof efeito.operation_id === 'string' &&
    Array.isArray(efeito.efeitos) &&
    efeito.efeitos.length > 0 &&
    efeito.efeitos.every((x) => x && typeof x.lote_id === 'string' && x.antes && x.depois);
  if (!valido) {
    throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'registro sem comprovação individual de efeito (anterior ao comando atômico)');
  }
  const operacao = await tx.operacaoIdempotente.findUnique({
    where: {
      cliente_id_operation_key_tipo_operacao: { cliente_id: clienteId, operation_key: efeito.operation_id, tipo_operacao: TIPO_OPERACAO_MANEJO },
    },
  });
  const resposta = /** @type {any} */ (operacao?.response_json);
  if (!operacao || operacao.status !== 'committed' || resposta?.movimentacao?.id !== mov.id) {
    throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'operação que gerou o efeito não confere com este movimento');
  }
  return efeito;
};

// ─── Dependências posteriores (banco, sem teto) ────────────────────────────

/** Fontes JSON com vínculo de lote: tabela fixa (constante, não entrada) e campos de data. */
const FONTES_DE_LOTE = Object.freeze([
  { tabela: 'MovimentacaoPecuaria', datas: ['data_movimentacao', 'data_evento'] },
  { tabela: 'SuplementacaoLote', datas: ['data_lancamento'] },
  { tabela: 'AplicacaoMedicamento', datas: ['data_aplicacao'] },
  { tabela: 'EventoSanitario', datas: ['data_evento'] },
  { tabela: 'ManejoTecnicoRebanho', datas: ['data_evento'] },
]);

const posteriorA = (alias, campos, mov) => {
  const dataMov = data10(mov.dados?.data_movimentacao) || data10(mov.createdAt);
  const datas = campos.map((c) => Prisma.sql`left(COALESCE(${Prisma.raw(alias)}.dados->>${c}, ''), 10) > ${dataMov}`);
  return Prisma.sql`(${Prisma.raw(alias)}."createdAt" > ${mov.createdAt} OR ${Prisma.join(datas, ' OR ')})`;
};

/**
 * Conta registros posteriores ligados aos lotes (por ID; nome só para registro
 * legado SEM id) e, em transferência, às áreas. Conservador por desenho: na
 * dúvida conta. Movimentos cancelados não contam.
 */
const dependenciasPosteriores = async (tx, clienteId, mov, { loteIds, nomes, areaIds }) => {
  const encontrados = [];
  const lotes = [...new Set(loteIds)];
  const nomesUp = [...new Set(nomes.filter(Boolean).map((n) => n.trim().toUpperCase()))];

  const porArea = areaIds.length
    ? Prisma.sql`OR m.dados->>'area_origem_id' = ANY(${areaIds}::text[]) OR m.dados->>'area_destino_id' = ANY(${areaIds}::text[]) OR m.dados->>'area_id' = ANY(${areaIds}::text[])`
    : Prisma.empty;
  const [mapa] = /** @type {Array<{n: number}>} */ (
    await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM "MovimentacaoMapa" m
      WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${mov.empresa_id} AND m.id <> ${mov.id}
        AND COALESCE(m.dados->>'situacao', '') <> ${SITUACAO_CANCELADO}
        AND (
          m.dados->>'lote_id' = ANY(${lotes}::text[])
          OR m.dados->>'lote_destino_id' = ANY(${lotes}::text[])
          OR EXISTS (SELECT 1 FROM unnest(${lotes}::text[]) AS l(id) WHERE position(l.id IN COALESCE(m.dados->>'observacoes', '')) > 0)
          OR (COALESCE(m.dados->>'lote_id', '') = '' AND upper(btrim(COALESCE(m.dados->>'lote', ''))) = ANY(${nomesUp}::text[]))
          ${porArea}
        )
        AND ${posteriorA('m', ['data_movimentacao'], mov)}`
  );
  if (mapa?.n) encontrados.push({ fonte: 'MovimentacaoMapa', quantidade: mapa.n });

  for (const fonte of FONTES_DE_LOTE) {
    const [linha] = /** @type {Array<{n: number}>} */ (
      await tx.$queryRaw`
        SELECT COUNT(*)::int AS n FROM ${Prisma.raw(`"${fonte.tabela}"`)} d
        WHERE d.cliente_id = ${clienteId} AND d.empresa_id = ${mov.empresa_id}
          AND (
            d.dados->>'lote_id' = ANY(${lotes}::text[])
            OR (COALESCE(d.dados->>'lote_id', '') = ''
                AND upper(btrim(COALESCE(d.dados->>'lote', d.dados->>'lote_nome', d.dados->>'nome_lote', ''))) = ANY(${nomesUp}::text[]))
          )
          AND ${posteriorA('d', fonte.datas, mov)}`
    );
    if (linha?.n) encontrados.push({ fonte: fonte.tabela, quantidade: linha.n });
  }

  const tarefas = await tx.lancamentoTarefa.count({
    where: { cliente_id: clienteId, empresa_id: mov.empresa_id, lote_id: { in: lotes }, createdAt: { gt: mov.createdAt } },
  });
  if (tarefas) encontrados.push({ fonte: 'LancamentoTarefa', quantidade: tarefas });

  return encontrados;
};

// ─── Plano do cancelamento (sem efeito) ────────────────────────────────────

/**
 * Analisa o movimento e devolve o plano de efeitos, ou lança recusa estável.
 * Com `travar`, segura o movimento e os lotes até o fim da transação.
 */
export const planejarCancelamento = async (tx, clienteId, id, { travar }) => {
  const mov = await buscarMovimento(tx, clienteId, id, travar);
  if (!mov) throw erroNaoEncontrado();
  const d = /** @type {Record<string, any>} */ (mov.dados || {});

  if (d.situacao === SITUACAO_CANCELADO) {
    throw recusa('CANCELAMENTO_JA_REALIZADO', 'a movimentação já está cancelada');
  }
  if (!TIPOS_CANCELAVEIS.includes(d.tipo) || texto(d.motivo)) {
    throw recusa('CANCELAMENTO_TIPO_NAO_SUPORTADO', 'cancelamento ainda não disponível para este tipo', { tipo: d.tipo ?? null, motivo: d.motivo ?? null });
  }
  if (!texto(d.lote_id)) {
    throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'movimento sem identificador de lote (registro legado por nome)');
  }

  const efeito = await exigirProveniencia(tx, clienteId, mov);
  const ehTransferencia = d.tipo === 'Transferência de Área';
  const ids = efeito.efeitos.map((x) => x.lote_id);
  const lotes = await buscarLotes(tx, clienteId, ids, travar);

  /** @type {Array<{lote_id: string, antes: Record<string, any>, depois: Record<string, any>}>} */
  const efeitos = [];
  for (const registro of efeito.efeitos) {
    const lote = lotes.get(registro.lote_id);
    if (!lote || lote.empresa_id !== mov.empresa_id) {
      throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'lote do efeito não encontrado nesta empresa', { lote_id: registro.lote_id });
    }
    // O lote tem de estar onde o efeito o deixou (não mudou de área desde então).
    if ((lote.area_atual_id ?? null) !== (registro.depois.area_atual_id ?? null)) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o lote não está na área em que o movimento o deixou', { lote_id: lote.id });
    }
    if (lote.status === 'Inativo' && lote.quantidade_cabecas > 0) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'lote inativo com saldo — estado não explicável', { lote_id: lote.id });
    }
    const delta = Number(registro.antes.quantidade_cabecas) - Number(registro.depois.quantidade_cabecas);
    const nova = lote.quantidade_cabecas + delta;
    if (!Number.isInteger(nova) || nova < 0) {
      throw recusa('CANCELAMENTO_SALDO_INSUFICIENTE', 'o lote não tem saldo para desfazer o movimento', { lote_id: lote.id, disponivel: lote.quantidade_cabecas, necessario: -delta });
    }
    /** @type {Record<string, any>} */
    const depois = { quantidade_cabecas: nova, status: nova === 0 ? 'Inativo' : lote.status === 'Inativo' ? 'Ativo' : lote.status };
    if ((registro.antes.area_atual_id ?? null) !== (registro.depois.area_atual_id ?? null) && registro.antes.area_atual_id) {
      const nomes = await buscarNomesDeAreas(tx, clienteId, mov.empresa_id, [registro.antes.area_atual_id]);
      depois.area_atual_id = registro.antes.area_atual_id;
      depois.area_atual_nome = nomes.get(registro.antes.area_atual_id) || d.area_origem_nome || null;
    }
    const antes = { quantidade_cabecas: lote.quantidade_cabecas, status: lote.status };
    if (depois.area_atual_id) Object.assign(antes, { area_atual_id: lote.area_atual_id, area_atual_nome: lote.area_atual_nome });
    efeitos.push({ lote_id: lote.id, antes, depois });
  }

  const dependencias = await dependenciasPosteriores(tx, clienteId, mov, {
    loteIds: ids,
    nomes: [d.lote, ...ids.map((i) => lotes.get(i)?.nome)],
    areaIds: ehTransferencia ? [texto(d.area_origem_id), texto(d.area_destino_id)].filter(Boolean) : [],
  });
  if (dependencias.length) {
    throw recusa('CANCELAMENTO_DEPENDENCIA_POSTERIOR', 'há registro posterior ligado ao lote ou à área', { dependencias });
  }

  // Conservação: transferência não cria nem some com cabeças.
  if (ehTransferencia) {
    const soma = (k) => efeitos.reduce((t, x) => t + x[k].quantidade_cabecas, 0);
    if (soma('antes') !== soma('depois')) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o cancelamento não conservaria as cabeças');
    }
  }
  return { mov, tipo: d.tipo, modo: efeito.modo ?? null, quantidade: Number(d.quantidade_animais), efeitos };
};

// ─── Comando ───────────────────────────────────────────────────────────────

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {string} id
 * @param {{operation_id: string, motivo: string}} entrada
 */
export const cancelar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const operationKey = texto(entrada?.operation_id);
  const motivo = texto(entrada?.motivo);
  if (!operationKey || !motivo) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id e motivo são obrigatórios');
  }
  const fingerprint = fingerprintDePayload({ movimentacao_id: id, motivo });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) => {
    const ator = await exigirAdminTenant(contexto, tx);
    return executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_OPERACAO_CANCELAMENTO,
      fingerprint,
      executar: async () => {
        const plano = await planejarCancelamento(tx, auth.clienteId, id, { travar: true });
        for (const efeito of plano.efeitos) {
          const anterior = await tx.lote.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: efeito.lote_id } } });
          const atualizado = await tx.lote.update({
            where: { cliente_id_id: { cliente_id: auth.clienteId, id: efeito.lote_id } },
            data: efeito.depois,
          });
          await registrarEvento(
            contexto,
            {
              acao: 'update',
              entidade: 'Lote',
              entidadeId: efeito.lote_id,
              dadosAnteriores: { ...efeito.antes, quantidade_cabecas_anterior: anterior?.quantidade_cabecas ?? null, origem: 'cancelamento_movimentacao' },
              dadosNovos: { ...efeito.depois, quantidade_cabecas: atualizado.quantidade_cabecas, movimentacao_cancelada_id: id },
            },
            tx
          );
        }
        const cancelamento = {
          em: new Date().toISOString(),
          por_usuario_id: auth.usuarioId,
          por_login: ator?.login ?? auth.login ?? null,
          motivo,
          operation_id: operationKey,
          modo: plano.modo,
          efeitos: plano.efeitos,
        };
        const movAtualizado = await tx.movimentacaoMapa.update({
          where: { cliente_id_id: { cliente_id: auth.clienteId, id } },
          data: { dados: { ...plano.mov.dados, situacao: SITUACAO_CANCELADO, cancelamento } },
        });
        await registrarEvento(
          contexto,
          {
            acao: 'cancelamento',
            entidade: 'MovimentacaoMapa',
            entidadeId: id,
            dadosAnteriores: documentoComoPublico(plano.mov),
            dadosNovos: documentoComoPublico(movAtualizado),
          },
          tx
        );
        return { httpStatus: 200, body: { movimentacao: documentoComoPublico(movAtualizado), efeitos: plano.efeitos } };
      },
    });
  });
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};

/**
 * Elegibilidade — só informativa: o POST revalida tudo dentro da transação.
 * Outro tenant: 404. Recusa vira `{elegivel: false, codigo, motivo}`.
 */
export const elegibilidade = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const ator = await atorDoTenant(contexto, tx);
    const podeCancelar = ehAdminTenantAtivo(ator);
    try {
      const plano = await planejarCancelamento(tx, auth.clienteId, id, { travar: false });
      return { elegivel: true, codigo: null, motivo: null, tipo: plano.tipo, modo: plano.modo, efeitos: plano.efeitos, requer_administrador: true, pode_cancelar: podeCancelar };
    } catch (erro) {
      if (erro instanceof AppError && erro.code !== 'MOVIMENTACAOMAPA_NOT_FOUND') {
        return { elegivel: false, codigo: erro.code, motivo: erro.message, detalhes: erro.details ?? null, requer_administrador: true, pode_cancelar: podeCancelar };
      }
      throw erro;
    }
  });
};
