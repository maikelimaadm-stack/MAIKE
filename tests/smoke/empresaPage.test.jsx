import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A página Empresa depois da migração (P1.1).
 *
 * O que esta suíte cobre é a **fiação da página**: de onde vêm os dados, para
 * onde vão as ações e como o erro chega ao usuário. Por isso o mock é do
 * `empresaService` — a dependência que a página passou a declarar.
 *
 * `FormularioEmpresa` e `TabelaEmpresas` são substituídos por dublês que apenas
 * expõem os callbacks. Esta slice não pode mudar formulário nem tabela, e
 * dirigir o Radix/shadcn real aqui testaria aqueles componentes, não a
 * fronteira. O acoplamento da página é verificado de três formas
 * independentes: estes testes, a asserção estática no fim do arquivo e o
 * `gate:api-boundary` no `verify:all`.
 */
const serviceMock = {
  listEmpresas: vi.fn(),
  createEmpresa: vi.fn(),
  updateEmpresa: vi.fn(),
  deleteEmpresa: vi.fn(),
};

vi.mock('@/services/empresaService', () => ({
  listEmpresas: (...a) => serviceMock.listEmpresas(...a),
  createEmpresa: (...a) => serviceMock.createEmpresa(...a),
  updateEmpresa: (...a) => serviceMock.updateEmpresa(...a),
  deleteEmpresa: (...a) => serviceMock.deleteEmpresa(...a),
}));

const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock('sonner', () => ({
  toast: {
    success: (...a) => toastMock.success(...a),
    error: (...a) => toastMock.error(...a),
  },
}));

vi.mock('../../src/components/empresa/FormularioEmpresa', () => ({
  default: ({ onSubmit, initialData, isEditing }) => (
    <div data-testid="formulario">
      <span data-testid="modo">{isEditing ? 'edicao' : 'criacao'}</span>
      <button type="button" onClick={() => onSubmit({ nome: 'Estância Nova', apelido: 'Nova' })}>
        salvar-formulario
      </button>
      <span data-testid="nome-inicial">{initialData?.nome ?? ''}</span>
    </div>
  ),
}));

vi.mock('../../src/components/empresa/TabelaEmpresas', () => ({
  default: ({ empresas, onEdit, onDelete, isLoading }) => (
    <div data-testid="tabela">
      <span data-testid="carregando">{String(isLoading)}</span>
      {empresas.map((empresa) => (
        <div key={empresa.id}>
          <span>{empresa.nome}</span>
          <button type="button" onClick={() => onEdit(empresa)}>{`editar-${empresa.id}`}</button>
          <button type="button" onClick={() => onDelete(empresa.id)}>{`excluir-${empresa.id}`}</button>
        </div>
      ))}
    </div>
  ),
}));

const EMPRESAS = [
  { id: '1', nome: 'Fazenda Boa Vista' },
  { id: '2', nome: 'Sítio Alegre' },
];

const renderPagina = async () => {
  const { default: Empresa } = await import('@/pages/Empresa');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Empresa />
    </QueryClientProvider>
  );
  return { ...utils, queryClient, invalidateSpy };
};

beforeEach(() => {
  Object.values(serviceMock).forEach((m) => m.mockReset());
  Object.values(toastMock).forEach((m) => m.mockReset());
  serviceMock.listEmpresas.mockResolvedValue(EMPRESAS);
});

afterEach(() => cleanup());

describe('página Empresa — fiação com o service', () => {
  it('lista as empresas pelo service', async () => {
    await renderPagina();

    await waitFor(() => expect(serviceMock.listEmpresas).toHaveBeenCalled());
    expect(await screen.findByText('Fazenda Boa Vista')).toBeInTheDocument();
    expect(screen.getByText('Sítio Alegre')).toBeInTheDocument();
  });

  it('cria uma empresa, invalida a lista e avisa o usuário', async () => {
    serviceMock.createEmpresa.mockResolvedValue({ id: '3' });
    const { invalidateSpy } = await renderPagina();

    await screen.findByText('Fazenda Boa Vista');
    fireEvent.click(screen.getByRole('button', { name: /nova empresa/i }));
    expect(screen.getByTestId('modo')).toHaveTextContent('criacao');

    fireEvent.click(screen.getByRole('button', { name: 'salvar-formulario' }));

    await waitFor(() => expect(serviceMock.createEmpresa).toHaveBeenCalled());
    expect(serviceMock.createEmpresa.mock.calls[0][0]).toMatchObject({ nome: 'Estância Nova' });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Empresa cadastrada!'));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['empresas'] });
  });

  it('edita a empresa selecionada, passando id e dados', async () => {
    serviceMock.updateEmpresa.mockResolvedValue({ id: '1' });
    await renderPagina();

    await screen.findByText('Fazenda Boa Vista');
    fireEvent.click(screen.getByRole('button', { name: 'editar-1' }));
    expect(screen.getByTestId('modo')).toHaveTextContent('edicao');
    expect(screen.getByTestId('nome-inicial')).toHaveTextContent('Fazenda Boa Vista');

    fireEvent.click(screen.getByRole('button', { name: 'salvar-formulario' }));

    await waitFor(() => expect(serviceMock.updateEmpresa).toHaveBeenCalled());
    expect(serviceMock.updateEmpresa.mock.calls[0][0]).toBe('1');
    expect(serviceMock.updateEmpresa.mock.calls[0][1]).toMatchObject({ nome: 'Estância Nova' });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Empresa atualizada!'));
  });

  it('exclui pelo service', async () => {
    serviceMock.deleteEmpresa.mockResolvedValue(undefined);
    await renderPagina();

    await screen.findByText('Sítio Alegre');
    fireEvent.click(screen.getByRole('button', { name: 'excluir-2' }));

    await waitFor(() => expect(serviceMock.deleteEmpresa).toHaveBeenCalledWith('2'));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Empresa excluída!'));
  });

  it('mostra a mensagem amigável quando o service reporta conflito de nome', async () => {
    const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');
    serviceMock.createEmpresa.mockRejectedValue(new ApiError(API_ERROR_CODES.EMPRESA_NAME_CONFLICT));
    await renderPagina();

    await screen.findByText('Fazenda Boa Vista');
    fireEvent.click(screen.getByRole('button', { name: /nova empresa/i }));
    fireEvent.click(screen.getByRole('button', { name: 'salvar-formulario' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0][0]).toMatch(/já existe uma empresa/i);
  });

  it('erro sem mensagem cai no fallback determinístico', async () => {
    serviceMock.createEmpresa.mockRejectedValue({});
    await renderPagina();

    await screen.findByText('Fazenda Boa Vista');
    fireEvent.click(screen.getByRole('button', { name: /nova empresa/i }));
    fireEvent.click(screen.getByRole('button', { name: 'salvar-formulario' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Erro.'));
  });
});

describe('página Empresa — asserção estática de desacoplamento', () => {
  it('o arquivo não contém nenhuma referência ao provider legado', async () => {
    const { readFileSync } = await import('node:fs');
    const fonte = readFileSync('src/pages/Empresa.jsx', 'utf8');

    expect(fonte).not.toContain('base44');
    expect(fonte).not.toContain('@base44/sdk');
    expect(fonte).not.toContain('entities.Empresa');
    expect(fonte).toContain('@/services/empresaService');
  });
});
