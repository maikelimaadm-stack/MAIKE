/**
 * G3 — id 13/73: editar o traçado de uma linha recalcula comprimento_metros.
 * G3 — id 72 (parte do seletor): o seletor de local da tarefa lê os ícones de
 * prioridade da configuração do tenant (gravados sem empresa), não por empresa.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { comprimentoMetros } from '@/lib/geografia';

const svc = vi.hoisted(() => ({
  atualizarLinha: vi.fn(async (id, dados) => ({ id, ...dados })),
  criarLinha: vi.fn(async (d) => d),
  listarTodasLinhas: vi.fn(async () => []),
  listarIconesPorTipo: vi.fn(async () => []),
  listarIconesDaEmpresa: vi.fn(async () => []),
  listarTarefasDaEmpresa: vi.fn(async () => []),
}));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaService', () => ({
  atualizarLinha: svc.atualizarLinha,
  criarLinha: svc.criarLinha,
  listarTodasLinhas: svc.listarTodasLinhas,
}));
vi.mock('@/services/tarefasMapaService', () => ({
  listarIconesPorTipo: svc.listarIconesPorTipo,
  listarIconesDaEmpresa: svc.listarIconesDaEmpresa,
  listarTarefasDaEmpresa: svc.listarTarefasDaEmpresa,
}));
vi.mock('@/lib/maplibre/lifecycle.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createEditorMap: () => { throw new Error('sem webgl no teste'); },
}));

const comCliente = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  cleanup();
  Object.values(svc).forEach((f) => f.mockClear());
});
afterEach(() => cleanup());

describe('FormularioLinha — edição recalcula o comprimento', () => {
  it('linha de ~500 m estendida: comprimento_metros vai com o valor do traçado novo', async () => {
    const { default: FormularioLinha } = await import('@/components/mapa/FormularioLinha');
    const antigo = [[-15, -47], [-15, -46.995]];
    const novo = [{ lat: -15, lng: -47 }, { lat: -15, lng: -46.99 }, { lat: -15.005, lng: -46.99 }];
    const item = { id: 'ln1', nome: 'CERCA SUL', tipo: 'Cerca', comprimento_metros: 500, coordenadas: { coords: antigo, cor: '#f59e0b' } };
    const { getByTestId } = comCliente(<FormularioLinha item={item} coordenadas={novo} onSave={() => {}} />);
    await act(async () => { fireEvent.submit(getByTestId('b1-form-linha')); });
    await waitFor(() => expect(svc.atualizarLinha).toHaveBeenCalled());
    const [id, dados] = svc.atualizarLinha.mock.calls[0];
    expect(id).toBe('ln1');
    expect(dados.comprimento_metros).toBeCloseTo(comprimentoMetros(novo), 3);
    expect(dados.comprimento_metros).toBeGreaterThan(1000);
  });
});

describe('TaskLocationPickerDialog — ícones de prioridade do tenant', () => {
  it('lê pelo tipo "Prioridade Tarefa", sem filtrar por empresa', async () => {
    const { default: TaskLocationPickerDialog } = await import('@/components/mapa/TaskLocationPickerDialog');
    comCliente(<TaskLocationPickerDialog open onOpenChange={() => {}} areas={[]} />);
    await waitFor(() => expect(svc.listarIconesPorTipo).toHaveBeenCalledWith('Prioridade Tarefa'));
    expect(svc.listarIconesDaEmpresa).not.toHaveBeenCalled();
  });
});
