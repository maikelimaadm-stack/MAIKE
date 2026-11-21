/**
 * Comando transacional: evento de suplementação + lotes rateados (ESTAB-P0-01).
 *
 * D-PROD-268 — endurecido para o cancelamento do lançamento: transação curta com a trava do
 * cocho ANTES de inserir (serializa com o cancelamento e o PATCH de fechamento); campos
 * reservados no evento ou nos lotes → 400 `CAMPO_RESERVADO_CANCELAMENTO`; `evento_anterior_id`
 * (opcional, para não quebrar abas antigas) tem de ser o último lançamento ATIVO do cocho (ou
 * null sem nenhum) — senão 409 `LANCAMENTO_DESATUALIZADO`. Qualquer erro desfaz a transação
 * inteira, inclusive a reserva do recibo: o reenvio com a MESMA chave e o payload novo é aceito.
 *
 * Replay de um lançamento JÁ CANCELADO (a resposta se perdeu, outra tela cancelou, a aba reenvia a
 * mesma chave): o recibo continua 'committed' (reconciliação e bloqueio da exclusão da compra o
 * leem), mas devolver 201 com o retrato antigo diria ao operador que o trato está registrado e
 * baixado — o estoque já voltou. Recusa 409 `SUPLEMENTACAO_REGISTRO_CANCELADO` com
 * `details.evento_id`; nada é gravado (o mesmo precedente de IDEMPOTENCY_EFEITO_EXCLUIDO).
 */
import { exigirLotesDosDocumentos } from '../../shared/lotes/loteVivo.js';
import { TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { documentoCancelado, rejeitarReservadosDaSuplementacao, textoOuNulo, travarCocho, ultimoEventoAtivoDoCocho } from './suplementacaoCocho.js';
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

  rejeitarReservadosDaSuplementacao(evento);
  for (const lote of lotes) rejeitarReservadosDaSuplementacao(lote);
  const conferirAnterior = Object.prototype.hasOwnProperty.call(entrada, 'evento_anterior_id');
  const anteriorInformado = conferirAnterior ? textoOuNulo(entrada.evento_anterior_id) : null;

  // Fingerprint inalterado (evento + lotes): os recibos antigos continuam dando replay.
  const fingerprint = fingerprintDePayload({ evento, lotes });

  const resultado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const idem = await executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO,
      fingerprint,
      executar: async () => {
        const empresaId = String(evento.empresa_id || '').trim();
        const empresa = await buscarEmpresa(auth.clienteId, empresaId, tx);
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'Empresa não encontrada neste tenant');

        const ponto = textoOuNulo(evento.ponto_suplementacao_id);
        if (ponto) {
          await travarCocho(tx, auth.clienteId, empresaId, ponto);
          if (conferirAnterior) {
            const ultimo = await ultimoEventoAtivoDoCocho(tx, auth.clienteId, empresaId, ponto);
            if ((ultimo?.id ?? null) !== anteriorInformado) {
              throw new AppError('LANCAMENTO_DESATUALIZADO', 'o cocho mudou: um lançamento foi cancelado ou registrado em outra tela; recarregue; nada foi gravado', {
                details: { field: 'evento_anterior_id', evento_anterior_id: ultimo?.id ?? null, informado: anteriorInformado },
              });
            }
          }
        }

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
          // Lote excluído do cadastro não recebe rateio novo (MAIKE-LOTES-R1).
          await exigirLotesDosDocumentos(tx, auth.clienteId, linhas.map((l) => l.dados));
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
    if (idem.replay) {
      const eventoId = textoOuNulo(/** @type {any} */ (idem.body)?.evento?.id);
      const atual = eventoId
        ? await tx.suplementacaoEvento.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: eventoId } }, select: { dados: true } })
        : null;
      if (atual && documentoCancelado(atual.dados)) {
        throw new AppError('SUPLEMENTACAO_REGISTRO_CANCELADO', 'este lançamento foi gravado e depois cancelado em outra tela; o estoque já voltou ao depósito; nada foi gravado agora', {
          details: { field: 'operation_id', reason: 'lancamento_cancelado', evento_id: eventoId, operation_id: operationKey },
        });
      }
    }
    return idem;
  });

  if (resultado.replay) return { ...resultado.body, replay: true };
  return resultado.body;
};
