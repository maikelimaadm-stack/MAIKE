import { CORES_PRIORIDADE_TAREFA, normalizarPrioridadeTarefa } from '../../lib/tarefas/prioridade.js';

/** Modelo aprovado: quadrado arredondado, ponteira e sinais de prioridade independentes. @param {unknown} prioridade */
export function svgIconeTarefa(prioridade) {
  const nivel = normalizarPrioridadeTarefa(prioridade);
  const cor = CORES_PRIORIDADE_TAREFA[nivel];
  const linhas = { Baixa: [46], Média: [35, 58], Alta: [25, 46, 67], Urgente: [] }[nivel];
  const simbolo = nivel === 'Urgente'
    ? `<path d="M48 27V51" stroke="${cor}" stroke-width="9" stroke-linecap="round"/><circle cx="48" cy="67" r="4.8" fill="${cor}"/>`
    : linhas.map((y) => `<path d="M30 ${y + 8}L48 ${y - 8}L66 ${y + 8}" fill="none" stroke="${cor}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -12 128 132" width="26" height="26"><path d="M38 87L48 103L58 87Z" fill="${cor}" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/><rect x="5" y="5" width="86" height="83" rx="16" fill="#fff" stroke="${cor}" stroke-width="5.5"/>${simbolo}</svg>`;
}

// Só quatro URLs em memória, independentemente da quantidade de tarefas/dias no mapa.
const urls = new Map();
/** @param {unknown} prioridade @returns {string} */
export function urlIconeTarefa(prioridade) {
  const nivel = normalizarPrioridadeTarefa(prioridade);
  if (!urls.has(nivel)) urls.set(nivel, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgIconeTarefa(nivel))}`);
  return urls.get(nivel);
}
