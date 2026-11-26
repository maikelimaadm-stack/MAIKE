import { montarPontoRedondo, ENCAIXE_FIGURA } from "./pontos/redondo";
import { CORES_PRIORIDADE_TAREFA, normalizarPrioridadeTarefa } from '../../lib/tarefas/prioridade.js';

/** Mesmo fundo original do cocho/depósito, com o símbolo colorido da prioridade. @param {unknown} prioridade */
export function svgIconeTarefa(prioridade) {
  const nivel = normalizarPrioridadeTarefa(prioridade);
  const cor = CORES_PRIORIDADE_TAREFA[nivel];
  const linhas = { Baixa: [46], Média: [35, 58], Alta: [25, 46, 67], Urgente: [] }[nivel];
  const simbolo = nivel === 'Urgente'
    ? `<path d="M48 27V51" stroke="${cor}" stroke-width="9" stroke-linecap="round"/><circle cx="48" cy="67" r="4.8" fill="${cor}"/>`
    : linhas.map((y) => `<path d="M30 ${y + 8}L48 ${y - 8}L66 ${y + 8}" fill="none" stroke="${cor}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  // Símbolo mais alto que o desenho do cocho: mantém o centro da mesma moldura.
  return montarPontoRedondo(simbolo, "18 8 60 76", {
    ...ENCAIXE_FIGURA,
    y: ENCAIXE_FIGURA.y - 8.5,
    height: 64,
  });
}

// Só quatro URLs em memória, independentemente da quantidade de tarefas/dias no mapa.
const urls = new Map();
/** @param {unknown} prioridade @returns {string} */
export function urlIconeTarefa(prioridade) {
  const nivel = normalizarPrioridadeTarefa(prioridade);
  if (!urls.has(nivel)) urls.set(nivel, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgIconeTarefa(nivel))}`);
  return urls.get(nivel);
}
