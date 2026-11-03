/**
 * Comando atômico de manejo do mapa — R2A-R1 (D-PROD-99a) → PR174-R5.
 *
 * Morte, Abate e Transferência de Área numa transação PostgreSQL:
 *   1. valida a forma da entrada (nada de saldo vindo do navegador);
 *   2. idempotência por (cliente, operation_id, `manejo_mapa_lote`) + fingerprint;
 *   3. empresa do tenant, que precisa estar no ledger de posições
 *      (`exigirEmpresaNoLedger`; sem cutover → 409 `REBANHO_CUTOVER_PENDENTE`);
 *   4. o efeito é do ledger (`manejoLoteNoLedger`): posições, partidas e o
 *      movimento do histórico. `Lote` é só o cadastro de entrada e nunca recebe
 *      efeito de manejo — não há mais modelo legado (PR174-R5).
 *
 * `efeito_servidor`, `modo_transferencia` e `lote_destino_id` são campos
 * reservados: POST/bulk/PATCH genéricos os recusam.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { exigirEmpresaNoLedger, manejoLoteNoLedger } from '../rebanhoLedger/rebanhoLedgerManejos.js';
import { CATEGORIAS_OFICIAIS, dataOperacionalValida } from './manejoRebanhoComandoService.js';
import { distribuirBaixa } from './manejoBaixaComandoService.js';
import { POLITICA_ALOCACAO } from './baixaConstantes.js';

export const TIPO_OPERACAO_MANEJO = 'manejo_mapa_lote';
export const COMANDO_MANEJO = 'manejo_mapa_lote';
export const TIPOS_DO_COMANDO = Object.freeze(['Morte', 'Abate', 'Transferência de Área']);

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Valida a forma; tudo que importa para saldo é relido do servidor. */
const lerEntrada = (entrada) => {
  const tipo = texto(entrada?.tipo);
  if (!TIPOS_DO_COMANDO.includes(tipo)) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'tipo de manejo não suportado pelo comando', { details: { field: 'tipo' } });
  }
  const q = Number(entrada?.quantidade_animais);
  if (!Number.isInteger(q) || q <= 0) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'quantidade_animais deve ser inteiro positivo', { details: { field: 'quantidade_animais' } });
  }
  return {
    operationKey: texto(entrada?.operation_id),
    tipo,
    empresaId: texto(entrada?.empresa_id),
    loteId: texto(entrada?.lote_id),
    quantidade: q,
    dataMovimentacao: texto(entrada?.data_movimentacao),
    areaDestinoId: texto(entrada?.area_destino_id),
    loteDestinoId: texto(entrada?.lote_destino_id),
    observacoes: typeof entrada?.observacoes === 'string' ? entrada.observacoes : null,
    categoriaAnimal: texto(entrada?.categoria_animal),
    usuarioResponsavel: texto(entrada?.usuario_responsavel),
  };
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const executarManejoLote = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntrada(entrada);
  if (!e.operationKey || !e.empresaId || !e.loteId || !e.dataMovimentacao) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id, empresa_id, lote_id e data_movimentacao são obrigatórios');
  }
  if (!dataOperacionalValida(e.dataMovimentacao)) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'data_movimentacao inválida', { details: { field: 'data_movimentacao' } });
  }
  const ehTransferencia = e.tipo === 'Transferência de Área';
  if (ehTransferencia && !e.areaDestinoId) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'transferência exige area_destino_id', { details: { field: 'area_destino_id' } });
  }
  const fingerprint = fingerprintDePayload({ ...e, operationKey: undefined });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_MANEJO,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
        // R2E-R1 (D-PROD-107): empresa no ledger → o mesmo comando opera POSIÇÕES (nunca Lote).
        await exigirEmpresaNoLedger(tx, auth.clienteId, e.empresaId); // PR174-R5: sem modelo legado
        return manejoLoteNoLedger(tx, contexto, e, { CATEGORIAS_OFICIAIS, distribuirBaixa, POLITICA_ALOCACAO });
      },
    })
  );
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};
