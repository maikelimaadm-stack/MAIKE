/**
 * Comando transacional: evento de suplementação + lotes rateados (ESTAB-P0-01).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { documentoComoPublico, montarDocumento } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { buscarRegistro as buscarEmpresa } from '../empresas/empresaRepository.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { inserirRegistro as inserirEvento } from './suplementacaoEventoRepository.js';
import { inserirRegistros as inserirLotesSuplementacao } from '../suplementacaoLotes/suplementacaoLoteRepository.js';

const TIPO = 'lancamento_suplementacao';

/** @param {string} operationId */
const exigirOperationId = (operationId) => {
  const chave = typeof operationId === 'string' ? operationId.trim() : '';
  if (chave.length < 8 || chave.length > 128) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id inválido', {
      details: { field: 'operation_id', reason: 'format' },
    });
  }
  return chave;
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const comandoLancamentoComLotes = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const operationKey = exigirOperationId(String(entrada.operation_id ?? ''));
  const evento = /** @type {Record<string, unknown>} */ (entrada.evento);
  const lotes = Array.isArray(entrada.lotes) ? entrada.lotes : [];

  if (!evento || typeof evento !== 'object') {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'evento é obrigatório', {
      details: { field: 'evento', reason: 'required' },
    });
  }

  const fingerprint = fingerprintDePayload({ evento, lotes });
  const prisma = getPrismaClient();

  const resultado = await prisma.$transaction(async (tx) => {
    const idem = await executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO,
      fingerprint,
      executar: async () => {
        const empresaId = String(evento.empresa_id || '').trim();
        const empresa = await buscarEmpresa(auth.clienteId, empresaId, tx);
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'Empresa não encontrada neste tenant');

        const dadosEvento = montarDocumento(auth.clienteId, evento);
        const registroEvento = await inserirEvento(tx, dadosEvento);
        const eventoPublico = documentoComoPublico(registroEvento);

        if (lotes.length) {
          const linhas = lotes.map((lote) => {
            const doc = montarDocumento(auth.clienteId, {
              ...lote,
              suplementacao_evento_id: registroEvento.id,
            });
            return doc;
          });
          await inserirLotesSuplementacao(tx, linhas);
        }

        await registrarEvento(
          contexto,
          {
            acao: 'create',
            entidade: 'SuplementacaoEvento',
            entidadeId: registroEvento.id,
            dadosNovos: eventoPublico,
          },
          tx
        );

        const body = {
          committed: true,
          operation_id: operationKey,
          replay: false,
          evento: eventoPublico,
          lotes_gravados: lotes.length,
        };
        return { httpStatus: 201, body };
      },
    });
    return idem;
  });

  if (resultado.replay) return { ...resultado.body, replay: true };
  return resultado.body;
};
