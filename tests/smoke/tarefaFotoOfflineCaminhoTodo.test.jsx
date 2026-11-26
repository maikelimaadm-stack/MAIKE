/**
 * D-PROD-330 — o caminho inteiro da foto SEM internet, com o armazenamento real do aparelho (IndexedDB):
 *
 * TF-OFF-01 nova tarefa: tira a foto pela câmera, salva → a foto fica guardada no celular (nada sobe); a galeria
 *           da tarefa mostra a foto "Aguardando envio", abre em tela cheia, e o ✕ a exclui (depois, tira outra)
 * TF-OFF-02 sinal fraco (o celular acha que tem internet e o envio falha sem resposta): a tarefa salva e a foto
 *           fica guardada do mesmo jeito
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const servidor = vi.hoisted(() => ({ criar: vi.fn(), enviarAnexo: vi.fn() }));
vi.mock('@/services/tarefasMapaService', () => ({
  listarTarefasDaEmpresa: vi.fn(async () => []),
  criarTarefa: (...a) => servidor.criar(...a),
  atualizarTarefa: vi.fn(),
  enviarAnexo: (...a) => servidor.enviarAnexo(...a),
  listarTodosTipos: vi.fn(async () => []),
  listarUsuarios: vi.fn(async () => []),
  listarPermissoes: vi.fn(async () => []),
  listarTodasAsTarefas: vi.fn(async () => []),
}));
vi.mock('@/services/sessionService', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u-1', nome: 'MAIKE' })) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/hooks/useSetorAreas', () => ({ default: () => ({ setores: [], areas: [], getAreasBySetor: () => [] }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/maikeConfirmar', async (orig) => ({ .../** @type {any} */ (await orig()), confirmarExclusao: vi.fn(async () => true) }));

const { default: TarefasMapaPanel } = await import('@/components/mapa/TarefasMapaPanel');
const { default: FotosTarefaGaleria } = await import('@/components/tarefas/FotosTarefaGaleria');
const { default: useFotosGuardadasDaTarefa } = await import('@/hooks/useFotosGuardadasDaTarefa');
const fotos = await import('@/services/fotosDeTarefaAguardandoService');
const idb = await import('@/components/offline/IndexedDBManager');
const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
/** Foto como a câmera entrega (o jsdom não tem `File.arrayBuffer`). */
const daCamera = () => Object.assign(new File([new Uint8Array([1, 2, 3])], 'cam.jpg', { type: 'image/jpeg' }), { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

let criar;
beforeEach(async () => {
  for (const f of await idb.getAllPendingTarefaImages()) await idb.deleteTarefaImageOffline(f._imgId);
  servidor.criar.mockReset();
  servidor.enviarAnexo.mockReset();
  servidor.criar.mockImplementation(async (d) => ({ ...d, id: 't-off', _isOffline: true }));
  criar = URL.createObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:foto');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  URL.createObjectURL = criar;
  online(true);
});

/** A tela de nova tarefa (como no mapa) e salvar com uma foto da câmera. */
const lancarComFoto = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TarefasMapaPanel formulario={{ tarefa: null, voltarParaLista: false }} onFormularioChange={() => {}} onClose={() => {}} />
    </QueryClientProvider>
  );
  fireEvent.change(screen.getByPlaceholderText('EX: CERCA QUEBRADA NA DIVISA'), { target: { value: 'Cerca' } });
  await act(async () => { fireEvent.change(screen.getByLabelText('Tirar foto com a câmera'), { target: { files: [daCamera()] } }); });
  await act(async () => { fireEvent.submit(document.querySelector('form')); });
  await waitFor(() => expect(servidor.criar).toHaveBeenCalledTimes(1));
  await waitFor(async () => expect(await fotos.fotosAguardandoDaTarefa('t-off')).toBe(1));
};

function Galeria() {
  const guardadas = useFotosGuardadasDaTarefa('t-off');
  return <FotosTarefaGaleria tarefa={{ fotos: [] }} guardadas={guardadas} onExcluirGuardada={(chave) => fotos.excluirFotoGuardada(chave)} />;
}

describe('D-PROD-330 — foto da tarefa, tudo sem internet', () => {
  it('TF-OFF-01 tira, salva, vê, abre e exclui — sem internet', async () => {
    online(false);
    await lancarComFoto();
    expect(servidor.enviarAnexo, 'nada sobe sem internet').not.toHaveBeenCalled();
    cleanup();

    render(<Galeria />);
    const guardada = await screen.findByRole('button', { name: 'Abrir foto 1 (aguardando envio)' });
    fireEvent.click(guardada);
    const tela = screen.getByRole('dialog', { name: 'Foto da tarefa' });
    expect(within(tela).getByText('Aguardando envio')).toBeTruthy();
    fireEvent.click(within(tela).getByRole('button', { name: 'Fechar foto' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir foto 1 (aguardando envio)' })); });
    await waitFor(async () => expect(await fotos.fotosAguardandoDaTarefa('t-off')).toBe(0));
  });

  it('TF-OFF-02 sinal fraco: a tarefa salva e a foto fica guardada', async () => {
    online(true);
    servidor.enviarAnexo.mockRejectedValue(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' }));
    await lancarComFoto();
    expect(servidor.enviarAnexo).toHaveBeenCalledTimes(1);
    expect(servidor.criar.mock.calls[0][0].fotos ?? []).toEqual([]);
  });
});
