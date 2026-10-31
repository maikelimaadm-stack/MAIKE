/**
 * Cancelamento de movimentação do mapa — R2A (D-PROD-95).
 *
 * Uma transação PostgreSQL faz tudo ou nada:
 *   1. administrador ativo do tenant (`exigirAdminTenant`, relido do banco);
 *   2. idempotência por (cliente, operation_id, tipo) + fingerprint;
 *   3. trava do movimento (`FOR UPDATE`) e dos lotes afetados em ordem de id;
 *   4. elegibilidade: tipo certificado, vínculo de lote provado, estado atual
 *      coerente, efeito original PROVADO no AuditLog e nenhuma dependência
 *      posterior (consulta completa no banco, sem teto);
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

/** Janela em que a atualização do lote acompanha a criação do movimento (fluxo legado em várias chamadas). */
const JANELA_PROVA_MS = 15 * 60 * 1000;

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

// ─── Prova do efeito original (AuditLog do lote) ───────────────────────────

/**
 * Existe auditoria do lote, perto da criação do movimento, com a mudança
 * esperada? Sem ela não há como saber se a segunda chamada do fluxo legado
 * (atualizar o lote) aconteceu — e cancelar devolveria cabeças que nunca saíram.
 *
 * @param {'delta'|'area'|'criacao'} forma
 */
const efeitoProvado = async (tx, clienteId, mov, loteId, forma, esperado) => {
  const inicio = new Date(mov.createdAt.getTime() - JANELA_PROVA_MS);
  const fim = new Date(mov.createdAt.getTime() + JANELA_PROVA_MS);
  const numero = (col) => Prisma.sql`CASE WHEN (${Prisma.raw(col)}->>'quantidade_cabecas') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${Prisma.raw(col)}->>'quantidade_cabecas')::numeric END`;
  let condicao;
  if (forma === 'delta') {
    condicao = Prisma.sql`a.acao = 'update' AND (${numero('a.dados_novos')}) - (${numero('a.dados_anteriores')}) = ${esperado.delta}`;
  } else if (forma === 'area') {
    condicao = Prisma.sql`a.acao = 'update' AND a.dados_anteriores->>'area_atual_id' = ${esperado.de} AND a.dados_novos->>'area_atual_id' = ${esperado.para}`;
  } else {
    condicao = Prisma.sql`a.acao = 'create' AND (${numero('a.dados_novos')}) = ${esperado.quantidade} AND a.dados_novos->>'area_atual_id' = ${esperado.area}`;
  }
  const linhas = /** @type {Array<{n: number}>} */ (
    await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM "AuditLog" a
      WHERE a.cliente_id = ${clienteId} AND a.entidade = 'Lote' AND a.entidade_id = ${loteId}
        AND a."createdAt" BETWEEN ${inicio} AND ${fim}
        AND COALESCE(a.dados_anteriores->>'origem', '') <> 'cancelamento_movimentacao'
        AND ${condicao}`
  );
  return Number(linhas[0]?.n ?? 0) > 0;
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
  const q = Number(d.quantidade_animais);
  if (!Number.isInteger(q) || q <= 0) {
    throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'quantidade do movimento inválida');
  }
  const loteId = texto(d.lote_id);
  if (!loteId) {
    throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'movimento sem identificador de lote (registro legado por nome)');
  }

  const areaOrigem = texto(d.area_origem_id);
  const areaDestino = texto(d.area_destino_id);
  const ehTransferencia = d.tipo === 'Transferência de Área';
  const modoGravado = MODOS_TRANSFERENCIA.includes(d.modo_transferencia) ? d.modo_transferencia : null;
  const destinoId = texto(d.lote_destino_id);
  if (ehTransferencia && (!areaOrigem || !areaDestino)) {
    throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'transferência sem área de origem e destino');
  }
  if (ehTransferencia && modoGravado && modoGravado !== 'total_no_lugar' && (!destinoId || destinoId === loteId)) {
    throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'transferência sem lote de destino provado');
  }

  const ids = [loteId, ...(ehTransferencia && destinoId && destinoId !== loteId ? [destinoId] : [])];
  const lotes = await buscarLotes(tx, clienteId, ids, travar);
  for (const idLote of ids) {
    const lote = lotes.get(idLote);
    if (!lote || lote.empresa_id !== mov.empresa_id) {
      throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'lote do movimento não encontrado nesta empresa', { lote_id: idLote });
    }
  }
  const origem = lotes.get(loteId);

  /** @type {Array<{lote_id: string, antes: Record<string, any>, depois: Record<string, any>}>} */
  const efeitos = [];
  let modo = null;

  if (!ehTransferencia) {
    // Morte / Abate: devolve q cabeças ao lote, na área onde o fato ocorreu.
    if (areaOrigem && origem.area_atual_id !== areaOrigem) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o lote não está mais na área do movimento');
    }
    if (origem.status !== 'Ativo' && origem.quantidade_cabecas !== 0) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'lote inativo com saldo — estado não explicável pelo movimento');
    }
    if (!(await efeitoProvado(tx, clienteId, mov, loteId, 'delta', { delta: -q }))) {
      throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'sem auditoria da baixa de cabeças no lote');
    }
    efeitos.push({
      lote_id: loteId,
      antes: { quantidade_cabecas: origem.quantidade_cabecas, status: origem.status },
      depois: { quantidade_cabecas: origem.quantidade_cabecas + q, status: 'Ativo' },
    });
  } else {
    // Transferência: modo gravado, ou — legado — só "total no lugar" é provável pelo estado.
    modo = modoGravado;
    if (!modo) {
      if (origem.area_atual_id === areaDestino && origem.status === 'Ativo' && origem.quantidade_cabecas === q) {
        modo = 'total_no_lugar';
      } else {
        throw recusa('CANCELAMENTO_VINCULO_AMBIGUO', 'registro legado sem lote de destino: parcial ou unificada não é cancelável com segurança');
      }
    }
    if (modo === 'total_no_lugar') {
      if (origem.area_atual_id !== areaDestino || origem.status !== 'Ativo' || origem.quantidade_cabecas !== q) {
        throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o lote não está no destino com a mesma quantidade');
      }
      if (!(await efeitoProvado(tx, clienteId, mov, loteId, 'area', { de: areaOrigem, para: areaDestino }))) {
        throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'sem auditoria da troca de área do lote');
      }
      const nomes = await buscarNomesDeAreas(tx, clienteId, mov.empresa_id, [areaOrigem]);
      efeitos.push({
        lote_id: loteId,
        antes: { area_atual_id: origem.area_atual_id, area_atual_nome: origem.area_atual_nome },
        depois: { area_atual_id: areaOrigem, area_atual_nome: nomes.get(areaOrigem) || d.area_origem_nome || null },
      });
    } else {
      const destino = lotes.get(destinoId);
      if (destino.area_atual_id !== areaDestino || destino.status !== 'Ativo') {
        throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o lote de destino não está ativo na área de destino');
      }
      if (origem.area_atual_id !== areaOrigem) {
        throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o lote de origem não está na área de origem');
      }
      if (destino.quantidade_cabecas < q) {
        throw recusa('CANCELAMENTO_SALDO_INSUFICIENTE', 'o lote de destino não tem as cabeças para devolver', { disponivel: destino.quantidade_cabecas, necessario: q });
      }
      if (modo === 'total_unificado' && (origem.status !== 'Inativo' || origem.quantidade_cabecas !== 0)) {
        throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o lote de origem não está zerado como a unificação total deixou');
      }
      if (modo === 'parcial_novo_lote' && destino.area_entrada_id !== areaDestino) {
        throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o lote derivado não entrou pela área de destino');
      }
      const provaOrigem = await efeitoProvado(tx, clienteId, mov, loteId, 'delta', { delta: -q });
      const provaDestino =
        modo === 'parcial_novo_lote'
          ? await efeitoProvado(tx, clienteId, mov, destinoId, 'criacao', { quantidade: q, area: areaDestino })
          : await efeitoProvado(tx, clienteId, mov, destinoId, 'delta', { delta: q });
      if (!provaOrigem || !provaDestino) {
        throw recusa('CANCELAMENTO_EFEITO_NAO_COMPROVADO', 'sem auditoria da saída na origem e da entrada no destino');
      }
      const destinoDepois = destino.quantidade_cabecas - q;
      efeitos.push({
        lote_id: loteId,
        antes: { quantidade_cabecas: origem.quantidade_cabecas, status: origem.status },
        depois: { quantidade_cabecas: origem.quantidade_cabecas + q, status: 'Ativo' },
      });
      efeitos.push({
        lote_id: destinoId,
        antes: { quantidade_cabecas: destino.quantidade_cabecas, status: destino.status },
        depois: { quantidade_cabecas: destinoDepois, status: destinoDepois > 0 ? destino.status : 'Inativo' },
      });
    }
  }

  const dependencias = await dependenciasPosteriores(tx, clienteId, mov, {
    loteIds: ids,
    nomes: [d.lote, ...ids.map((i) => lotes.get(i)?.nome)],
    areaIds: ehTransferencia ? [areaOrigem, areaDestino] : [],
  });
  if (dependencias.length) {
    throw recusa('CANCELAMENTO_DEPENDENCIA_POSTERIOR', 'há registro posterior ligado ao lote ou à área', { dependencias });
  }

  // Conservação: transferência não cria nem some com cabeças.
  if (ehTransferencia) {
    const soma = (k) => efeitos.reduce((t, e) => t + (typeof e[k].quantidade_cabecas === 'number' ? e[k].quantidade_cabecas : 0), 0);
    if (soma('antes') !== soma('depois')) {
      throw recusa('CANCELAMENTO_ESTADO_DIVERGENTE', 'o cancelamento não conservaria as cabeças');
    }
  }
  return { mov, tipo: d.tipo, modo, quantidade: q, efeitos };
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
