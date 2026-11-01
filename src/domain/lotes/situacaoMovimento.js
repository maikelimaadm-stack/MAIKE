/**
 * Situação de uma movimentação do mapa (R2A, D-PROD-99).
 *
 * O cancelamento é server-side e preserva o original com
 * `situacao: 'cancelado'` + `cancelamento: {em, por_login, motivo, ...}`.
 * Quem calcula efeito atual (cache do mapa, ordem temporal do lote) ignora o
 * cancelado; quem mostra histórico ou checa referência o mantém.
 */

export const SITUACAO_CANCELADO = 'cancelado';

/** Tipos com cancelamento certificado no servidor (espelho de `TIPOS_CANCELAVEIS`). */
export const TIPOS_COM_CANCELAMENTO = Object.freeze(['Morte', 'Abate', 'Transferência de Área']);

/** @param {any} mov */
export const ehMovimentoCancelado = (mov) => mov?.situacao === SITUACAO_CANCELADO;

/** @param {any} mov */
export const ehMovimentoAtivo = (mov) => !ehMovimentoCancelado(mov);

/** O tipo é dos certificados (Morte, Abate, Transferência) e o registro está ativo? */
export const tipoCertificado = (mov) =>
  !!mov && TIPOS_COM_CANCELAMENTO.includes(mov.tipo) && !mov.motivo && ehMovimentoAtivo(mov);

/**
 * R2A-R1 (D-PROD-99a): só movimento nascido do comando atômico do servidor tem
 * proveniência causal. Registro antigo (POST + PATCH do navegador) não.
 */
export const temProvenienciaDoServidor = (mov) => {
  const ef = mov?.efeito_servidor;
  // Paridade com o servidor (R2A-R2, D-PROD-99b): cada efeito precisa da âncora de auditoria.
  return (
    ef?.comando === 'manejo_mapa_lote' &&
    Array.isArray(ef.efeitos) &&
    ef.efeitos.length > 0 &&
    ef.efeitos.every((x) => typeof x?.auditoria_id === 'string' && x.auditoria_id !== '')
  );
};

/** Pode oferecer a ação? (a decisão final é sempre do servidor) */
export const tipoTemCancelamento = (mov) => tipoCertificado(mov) && temProvenienciaDoServidor(mov);

export const MENSAGEM_LEGADO_SEM_PROVA =
  'Registro antigo sem comprovação individual de efeito — cancelamento temporariamente indisponível';

/** Texto para quando a ação não aparece num movimento ativo. */
export const motivoSemCancelamento = (mov) => {
  if (!mov || !ehMovimentoAtivo(mov)) return null;
  if (!tipoCertificado(mov)) return 'Cancelamento não disponível para este tipo.';
  if (!temProvenienciaDoServidor(mov)) return MENSAGEM_LEGADO_SEM_PROVA;
  return null;
};
