/**
 * Diálogo de anexos — pendentes (P1.3-R1).
 *
 * O id de um anexo pendente era `pending-${novosAnexos.length}-${file.name}`, e
 * `novosAnexos` reinicia a cada seleção. Duas seleções separadas do mesmo
 * arquivo produziam a mesma key, e remover um item removia o outro.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/services/anexoService', () => ({
  listarAnexos: vi.fn(async () => []),
  anexarArquivo: vi.fn(async () => ({ id: 'salvo' })),
  excluirAnexo: vi.fn(async () => ({})),
}));

const RegistroAnexosDialog = (await import('@/components/common/RegistroAnexosDialog')).default;

const arquivo = (nome) => new File(['x'], nome, { type: 'application/pdf' });

/** Controla `pendingAnexos` como a página faz, para observar o estado real. */
const Hospedeiro = ({ aoMudar }) => {
  const [pendentes, setPendentes] = React.useState([]);
  React.useEffect(() => aoMudar?.(pendentes), [pendentes, aoMudar]);
  return (
    <RegistroAnexosDialog
      open
      onOpenChange={() => {}}
      entityName="Lote"
      recordId={null}
      title="Anexos"
      pendingAnexos={pendentes}
      onPendingChange={setPendentes}
    />
  );
};

const montar = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let atual = [];
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Hospedeiro aoMudar={(p) => { atual = p; }} />
      </QueryClientProvider>
    );
  });
  return { pendentes: () => atual };
};

const selecionar = async (nome, nomeArquivo) => {
  const campoNome = screen.getByPlaceholderText(/CONTRATO, NOTA FISCAL/i);
  await act(async () => { fireEvent.change(campoNome, { target: { value: nome } }); });
  const input = document.querySelector('input[type="file"]');
  await act(async () => {
    fireEvent.change(input, { target: { files: [arquivo(nomeArquivo)] } });
  });
};

beforeEach(() => cleanup());
afterEach(() => vi.clearAllMocks());

describe('AN — anexos pendentes', () => {
  it('AN1/AN2 — duas seleções do mesmo arquivo geram ids diferentes', async () => {
    const { pendentes } = await montar();

    await selecionar('Contrato', 'nota.pdf');
    await selecionar('Aditivo', 'nota.pdf');

    const ids = pendentes().map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('AN3 — remover um pendente mantém o outro', async () => {
    const { pendentes } = await montar();
    await selecionar('Contrato', 'nota.pdf');
    await selecionar('Aditivo', 'nota.pdf');

    const linhas = screen.getAllByText('nota.pdf');
    expect(linhas).toHaveLength(2);

    const botoes = screen.getAllByRole('button').filter((b) => b.className.includes('text-red-600'));
    await act(async () => { fireEvent.click(botoes[0]); });

    const restantes = pendentes();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].attachment_name).toBe('Aditivo');
  });

  it('AN4 — pendente sem file_url não vira link quebrado', async () => {
    await montar();
    await selecionar('Contrato', 'nota.pdf');

    const links = document.querySelectorAll('a');
    for (const link of links) {
      expect(link.getAttribute('href')).toBeTruthy();
    }
    expect(screen.getByText('Pendente')).toBeInTheDocument();
  });

  it('AN5 — o pendente carrega o arquivo para persistir depois da criação', async () => {
    const { pendentes } = await montar();
    await selecionar('Contrato', 'nota.pdf');

    const [pendente] = pendentes();
    expect(pendente.arquivo).toBeInstanceOf(File);
    expect(pendente.attachment_name).toBe('Contrato');
    expect(pendente.file_name).toBe('nota.pdf');
  });
});
