import { describe, it, expect } from 'vitest';
import { normalizarPrioridadeTarefa } from '@/lib/tarefas/prioridade';
import { indicadorTarefa, aplicarIndicadorTarefa } from '@/lib/tarefas/marcador';
import { resolverIconeTarefa } from '@/lib/maplibre/mapaGeralRender';
import { urlIconeTarefa } from '@/assets/icones/tarefas';

const HOJE = '2026-11-26';
describe('Marcadores de tarefas: prioridade independente do prazo/status', () => {
  it('preserva Urgente e aceita Normal legado como Média', () => {
    expect(normalizarPrioridadeTarefa('URGENTE')).toBe('Urgente');
    expect(normalizarPrioridadeTarefa('Crítica')).toBe('Urgente');
    expect(normalizarPrioridadeTarefa('Alta')).toBe('Alta');
    expect(normalizarPrioridadeTarefa('Normal')).toBe('Média');
    expect(normalizarPrioridadeTarefa('MÉDIA')).toBe('Média');
  });
  it('fornece quatro SVGs locais, sem rede, mantendo o upload da empresa', () => {
    const urls = ['Baixa', 'Média', 'Alta', 'Urgente'].map((prioridade) => resolverIconeTarefa({ prioridade }).iconUrl);
    expect(new Set(urls).size).toBe(4);
    urls.forEach((url) => expect(url.startsWith('data:image/svg+xml;')).toBe(true));
    expect(resolverIconeTarefa({ prioridade: 'Média' }, [{ tipo_entidade: 'Prioridade Tarefa', categoria: 'NORMAL', icone_url: '/minha-media.svg' }]).iconUrl).toBe('/minha-media.svg');
  });
  it('conta dias civis e considera atraso somente depois do dia previsto', () => {
    expect(indicadorTarefa({ status: 'Pendente', data_prevista: '2026-11-29' }, HOJE)).toMatchObject({ texto: '3d', cor: '#64748b' });
    expect(indicadorTarefa({ status: 'Em Andamento', data_prevista: '2026-11-26' }, HOJE)).toMatchObject({ texto: '0d', cor: '#0ea5e9', descricao: 'Em andamento, vence hoje' });
    expect(indicadorTarefa({ status: 'Em Andamento', data_prevista: '2026-11-23' }, HOJE)).toMatchObject({ texto: '3d', cor: '#ef4444', descricao: 'Em andamento, 3 dia(s) de atraso' });
    expect(indicadorTarefa({ data_prevista: '2027-01-01' }, '2026-12-31').texto).toBe('1d');
  });
  it('não inventa prazo e não marca tarefa encerrada como atrasada', () => {
    expect(indicadorTarefa({}, HOJE).descricao).toBe('Pendente, sem prazo definido');
    expect(indicadorTarefa({ status: 'Em Andamento' }, HOJE).texto).toBe('▶');
    expect(indicadorTarefa({ data_prevista: '2026-02-30' }, HOJE).texto).toBe('…');
    expect(indicadorTarefa({ status: 'Concluída', data_prevista: '2000-01-01' }, HOJE)).toMatchObject({ texto: '✓', cor: '#16a34a' });
    expect(indicadorTarefa({ status: 'Cancelada', data_prevista: '2000-01-01' }, HOJE).texto).toBe('×');
    expect(indicadorTarefa({ data_prevista: '2025-01-01' }, HOJE).texto).toBe('99+');
  });
  it('atualiza o selo sem duplicar e descreve prazo, andamento e prioridade ao toque/leitor', () => {
    const el = document.createElement('div');
    const img = document.createElement('img'); img.src = '/upload-indisponivel.svg'; el.append(img);
    const t = { titulo: 'Revisar cerca', prioridade: 'Urgente', status: 'Pendente', data_prevista: '2026-11-29' };
    aplicarIndicadorTarefa(el, t, HOJE);
    expect(el.querySelector('[data-indicador-tarefa]').textContent).toBe('3d');
    aplicarIndicadorTarefa(el, { ...t, status: 'Em Andamento' }, '2026-11-30');
    expect(el.querySelectorAll('[data-indicador-tarefa]')).toHaveLength(1);
    expect(el.querySelectorAll('[data-status-tarefa]')).toHaveLength(1);
    expect(el.querySelector('[data-status-tarefa]').style.background).toBe('rgb(239, 68, 68)');
    expect(el.querySelector('[data-indicador-tarefa]').style.background).toBe('rgb(107, 114, 128)');
    expect(el.getAttribute('aria-label')).toContain('Urgente — Em andamento, 1 dia(s) de atraso');
    img.dispatchEvent(new Event('error'));
    expect(img.src).toBe(urlIconeTarefa('Urgente'));
    expect(img.onerror).toBe(null);
  });
});
