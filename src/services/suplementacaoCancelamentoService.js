/**
 * Cancelamento do lançamento de cocho — D-PROD-268 (na tela: "Excluir lançamento").
 *
 * O cancelamento é UM comando do servidor (estorno exato da baixa do depósito pelo motor,
 * rateio cancelado, período anterior reaberto quando provado), numa transação idempotente por
 * `operation_id`. Aqui só há o transporte: nada é desfeito no navegador. Só online: offline
 * recusa ANTES de qualquer I/O (nunca vai para a fila offline).
 *
 * A reversão antiga pelo navegador (`suplementacaoHistoricoService`) continua fail-closed.
 */
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { cancelarLancamentoCochoNativo, elegibilidadeCancelamentoCochoNativo } from '@/apis/suplementacao-eventos';
import { enviarOuGuardar, registrarTipoDeEnvio } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_CANCELAMENTO_LANCAMENTO_COCHO } from '@/lib/offline/sincronizacao/tiposDeEnvio';
import { getMapaCachedData, updateMapaCachedData } from '@/services/mapaCacheService';
import { semLancamentosCanceladosAguardando } from '@/services/cancelamentosAguardandoService';

/** @param {string} operation */
const exigirConexao = (operation) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      operation,
      resource: 'SuplementacaoCancelamento',
      details: { motivo: 'offline_comando_composto', mensagem: 'A exclusão do lançamento só é feita com conexão.' },
    });
  }
};

/**
 * Elegibilidade do cancelamento (ensaio no servidor; nada é gravado). Informativa: o POST revalida.
 * @param {{ evento: { id: string, empresa_id: string }, signal?: AbortSignal }} p
 */
export const consultarElegibilidadeCancelamentoCocho = async ({ evento, signal }) => {
  exigirConexao('consultarElegibilidadeCancelamentoCocho');
  return elegibilidadeCancelamentoCochoNativo(evento.id, evento.empresa_id, signal ? { signal } : {});
};

/**
 * Cancela o lançamento. `operationId` é gerado ao abrir o diálogo e reusado no "tentar de novo":
 * repetir com a mesma chave nunca estorna duas vezes.
 * @param {{ evento: { id: string, empresa_id: string }, motivo: string, operationId: string }} p
 */
export const cancelarLancamentoCocho = async ({ evento, motivo, operationId }) => {
  exigirConexao('cancelarLancamentoCocho');
  return cancelarLancamentoCochoNativo(evento.id, { empresa_id: evento.empresa_id, operation_id: operationId, motivo: String(motivo ?? '').trim() });
};

// ── D-PROD-297: excluir sem internet o lançamento que já está no servidor ──

/**
 * O cancelamento do lançamento pelo motor de sincronização: sem internet fica no
 * aparelho e sobe depois, com o código único (o servidor deduplica e estorna
 * exatamente). "Já excluído" no servidor conta como feito.
 */
registrarTipoDeEnvio({
  tipo: TIPO_CANCELAMENTO_LANCAMENTO_COCHO,
  versao: 1,
  offline: true,
  recursos: (p) => [`cocho:${p?.ponto_suplementacao_id ?? ''}`, ...(p?.estorno?.local_id ? [`estoque:${p.estorno.local_id}`] : [])],
  rotulo: (p) => `Excluir lançamento · ${p?.ponto_nome ?? 'cocho'}`,
  atualiza: ['eventosSuplementacao', 'suplementacaoLote', 'movimentacaoEstoque', 'estoqueLotes'],
  enviar: async (p, { operationId }) => {
    try {
      return await cancelarLancamentoCochoNativo(p.evento_id, { empresa_id: p.empresa_id, operation_id: operationId, motivo: p.motivo });
    } catch (erro) {
      const codigo = /** @type {any} */ (erro)?.cause?.code;
      if (codigo === 'CANCELAMENTO_JA_REALIZADO' || codigo === 'SUPLEMENTACAOEVENTO_NOT_FOUND') return { committed: true, ja_excluido: true };
      throw erro;
    }
  },
});

/**
 * Exclui (cancela) sem internet o lançamento que já está no servidor: fica no
 * aparelho e sobe quando a internet voltar. O cocho já mostra o lançamento fora
 * e o depósito já mostra o produto de volta.
 * @param {{ evento: any, motivo: string, operationId: string }} p
 */
export const cancelarLancamentoCochoSemInternet = async ({ evento, motivo, operationId }) => {
  let estorno = null;
  try {
    const movimentos = await getMapaCachedData('movimentacaoEstoque', evento.empresa_id);
    const mov = (Array.isArray(movimentos) ? movimentos : []).find((m) => m?.id && m.id === evento.movimentacao_estoque_id);
    if (mov) estorno = { produto_id: mov.produto_id, local_id: mov.local_estoque_origem, quantidade: Number(mov.quantidade) || 0, data: mov.data_movimentacao ?? null };
  } catch {
    // sem a cópia do movimento, o saldo só volta quando o cancelamento subir
  }
  const r = await enviarOuGuardar(
    TIPO_CANCELAMENTO_LANCAMENTO_COCHO,
    {
      evento_id: evento.id,
      empresa_id: evento.empresa_id,
      ponto_suplementacao_id: evento.ponto_suplementacao_id ?? null,
      ponto_nome: evento.ponto_nome ?? null,
      motivo: String(motivo ?? '').trim(),
      estorno,
    },
    { empresaId: evento.empresa_id, operationId }
  );
  if (r.estado === 'aguardando') {
    // A cópia do aparelho já mostra o lançamento fora e o período anterior aberto de novo.
    try {
      const atuais = await getMapaCachedData('eventosSuplementacao', evento.empresa_id);
      await updateMapaCachedData('eventosSuplementacao', evento.empresa_id, await semLancamentosCanceladosAguardando(atuais));
    } catch {
      // só visão
    }
  }
  return r;
};
