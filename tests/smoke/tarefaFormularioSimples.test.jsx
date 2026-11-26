/**
 * D-PROD-320 — formulário da tarefa simplificado.
 *
 * TS-01 campos: Título, Setor (no lugar de "Fazenda"), Local/pasto, Tipo (opcional), Responsável, Prioridade,
 *       Prazo, Descrição/observações; saíram Grupo, Solicitante, Status, Data do pedido, Data de conclusão e
 *       Observações internas
 * TS-02 só o título salva; sem tipo escolhido, o tipo não vai (o servidor usa "SEM TIPO")
 * TS-03 sem título não salva
 * TS-04 o tipo lista todos os tipos (sem depender de grupo) e leva o grupo do próprio tipo
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/tarefasMapaService', () => ({
  listarTodosTipos: vi.fn(async () => [
    { id: 't-cerca', nome_tipo: 'CERCA', grupo_atividade_id: 'g-manut', grupo_atividade_nome: 'MANUTENÇÃO', ativo: true },
    { id: 't-agua', nome_tipo: 'ÁGUA', grupo_atividade_id: 'g-infra', grupo_atividade_nome: 'INFRA', ativo: true },
  ]),
  listarUsuarios: vi.fn(async () => []),
  listarPermissoes: vi.fn(async () => []),
}));
vi.mock('@/services/sessionService', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u-1', nome: 'MAIKE' })) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/hooks/useSetorAreas', () => ({
  default: () => ({
    setores: [{ id: 's-1', nome: 'SETOR 1' }],
    areas: [{ id: 'a-3', nome: 'PASTO 3', setor_id: 's-1', setor_nome: 'SETOR 1' }],
    getAreasBySetor: () => [{ id: 'a-3', nome: 'PASTO 3', setor_id: 's-1', setor_nome: 'SETOR 1' }],
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// O jsdom não tem `scrollIntoView` (o formulário rola até o campo que falta).
Element.prototype.scrollIntoView = vi.fn();

const { default: FormularioTarefaMapa } = await import('@/components/mapa/FormularioTarefaMapa');

afterEach(() => cleanup());

const montar = (props = {}) => {
  const onSubmit = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FormularioTarefaMapa areaId="a-3" areaNome="PASTO 3" onSubmit={onSubmit} onCancel={() => {}} {...props} />
    </QueryClientProvider>
  );
  return { onSubmit };
};


describe('D-PROD-320 — formulário da tarefa simplificado', () => {
  it('TS-01 os campos do lançamento simples', async () => {
    montar();
    for (const r of ['Título da tarefa', 'Setor', 'Local / pasto', 'Tipo de tarefa (opcional)', 'Responsável', 'Prioridade', 'Prazo previsto', 'Descrição / observações']) {
      expect(screen.getAllByText(r, { exact: false }).length, r).toBeGreaterThan(0);
    }
    for (const r of ['Fazenda', 'Grupo de atividade', 'Solicitante', 'Data do pedido', 'Data de conclusão', 'Observações internas']) {
      expect(screen.queryByText(r, { exact: false }), r).toBeNull();
    }
    expect(screen.queryByText(/^Status$/)).toBeNull();
  });

  it('TS-02 só o título salva; sem tipo, o tipo não vai', async () => {
    const { onSubmit } = montar();
    fireEvent.change(screen.getByPlaceholderText('EX: CERCA QUEBRADA NA DIVISA'), { target: { value: ' arrumar cerca ' } });
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [dados] = onSubmit.mock.calls[0];
    expect(dados.titulo).toBe('arrumar cerca');
    expect('tipo_tarefa_id' in dados).toBe(false);
    expect(dados.area_id).toBe('a-3');
    expect(dados.prioridade).toBe('Média');
  });

  it('Urgente aparece na seleção e sai do formulário sem ser reduzida a Alta', async () => {
    const { onSubmit } = montar({ tarefa: { id: 'tar-urgente', titulo: 'CERCA ROMPIDA', prioridade: 'Urgente', status: 'Pendente' } });
    fireEvent.click(screen.getByText('URGENTE'));
    expect(screen.getByRole('option', { name: 'URGENTE' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'URGENTE' }));
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].prioridade).toBe('Urgente');
  });

  it('TS-03 sem título não salva', async () => {
    const { onSubmit } = montar();
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('TS-04 editar: o tipo gravado continua indo, com o grupo do próprio tipo', async () => {
    const { onSubmit } = montar({
      tarefa: { id: 'tar-1', titulo: 'X', tipo_tarefa_id: 't-agua', tipo_tarefa_nome: 'ÁGUA', grupo_atividade_id: 'g-infra', area_id: 'a-3', area_nome: 'PASTO 3', status: 'Em Andamento' },
    });
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [dados] = onSubmit.mock.calls[0];
    expect(dados.tipo_tarefa_id).toBe('t-agua');
    expect(dados.status).toBe('Em Andamento'); // o status não muda pelo formulário
  });
});
