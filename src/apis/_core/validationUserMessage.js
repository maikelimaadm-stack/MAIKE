/**
 * Mensagens de validação em português de produto — só field/reason allowlisted.
 */

const ROTULO_CAMPO = Object.freeze({
  empresa_id: 'empresa',
  titulo: 'título',
  tipo: 'tipo',
  tipo_tarefa_id: 'tipo de tarefa',
  prioridade: 'prioridade',
  status: 'status',
  limit: 'limite de registros',
  query: 'filtros da consulta',
  data_pedido: 'data',
  data_evento: 'data do evento',
  lote_id: 'lote',
  area_id: 'área',
});

const MENSAGEM_POR_RAZAO = Object.freeze({
  required: 'é obrigatório',
  type: 'tem formato inválido',
  enum: 'não é um valor permitido',
  format: 'tem formato inválido',
  range: 'está fora do intervalo permitido',
  unknown_field: 'contém parâmetro não reconhecido',
  invalid_query: 'contém filtros inválidos',
  min_length: 'é muito curto',
  max_length: 'é muito longo',
  pattern: 'tem formato inválido',
  other: 'não passou na validação',
});

/**
 * @param {{ field?: string, reason?: string } | null | undefined} detalhes
 * @returns {string | null}
 */
export const mensagemValidacaoSegura = (detalhes) => {
  if (!detalhes || typeof detalhes !== 'object') return null;
  const field = typeof detalhes.field === 'string' ? detalhes.field : null;
  const reason = typeof detalhes.reason === 'string' ? detalhes.reason : null;
  if (!field || !reason) return null;
  if (!Object.prototype.hasOwnProperty.call(MENSAGEM_POR_RAZAO, reason)) return null;
  const rotulo = ROTULO_CAMPO[field] ?? field.replace(/_/g, ' ');
  return `Verifique o campo «${rotulo}»: ${MENSAGEM_POR_RAZAO[reason]}.`;
};
