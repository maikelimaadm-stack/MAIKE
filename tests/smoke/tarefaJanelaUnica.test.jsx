/**
 * D-PROD-325 — a tarefa abre numa janela só: o formulário (nova/editar) entra NO LUGAR da lista, dentro da janela
 * do mapa, sem um segundo diálogo por cima (a lista não aparece atrás).
 *
 * JU-01 aberto pelo mapa (direto): só o formulário, numa janela; o ✕ fecha tudo (`onClose`), com o formulário nela
 * JU-02 aberto pela lista: o ✕ volta para a lista (sem fechar a janela) e avisa a janela (`onFormularioChange(null)`)
 * JU-03 "Nova tarefa" sem o mapa (`onNovaTarefa` ausente): o formulário entra no lugar da lista e volta para ela
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/tarefasMapaService', () => ({
  listarTarefasDaEmpresa: vi.fn(async () => []),
  criarTarefa: vi.fn(),
  atualizarTarefa: vi.fn(),
  enviarAnexo: vi.fn(),
  listarTodosTipos: vi.fn(async () => []),
  listarUsuarios: vi.fn(async () => []),
  listarPermissoes: vi.fn(async () => []),
}));
vi.mock('@/services/sessionService', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u-1', nome: 'MAIKE' })) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/hooks/useSetorAreas', () => ({ default: () => ({ setores: [], areas: [], getAreasBySetor: () => [] }) }));
vi.mock('@/hooks/useFotosGuardadasDaTarefa', () => ({ default: () => [] }));
vi.mock('@/services/fotosDeTarefaAguardandoService', () => ({ guardarFotosDaTarefa: vi.fn(), excluirFotoGuardada: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const { default: TarefasMapaPanel } = await import('@/components/mapa/TarefasMapaPanel');
const { LancLoteDialogo } = await import('@/components/lotes/LancamentoLoteUi');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** A janela do mapa: guarda o formulário aberto; só leitura fora dele, como no MapaGeral. */
function Janela({ inicial = null, onClose, onFormularioChange }) {
  const [formulario, setFormulario] = React.useState(inicial);
  return (
    <LancLoteDialogo open onOpenChange={() => {}} titulo={formulario ? 'Nova tarefa' : 'Tarefas'} largo somenteLeitura={!formulario} popupDesde="tablet">
      <TarefasMapaPanel onClose={onClose} formulario={formulario} onFormularioChange={(f) => { setFormulario(f); onFormularioChange(f); }} />
    </LancLoteDialogo>
  );
}

const montar = async (inicial = null) => {
  const onClose = vi.fn();
  const onFormularioChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <Janela inicial={inicial} onClose={onClose} onFormularioChange={onFormularioChange} />
      </QueryClientProvider>
    );
  });
  return { onClose, onFormularioChange };
};

describe('D-PROD-325 — o formulário da tarefa na mesma janela', () => {
  it('JU-01 aberto pelo mapa: só o formulário numa janela; o ✕ fecha tudo', async () => {
    const { onClose, onFormularioChange } = await montar({ tarefa: null, voltarParaLista: false });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const janela = screen.getByRole('dialog', { name: 'Nova tarefa' });
    expect(within(janela).getByPlaceholderText('EX: CERCA QUEBRADA NA DIVISA')).toBeTruthy();
    expect(within(janela).queryByText('Nenhuma tarefa aberta.')).toBeNull();
    await act(async () => { fireEvent.click(within(janela).getByRole('button', { name: 'Cancelar' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    // A janela some com o formulário nela (a lista não aparece no caminho).
    expect(onFormularioChange).not.toHaveBeenCalled();
  });

  it('JU-02 aberto pela lista: o ✕ volta para a lista e avisa a janela', async () => {
    const { onClose, onFormularioChange } = await montar({ tarefa: null, voltarParaLista: true });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); });
    expect(onClose).not.toHaveBeenCalled();
    expect(onFormularioChange).toHaveBeenLastCalledWith(null);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(await screen.findByText('Nenhuma tarefa aberta.')).toBeTruthy();
  });

  it('JU-03 "Nova tarefa" sem o mapa: o formulário entra no lugar da lista e volta para ela', async () => {
    const { onClose, onFormularioChange } = await montar();
    expect(await screen.findByText('Nenhuma tarefa aberta.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' })); });
    expect(onFormularioChange).toHaveBeenLastCalledWith({ tarefa: null, voltarParaLista: true });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Nova tarefa' })).toBeTruthy();
    expect(screen.queryByText('Nenhuma tarefa aberta.')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); });
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Nenhuma tarefa aberta.')).toBeTruthy();
  });
});
