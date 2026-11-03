/**
 * Comando atômico de JUNÇÃO DE LOTES — R2C-P1 (D-PROD-104) → PR174-R5.
 *
 * UMA transação PostgreSQL:
 *   1. valida a forma (`lerEntradaJuncao`: principal, origens distintas, data);
 *   2. idempotência `manejo_mapa_juncao_lotes` + fingerprint do conteúdo canônico;
 *   3. empresa do tenant, que precisa estar no ledger de posições
 *      (`exigirEmpresaNoLedger`; sem cutover → 409 `REBANHO_CUTOVER_PENDENTE`);
 *   4. a junção é do ledger (`juncaoNoLedger`): POSIÇÕES com composição de
 *      linhagens. `Lote` é só o cadastro de entrada e nunca recebe efeito de
 *      manejo (PR174-R5).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { exigirEmpresaNoLedger, juncaoNoLedger } from '../rebanhoLedger/rebanhoLedgerManejos.js';
import { dataOperacionalValida, SEXOS } from './manejoRebanhoComandoService.js';
import { COMANDO_JUNCAO, MAX_ORIGENS_JUNCAO, TIPO_OPERACAO_JUNCAO } from './juncaoConstantes.js';

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });

/** Forma canônica (também é a base do fingerprint). */
export const lerEntradaJuncao = (entrada) => {
  const operationKey = texto(entrada?.operation_id);
  const empresaId = texto(entrada?.empresa_id);
  const areaId = texto(entrada?.area_id);
  const principalId = texto(entrada?.lote_principal_id);
  const dataMovimentacao = texto(entrada?.data_movimentacao);
  if (!operationKey || !empresaId || !areaId || !principalId || !dataMovimentacao) {
    throw invalido('operation_id, empresa_id, area_id, lote_principal_id e data_movimentacao são obrigatórios');
  }
  if (!dataOperacionalValida(dataMovimentacao)) throw invalido('data_movimentacao inválida', { field: 'data_movimentacao' });
  const brutos = entrada?.lote_origem_ids;
  if (!Array.isArray(brutos) || brutos.length < 1 || brutos.length > MAX_ORIGENS_JUNCAO) {
    throw invalido(`lote_origem_ids deve ter de 1 a ${MAX_ORIGENS_JUNCAO} lotes`, { field: 'lote_origem_ids' });
  }
  const origens = brutos.map(texto);
  if (origens.some((id) => !id)) throw invalido('lote_origem_ids com id vazio', { field: 'lote_origem_ids' });
  if (new Set(origens).size !== origens.length) throw invalido('lote repetido em lote_origem_ids', { field: 'lote_origem_ids' });
  if (origens.includes(principalId)) throw invalido('o lote principal não pode ser também origem', { field: 'lote_origem_ids' });
  const observacoes = typeof entrada?.observacoes === 'string' ? entrada.observacoes.trim() || null : null;
  return { operationKey, empresaId, areaId, principalId, origens, dataMovimentacao, observacoes };
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const executarJuncaoLotes = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntradaJuncao(entrada);
  const fingerprint = fingerprintDePayload({ comando: COMANDO_JUNCAO, ...e, operationKey: undefined });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_JUNCAO,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
        // R2E-R1 (D-PROD-107): junção de POSIÇÕES com composição de linhagens (nunca Lote).
        await exigirEmpresaNoLedger(tx, auth.clienteId, e.empresaId); // PR174-R5: sem modelo legado
        return juncaoNoLedger(tx, contexto, e, { SEXOS });
      },
    })
  );
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};
