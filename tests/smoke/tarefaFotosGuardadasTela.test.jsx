/**
 * D-PROD-324 — a foto tirada sem internet aparece, abre em tela cheia e pode ser excluída (e tirada de novo).
 *
 * FG-01 galeria dos detalhes: a foto guardada aparece depois das enviadas, com "Aguardando envio"; tocar abre em
 *       tela cheia (com a legenda); o ✕ exclui
 * FG-02 formulário (editar): toda foto abre em tela cheia ao tocar; a guardada aparece com "AGUARDANDO ENVIO" e o
 *       ✕ (sempre visível) a exclui depois de confirmar; a nova continua com "NOVA"
 * FG-03 duas opções: "Tirar foto" abre a câmera do celular (`capture`) e "Galeria" escolhe as já tiradas (várias);
 *       a foto tirada entra como "NOVA"
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const excluirFotoGuardada = vi.fn(async () => undefined);
const confirmarExclusao = vi.fn(async () => true);
let guardadas = [];

vi.mock('@/services/tarefasMapaService', () => ({
  listarTodosTipos: vi.fn(async () => []),
  listarUsuarios: vi.fn(async () => []),
  listarPermissoes: vi.fn(async () => []),
}));
vi.mock('@/services/sessionService', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u-1', nome: 'MAIKE' })) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/hooks/useSetorAreas', () => ({
  default: () => ({ setores: [], areas: [], getAreasBySetor: () => [] }),
}));
vi.mock('@/hooks/useFotosGuardadasDaTarefa', () => ({ default: () => guardadas }));
vi.mock('@/services/fotosDeTarefaAguardandoService', () => ({ excluirFotoGuardada: (...a) => excluirFotoGuardada(...a) }));
vi.mock('@/lib/maikeConfirmar', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  confirmarExclusao: (...a) => confirmarExclusao(...a),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { default: FotosTarefaGaleria } = await import('@/components/tarefas/FotosTarefaGaleria');
const { default: FormularioTarefaMapa } = await import('@/components/mapa/FormularioTarefaMapa');

afterEach(() => {
  cleanup();
  guardadas = [];
  vi.clearAllMocks();
});

describe('D-PROD-324 — foto guardada na tela', () => {
  it('FG-01 galeria: aparece com "Aguardando envio", abre em tela cheia e o ✕ exclui', () => {
    const onExcluir = vi.fn();
    render(<FotosTarefaGaleria tarefa={{ fotos: ['https://arquivos.exemplo.invalido/a.jpg'] }} guardadas={[{ chave: 7, url: 'blob:guardada-7' }]} onExcluirGuardada={onExcluir} />);
    expect(screen.getByText('(2)')).toBeTruthy();
    const guardada = document.querySelector('[data-mk-foto-guardada]');
    expect(guardada?.textContent).toContain('Aguardando envio');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto 2 (aguardando envio)' }));
    const tela = screen.getByRole('dialog', { name: 'Foto da tarefa' });
    expect(within(tela).getByText('2 / 2')).toBeTruthy();
    expect(within(tela).getByText('Aguardando envio')).toBeTruthy();
    expect(within(tela).getByAltText('Foto 2').getAttribute('src')).toBe('blob:guardada-7');
    fireEvent.click(within(tela).getByRole('button', { name: 'Fechar foto' }));
    expect(screen.queryByRole('dialog', { name: 'Foto da tarefa' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir foto 2 (aguardando envio)' }));
    expect(onExcluir).toHaveBeenCalledWith(7);
    // A foto enviada abre também e não tem ✕ aqui (ela sai pela edição da tarefa).
    expect(screen.queryByRole('button', { name: /Excluir foto 1/ })).toBeNull();
  });

  it('FG-02 formulário: toda foto abre ao tocar; a guardada aparece e o ✕ a exclui depois de confirmar', async () => {
    guardadas = [{ chave: 3, url: 'blob:guardada-3', nome: 'cerca.jpg' }];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FormularioTarefaMapa tarefa={{ id: 't-1', titulo: 'Cerca', fotos: ['https://arquivos.exemplo.invalido/a.jpg'] }} onSubmit={() => {}} onCancel={() => {}} />
      </QueryClientProvider>
    );
    const miniaturas = [...document.querySelectorAll('[data-mk-miniatura]')];
    expect(miniaturas.map((m) => m.getAttribute('data-mk-miniatura'))).toEqual(['salva', 'guardada']);
    expect(miniaturas[1].textContent).toContain('AGUARDANDO ENVIO');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto 1' }));
    expect(within(screen.getByRole('dialog', { name: 'Foto da tarefa' })).getByText('1 / 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima foto' }));
    const tela = screen.getByRole('dialog', { name: 'Foto da tarefa' });
    expect(within(tela).getByText('Aguardando envio')).toBeTruthy();
    fireEvent.click(within(tela).getByRole('button', { name: 'Fechar foto' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remover foto 2' }));
    });
    expect(confirmarExclusao).toHaveBeenCalledTimes(1);
    expect(excluirFotoGuardada).toHaveBeenCalledWith(3);
  });

  it('FG-03 "Tirar foto" (câmera) e "Galeria"; a foto tirada entra como NOVA', async () => {
    const criar = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:nova-1');
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <FormularioTarefaMapa onSubmit={() => {}} onCancel={() => {}} />
        </QueryClientProvider>
      );
      const camera = screen.getByLabelText('Tirar foto com a câmera');
      const galeria = screen.getByLabelText('Escolher fotos da galeria');
      expect(camera.getAttribute('capture')).toBe('environment');
      expect(camera.getAttribute('accept')).toBe('image/*');
      expect(galeria.hasAttribute('capture')).toBe(false);
      expect(galeria.hasAttribute('multiple')).toBe(true);
      expect(screen.getByText('Tirar foto')).toBeTruthy();
      expect(screen.getByText('Galeria')).toBeTruthy();
      await act(async () => {
        fireEvent.change(camera, { target: { files: [new File([new Uint8Array([1])], 'cam.jpg', { type: 'image/jpeg' })] } });
      });
      const [nova] = [...document.querySelectorAll('[data-mk-miniatura="nova"]')];
      expect(nova?.textContent).toContain('NOVA');
    } finally {
      URL.createObjectURL = criar;
    }
  });
});
