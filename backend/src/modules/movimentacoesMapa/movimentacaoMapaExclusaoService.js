/**
 * Exclusão DEFINITIVA segura de movimentação do mapa — D-PROD-110.
 *
 * Contrato oficial (só online; a UI não enfileira):
 *   GET  /movimentacoes-mapa/:id/elegibilidade-exclusao  (informativa, sem gravar)
 *   POST /movimentacoes-mapa/:id/exclusao  {operation_id, motivo}
 *
 * Uma transação PostgreSQL faz tudo ou nada:
 *   1. administrador ativo do tenant (relido do banco);
 *   2. idempotência por (cliente, operation_id, tipo) + fingerprint — retry com
 *      a mesma chave devolve o mesmo corpo, sem segundo estorno;
 *   3. trava do movimento (`FOR UPDATE`) — mesma ordem do cancelamento
 *      (movimento → áreas → posições), então cancelar × excluir e duas
 *      exclusões se serializam sem deadlock;
 *   4. só movimento certificado do ledger e não cancelado; o resto é recusado
 *      com código estável (sem limpeza retroativa);
 *   5. reversão pelo motor certificado + exclusão física do fato
 *      (`excluirMovimentoDoLedger`).
 *
 * Nada vem do cliente além de `operation_id` e `motivo` (o schema da rota
 * recusa qualquer outro campo: delta, saldo, cliente_id, empresa_id...).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirAdminTenant, atorDoTenant, ehAdminTenantAtivo } from '../../shared/auth/exigirAdminTenant.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { ehMovimentoDoLedger } from '../rebanhoLedger/rebanhoLedgerService.js';
import { excluirMovimentoDoLedger } from '../rebanhoLedger/rebanhoLedgerExclusao.js';
import { SITUACAO_CANCELADO } from './movimentacaoMapaCancelamentoService.js';

export const TIPO_OPERACAO_EXCLUSAO = 'exclusao_movimentacao_mapa';
export const ACAO_AUDITORIA_EXCLUSAO = 'exclusao_definitiva';

const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const buscarMovimento = async (tx, clienteId, id, travar) => {
  if (travar) await tx.$queryRaw`SELECT id FROM "MovimentacaoMapa" WHERE cliente_id = ${clienteId} AND id = ${id} FOR UPDATE`;
  return tx.movimentacaoMapa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
};

/** Movimento ausente: já excluído por este caminho (auditoria) → 409; senão 404. */
const recusarAusente = async (tx, clienteId, id) => {
  const excluida = await tx.auditLog.findFirst({ where: { cliente_id: clienteId, entidade: 'MovimentacaoMapa', entidade_id: id, acao: ACAO_AUDITORIA_EXCLUSAO }, select: { id: true } });
  if (excluida) throw recusa('EXCLUSAO_JA_REALIZADA', 'esta movimentação já foi excluída', { movimentacao_id: id });
  throw new AppError('MOVIMENTACAOMAPA_NOT_FOUND', 'MovimentacaoMapa não encontrado');
};

/** Recusas de estado que valem para o comando e para a elegibilidade. */
const exigirExcluivel = (mov) => {
  if (!ehMovimentoDoLedger(mov)) {
    throw recusa('EXCLUSAO_MOVIMENTO_LEGADO', 'movimento sem evento certificado do ledger não é excluído; o histórico antigo fica como está', { movimentacao_id: mov.id });
  }
  if (mov.dados?.situacao === SITUACAO_CANCELADO) {
    throw recusa('EXCLUSAO_MOVIMENTO_CANCELADO', 'movimento já cancelado pelo mecanismo anterior não é apagado retroativamente', { movimentacao_id: mov.id });
  }
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {string} id
 * @param {{operation_id: string, motivo: string}} entrada
 */
export const excluir = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const operationKey = texto(entrada?.operation_id);
  const motivo = texto(entrada?.motivo);
  if (!operationKey || !motivo) throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id e motivo são obrigatórios');
  const fingerprint = fingerprintDePayload({ acao: TIPO_OPERACAO_EXCLUSAO, movimentacao_id: id, motivo });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) => {
    await exigirAdminTenant(contexto, tx);
    return executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_OPERACAO_EXCLUSAO,
      fingerprint,
      executar: async () => {
        const mov = await buscarMovimento(tx, auth.clienteId, id, true);
        if (!mov) await recusarAusente(tx, auth.clienteId, id);
        exigirExcluivel(mov);
        const r = await excluirMovimentoDoLedger(tx, contexto, mov, motivo, operationKey);
        return {
          httpStatus: 200,
          body: { excluida: true, movimentacao_id: id, tipo: mov.dados?.tipo ?? null, evento_tipo: r.evento_tipo, efeitos: r.efeitos, posicoes_removidas: r.posicoes_removidas },
        };
      },
    });
  }, { timeout: 30000 });
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};

/**
 * Elegibilidade — só informativa: ensaia o MESMO motor dentro de SAVEPOINT e
 * desfaz. O POST revalida tudo dentro da própria transação, sob trava.
 * Outro tenant ou id inexistente: 404.
 */
export const elegibilidadeExclusao = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const ator = await atorDoTenant(contexto, tx);
    const podeExcluir = ehAdminTenantAtivo(ator);
    const mov = await buscarMovimento(tx, auth.clienteId, id, false);
    if (!mov) throw new AppError('MOVIMENTACAOMAPA_NOT_FOUND', 'MovimentacaoMapa não encontrado');
    const comum = { requer_administrador: true, pode_excluir: podeExcluir, modo: 'exclusao_definitiva', tipo: mov.dados?.tipo ?? null, data_movimentacao: mov.dados?.data_movimentacao ?? null };
    const recusado = (erro) => ({ ...comum, elegivel: false, codigo: erro.code, motivo: erro.message, detalhes: erro.details ?? null, efeitos: [], posicoes_removidas: [] });
    await tx.$executeRawUnsafe('SAVEPOINT elegibilidade_exclusao');
    try {
      exigirExcluivel(mov);
      const r = await excluirMovimentoDoLedger(tx, contexto, mov, 'ensaio', 'ensaio');
      return { ...comum, elegivel: true, codigo: null, motivo: null, detalhes: null, evento_tipo: r.evento_tipo, efeitos: r.efeitos, posicoes_removidas: r.posicoes_removidas };
    } catch (erro) {
      if (erro instanceof AppError) return recusado(erro);
      throw erro;
    } finally {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT elegibilidade_exclusao');
    }
  }, { timeout: 30000 });
};
