/**
 * Cancelamento de movimentação do mapa — R2A (D-PROD-99) → R2E-P1 → PR174-R5.
 *
 * Uma transação PostgreSQL faz tudo ou nada:
 *   1. administrador ativo do tenant (`exigirAdminTenant`, relido do banco);
 *   2. idempotência por (cliente, operation_id, tipo) + fingerprint;
 *   3. trava do movimento (`FOR UPDATE`);
 *   4. movimento do LEDGER (`efeito_servidor.comando = 'rebanho_ledger'`):
 *      cancela o evento, revalida a linha do tempo das posições e marca o
 *      movimento `situacao: 'cancelado'` (o original não é apagado);
 *   5. qualquer outro movimento (anterior ao ledger) NUNCA é revertido: o
 *      modelo legado que escrevia em `Lote` não existe mais (PR174-R5).
 *      Empresa ativada → 409 `REBANHO_LEDGER_CANCELAMENTO_LEGADO`; empresa
 *      sem cutover → 409 `REBANHO_CUTOVER_PENDENTE`. Nada é gravado.
 *
 * Tudo vem do servidor: o corpo só traz `operation_id` e `motivo`.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirAdminTenant, atorDoTenant, ehAdminTenantAtivo } from '../../shared/auth/exigirAdminTenant.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { movimentoCitaLotes } from './movimentacaoVinculoLote.js';
import { COMANDO_MANEJO } from './manejoMapaComandoService.js';
import { COMANDO_REBANHO } from './manejoRebanhoComandoService.js';
import { COMANDO_JUNCAO } from './juncaoConstantes.js';
import { COMANDO_BAIXA } from './baixaConstantes.js';
import { COMANDO_LEDGER, cancelarMovimentoDoLedger, ehMovimentoDoLedger, exigirCancelamentoLegadoPermitido } from '../rebanhoLedger/rebanhoLedgerService.js';
import { exigirEmpresaNoLedger } from '../rebanhoLedger/rebanhoLedgerManejos.js';

export const TIPO_OPERACAO_CANCELAMENTO = 'cancelamento_movimentacao_mapa';
export const SITUACAO_CANCELADO = 'cancelado';

/**
 * Comandos que já gravaram `efeito_servidor` com proveniência (operação
 * idempotente + auditoria). Os quatro primeiros são do modelo anterior ao
 * ledger e só aparecem no histórico; a exclusão de entrada (#167) ainda os
 * reconhece como movimento comprovado.
 */
export const COMANDOS_CERTIFICADOS = Object.freeze([COMANDO_MANEJO, COMANDO_REBANHO, COMANDO_JUNCAO, COMANDO_BAIXA, COMANDO_LEDGER]);

const erroNaoEncontrado = () => new AppError('MOVIMENTACAOMAPA_NOT_FOUND', 'MovimentacaoMapa não encontrado');
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const data10 = (v) => (typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : '');

const buscarMovimento = async (tx, clienteId, id, travar) => {
  if (travar) {
    await tx.$queryRaw`SELECT id FROM "MovimentacaoMapa" WHERE cliente_id = ${clienteId} AND id = ${id} FOR UPDATE`;
  }
  return tx.movimentacaoMapa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
};

/**
 * PR174-R5: movimento que não é do ledger nunca é revertido pelo modelo antigo.
 * Empresa ativada → `REBANHO_LEDGER_CANCELAMENTO_LEGADO`; sem cutover →
 * `REBANHO_CUTOVER_PENDENTE` (o mesmo guarda dos comandos do mapa). Sempre lança.
 */
const recusarCancelamentoLegado = async (tx, clienteId, mov) => {
  await exigirCancelamentoLegadoPermitido(tx, clienteId, mov);
  await exigirEmpresaNoLedger(tx, clienteId, mov.empresa_id);
  // Inalcançável (ativada já recusou acima); fail-closed mesmo assim.
  throw recusa('REBANHO_LEDGER_CANCELAMENTO_LEGADO', 'movimentos anteriores ao ledger não são desfeitos pelo modelo antigo', { movimentacao_id: mov.id });
};

// ─── Dependências posteriores (banco, sem teto) ────────────────────────────

/** Fontes JSON com vínculo de lote: tabela fixa (constante, não entrada) e campos de data. */
export const FONTES_DE_LOTE = Object.freeze([
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
export const dependenciasPosteriores = async (tx, clienteId, mov, { loteIds, nomes, areaIds }) => {
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
          ${movimentoCitaLotes('m', lotes)}
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
        const mov = await buscarMovimento(tx, auth.clienteId, id, true);
        if (!mov) throw erroNaoEncontrado();
        // PR174-R5: só o ledger desfaz manejo; movimento legado nunca é revertido.
        if (!ehMovimentoDoLedger(mov)) await recusarCancelamentoLegado(tx, auth.clienteId, mov);
        // R2E-P1 (D-PROD-107): cancela o EVENTO e revalida a linha do tempo.
        if (mov.dados?.situacao === SITUACAO_CANCELADO) throw recusa('CANCELAMENTO_JA_REALIZADO', 'a movimentação já está cancelada');
        const { efeitos, cancelamento } = await cancelarMovimentoDoLedger(tx, contexto, mov, motivo, operationKey);
        const movCancelado = await tx.movimentacaoMapa.update({
          where: { cliente_id_id: { cliente_id: auth.clienteId, id } },
          data: { dados: { ...mov.dados, situacao: SITUACAO_CANCELADO, cancelamento: { ...cancelamento, por_login: ator?.login ?? auth.login ?? null } } },
        });
        await registrarEvento(contexto, { acao: 'cancelamento', entidade: 'MovimentacaoMapa', entidadeId: id, dadosAnteriores: documentoComoPublico(mov), dadosNovos: documentoComoPublico(movCancelado) }, tx);
        return { httpStatus: 200, body: { movimentacao: documentoComoPublico(movCancelado), efeitos } };
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
    const mov = await buscarMovimento(tx, auth.clienteId, id, false);
    if (!mov) throw erroNaoEncontrado();
    const recusado = (erro) => ({ elegivel: false, codigo: erro.code, motivo: erro.message, detalhes: erro.details ?? null, requer_administrador: true, pode_cancelar: podeCancelar });
    if (!ehMovimentoDoLedger(mov)) {
      try {
        await recusarCancelamentoLegado(tx, auth.clienteId, mov);
      } catch (erro) {
        if (erro instanceof AppError) return recusado(erro);
        throw erro;
      }
    }
    // Ensaio dentro de SAVEPOINT: o mesmo motor do POST, desfeito em seguida.
    await tx.$executeRawUnsafe('SAVEPOINT elegibilidade_ledger');
    try {
      if (mov.dados?.situacao === SITUACAO_CANCELADO) throw recusa('CANCELAMENTO_JA_REALIZADO', 'a movimentação já está cancelada');
      const { efeitos } = await cancelarMovimentoDoLedger(tx, contexto, mov, 'ensaio', 'ensaio');
      return { elegivel: true, codigo: null, motivo: null, tipo: mov.dados.tipo, modo: 'ledger', efeitos, requer_administrador: true, pode_cancelar: podeCancelar };
    } catch (erro) {
      if (erro instanceof AppError) return recusado(erro);
      throw erro;
    } finally {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT elegibilidade_ledger');
    }
  });
};
