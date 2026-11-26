import { diasEntre, hojeNoFuso } from '../diaCivil.js';
import { urlIconeTarefa } from '../../assets/icones/tarefas.js';
import { normalizarPrioridadeTarefa } from './prioridade.js';

/** Dias são civis, no mesmo "hoje" da fazenda usado pelo mapa (inclusive na virada do dia).
 * @param {{ status?: string, data_prevista?: string | null }} tarefa @param {string | null} [hoje]
 */
export function indicadorTarefa(tarefa, hoje = hojeNoFuso(null)) {
  const status = tarefa.status || 'Pendente';
  if (status === 'Concluída') return { texto: '✓', cor: '#16a34a', descricao: 'Concluída' };
  if (status === 'Cancelada') return { texto: '×', cor: '#64748b', descricao: 'Cancelada' };
  const prazo = String(tarefa.data_prevista || '').slice(0, 10);
  const dias = diasEntre(hoje || '', prazo);
  const andamento = status === 'Em Andamento';
  const situacao = andamento ? 'Em andamento' : 'Pendente';
  const cor = dias !== null && dias < 0 ? '#ef4444' : andamento ? '#0ea5e9' : '#64748b';
  const texto = dias === null ? (andamento ? '▶' : '…') : Math.abs(dias) > 99 ? '99+' : `${Math.abs(dias)}d`;
  const descricaoPrazo = dias === null ? 'sem prazo definido' : dias < 0 ? `${Math.abs(dias)} dia(s) de atraso` : dias === 0 ? 'vence hoje' : `faltam ${dias} dia(s)`;
  return { texto, cor, descricao: `${situacao}, ${descricaoPrazo}` };
}

/** Complemento DOM: não grava status, não depende da rede e não altera o ícone cadastrado.
 * @param {HTMLElement} el
 * @param {{ titulo?: string, prioridade?: string, status?: string, data_prevista?: string | null }} tarefa
 * @param {string | null} [hoje]
 */
export function aplicarIndicadorTarefa(el, tarefa, hoje) {
  const indicador = indicadorTarefa(tarefa, hoje);
  let selo = el.querySelector('[data-indicador-tarefa]');
  if (!selo) {
    selo = document.createElement('span');
    selo.setAttribute('data-indicador-tarefa', '');
    el.appendChild(selo);
  }
  const badge = /** @type {HTMLElement} */ (selo);
  badge.textContent = indicador.texto;
  badge.setAttribute('aria-hidden', 'true');
  badge.style.cssText = `position:absolute;right:-7px;bottom:4px;min-width:22px;height:22px;padding:0 2px;box-sizing:border-box;border-radius:999px;border:2px solid #fff;background:${indicador.cor};color:#fff;display:flex;align-items:center;justify-content:center;font:700 10px/1 Arial,sans-serif;pointer-events:none;`;
  const descricao = `${tarefa.titulo || 'Tarefa'} — prioridade ${normalizarPrioridadeTarefa(tarefa.prioridade)} — ${indicador.descricao}`;
  el.title = descricao;
  el.setAttribute('aria-label', descricao);
  // URL enviada pelo usuário continua valendo; falha de download usa o modelo local.
  const img = el.querySelector('img');
  if (img) img.onerror = () => {
    img.onerror = null;
    img.src = urlIconeTarefa(tarefa.prioridade);
  };
}
