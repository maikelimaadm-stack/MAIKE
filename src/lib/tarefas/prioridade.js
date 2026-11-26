/** Prioridades canônicas. "Normal" continua aceito como alias do cadastro antigo. */
export const PRIORIDADES_TAREFA = Object.freeze(['Baixa', 'Média', 'Alta', 'Urgente']);
export const CORES_PRIORIDADE_TAREFA = Object.freeze({
  Baixa: '#94a3b8', Média: '#3b82f6', Alta: '#f59e0b', Urgente: '#ef4444',
});

/** @param {unknown} value */
export function normalizarPrioridadeTarefa(value) {
  const texto = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (['urgente', 'critico', 'critica'].includes(texto)) return 'Urgente';
  if (['alta', 'alto'].includes(texto)) return 'Alta';
  if (['media', 'medio', 'normal'].includes(texto)) return 'Média';
  return 'Baixa';
}
