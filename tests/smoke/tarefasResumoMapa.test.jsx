/**
 * D-PROD-321 — Tarefas, parte 2: o resumo das tarefas em cartões (estilo dos detalhes do lote), no lugar da grade.
 *
 * RS-01 abertas: atrasadas primeiro, depois a prioridade e o prazo; números do topo; cartão com título, local,
 *       prazo, responsável, situação e o selo da prioridade
 * RS-02 aba Concluídas: as concluídas e as canceladas
 * RS-03 tocar numa tarefa abre os detalhes; "Nova tarefa" no rodapé
 * RS-04 sem tarefas: aviso, sem lista
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ResumoTarefasMapa from '@/components/tarefas/ResumoTarefasMapa';
import { normalizeTaskPriority } from '@/components/mapa/FormularioTarefaMapa';

afterEach(() => cleanup());

const HOJE = '2026-11-26';
const TAREFAS = [
  { id: 'b', titulo: 'Limpar bebedouro', status: 'Pendente', prioridade: 'Média', area_nome: 'PASTO 1', data_prevista: '2026-11-30', responsavel: 'PEDRO' },
  { id: 'c', titulo: 'Arrumar cerca', status: 'Pendente', prioridade: 'Alta', area_nome: 'PASTO 3', data_prevista: '2026-11-28', responsavel: 'JOÃO' },
  { id: 'a', titulo: 'Trocar bóia', status: 'Em Andamento', prioridade: 'Baixa', setor_nome: 'SETOR 1', data_prevista: '2026-11-20' },
  { id: 'r', titulo: 'Roçada', status: 'Pendente', prioridade: 'Baixa', area_nome: 'PASTO 7' },
  { id: 'f', titulo: 'Vacinar', status: 'Concluída', prioridade: 'Alta', data_conclusao: '2026-11-20' },
  { id: 'x', titulo: 'Comprar sal', status: 'Cancelada', prioridade: 'Média' },
];

const montar = (props = {}) => {
  const onAbrir = vi.fn();
  const onNova = vi.fn();
  render(<ResumoTarefasMapa tarefas={TAREFAS} hoje={HOJE} prioridadeDe={normalizeTaskPriority} onAbrir={onAbrir} onNova={onNova} {...props} />);
  return { onAbrir, onNova };
};
const itens = () => within(screen.getByRole('list')).getAllByRole('listitem');

describe('D-PROD-321 — resumo das tarefas', () => {
  it('RS-01 abertas em ordem (atrasada, prioridade, prazo) e os números do topo', () => {
    montar();
    expect(itens().map((li) => li.querySelector('.mk-dp-item__nome')?.textContent)).toEqual([
      'TROCAR BÓIA', 'ARRUMAR CERCA', 'LIMPAR BEBEDOURO', 'ROÇADA',
    ]);
    const [boia, cerca, , rocada] = itens();
    expect(boia.textContent).toContain('SETOR 1 (sem pasto) · Prazo 20/11 · Sem responsável');
    expect(boia.textContent).toContain('Em Andamento · atrasada');
    expect(cerca.textContent).toContain('PASTO 3 · Prazo 28/11 · JOÃO');
    expect(within(cerca).getByText('Alta')).toBeTruthy();
    expect(rocada.textContent).toContain('Sem prazo');
    const numeros = [...document.querySelectorAll('.mk-dp-kpi')].map((k) => k.textContent);
    expect(numeros).toEqual(['Pendentes3', 'Andamento1', 'Atrasadas1']);
    expect(screen.getByRole('tab', { name: 'Abertas (4)' })).toBeTruthy();
  });

  it('RS-02 a aba Concluídas mostra as concluídas e as canceladas', () => {
    montar();
    fireEvent.click(screen.getByRole('tab', { name: 'Concluídas (2)' }));
    expect(itens().map((li) => li.querySelector('.mk-dp-item__nome')?.textContent).sort()).toEqual(['COMPRAR SAL', 'VACINAR']);
    expect([...document.querySelectorAll('.mk-dp-kpi')].map((k) => k.textContent)).toEqual(['Concluídas1', 'Canceladas1']);
  });

  it('RS-03 tocar numa tarefa abre os detalhes; "Nova tarefa" no rodapé', () => {
    const { onAbrir, onNova } = montar();
    fireEvent.click(within(itens()[1]).getByRole('button'));
    expect(onAbrir).toHaveBeenCalledWith(TAREFAS[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }));
    expect(onNova).toHaveBeenCalledTimes(1);
  });

  it('RS-04 sem tarefas: aviso, sem lista', () => {
    montar({ tarefas: [] });
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('Nenhuma tarefa aberta.')).toBeTruthy();
  });
});
