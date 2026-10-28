import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const serviceMock = {
  listEmpresas: vi.fn(),
  createEmpresa: vi.fn(),
  updateEmpresa: vi.fn(),
  excluirEmpresas: vi.fn(),
};

vi.mock('@/services/empresaService', () => ({
  listEmpresas: (...a) => serviceMock.listEmpresas(...a),
  createEmpresa: (...a) => serviceMock.createEmpresa(...a),
  updateEmpresa: (...a) => serviceMock.updateEmpresa(...a),
  excluirEmpresas: (...a) => serviceMock.excluirEmpresas(...a),
}));

const notifyMock = {
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
};
vi.mock('@/lib/maikeNotify', () => notifyMock);

const toastMock = { success: vi.fn(), error: vi.fn(), message: vi.fn() };
vi.mock('sonner', () => ({
  toast: {
    success: (...a) => toastMock.success(...a),
    error: (...a) => toastMock.error(...a),
    message: (...a) => toastMock.message(...a),
  },
}));

vi.mock('../../src/components/empresa/FormularioEmpresa', () => ({
  FORMULARIO_EMPRESA_ID: 'formulario-empresa-base1',
  default: ({ onSubmit, initialData, readOnly }) => (
    <div data-testid="formulario">
      <span data-testid="modo">
        {readOnly ? 'consulta' : initialData?.id ? 'edicao' : 'criacao'}
      </span>
      <button type="button" onClick={() => onSubmit({ nome: 'Estância Nova', apelido: 'Nova' })}>
        salvar-formulario
      </button>
      <span data-testid="nome-inicial">{initialData?.nome ?? ''}</span>
    </div>
  ),
}));

vi.mock('../../src/components/empresa/TabelaEmpresas', () => ({
  EMPRESAS_COLUNAS: [{ id: 'nome', label: 'Nome' }],
  getEmpresaFieldValue: (item, id) => item[id] ?? '',
  default: ({ empresas, onEdit, isLoading }) => (
    <div data-testid="tabela">
      <span data-testid="carregando">{String(isLoading)}</span>
      {empresas.map((empresa) => (
        <div key={empresa.id}>
          <span>{empresa.nome}</span>
          <button type="button" onClick={() => onEdit(empresa)}>{`editar-${empresa.id}`}</button>
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
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Empresa />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
};

beforeEach(() => {
  Object.values(serviceMock).forEach((m) => m.mockReset());
  Object.values(notifyMock).forEach((m) => m.mockReset());
  Object.values(toastMock).forEach((m) => m.mockReset());
  serviceMock.listEmpresas.mockResolvedValue(EMPRESAS);
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe('página Empresa — MotorBase1 + service', () => {
  it('lista as empresas pelo service (tenant-global)', async () => {
    await renderPagina();
    await waitFor(() => expect(serviceMock.listEmpresas).toHaveBeenCalled());
    expect(await screen.findByText('Fazenda Boa Vista')).toBeInTheDocument();
  });

  it('cria empresa, mescla cache e notifica', async () => {
    serviceMock.createEmpresa.mockResolvedValue({ id: '3', numero_empresa: 3, nome: 'Estância Nova' });
    const { queryClient } = await renderPagina();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('Fazenda Boa Vista');
    fireEvent.click(screen.getByRole('button', { name: /^novo$/i }));
    expect(screen.getByTestId('modo')).toHaveTextContent('criacao');
    fireEvent.click(screen.getByRole('button', { name: 'salvar-formulario' }));

    await waitFor(() => expect(serviceMock.createEmpresa).toHaveBeenCalled());
    await waitFor(() =>
      expect(notifyMock.notifySuccess).toHaveBeenCalledWith('Sucesso', 'Empresa cadastrada!'),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['empresas'] });
    expect(queryClient.getQueryData(['empresas']).some((e) => e.id === '3')).toBe(true);
  });

  it('POST ok mantém sucesso mesmo se refetch falhar', async () => {
    serviceMock.createEmpresa.mockResolvedValue({ id: '9', numero_empresa: 9, nome: 'Salva Offline' });
    let listCalls = 0;
    serviceMock.listEmpresas.mockImplementation(async () => {
      listCalls += 1;
      if (listCalls === 1) return EMPRESAS;
      if (listCalls === 2) throw new Error('rede');
      return EMPRESAS;
    });
    const { queryClient } = await renderPagina();

    await screen.findByText('Fazenda Boa Vista');
    fireEvent.click(screen.getByRole('button', { name: /^novo$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'salvar-formulario' }));

    await waitFor(() =>
      expect(notifyMock.notifySuccess).toHaveBeenCalledWith('Sucesso', 'Empresa cadastrada!'),
    );
    expect(queryClient.getQueryData(['empresas']).some((e) => e.id === '9')).toBe(true);
  });

  it('edita empresa selecionada', async () => {
    serviceMock.updateEmpresa.mockResolvedValue({ id: '1', numero_empresa: 1, nome: 'Estância Nova' });
    await renderPagina();

    await screen.findByText('Fazenda Boa Vista');
    fireEvent.click(screen.getByRole('button', { name: 'editar-1' }));
    expect(screen.getByTestId('modo')).toHaveTextContent('consulta');
    fireEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    expect(screen.getByTestId('modo')).toHaveTextContent('edicao');

    fireEvent.click(screen.getByRole('button', { name: 'salvar-formulario' }));
    await waitFor(() => expect(serviceMock.updateEmpresa).toHaveBeenCalled());
    expect(serviceMock.updateEmpresa.mock.calls[0][0]).toBe('1');
  });

  it('página usa excluirEmpresas para exclusão honesta em lote', async () => {
    const { readFileSync } = await import('node:fs');
    const fonte = readFileSync('src/pages/Empresa.jsx', 'utf8');
    expect(fonte).toMatch(/excluirEmpresas/);
    expect(fonte).toMatch(/bloqueados/);
  });

  it('409 EMPRESA_NAME_CONFLICT mantém formulário aberto', async () => {
    const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');
    serviceMock.createEmpresa.mockRejectedValue(new ApiError(API_ERROR_CODES.EMPRESA_NAME_CONFLICT));
    await renderPagina();

    await screen.findByText('Fazenda Boa Vista');
    fireEvent.click(screen.getByRole('button', { name: /^novo$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'salvar-formulario' }));

    await waitFor(() => expect(notifyMock.notifyWarning).toHaveBeenCalled());
    expect(screen.getByTestId('formulario')).toBeInTheDocument();
  });
});

describe('página Empresa — asserção estática', () => {
  it('usa MotorBase1 full-list e service nativo', async () => {
    const { readFileSync } = await import('node:fs');
    const fonte = readFileSync('src/pages/Empresa.jsx', 'utf8');
    expect(fonte).toMatch(/useCadastroBase1FullListController/);
    expect(fonte).toMatch(/CadastroBase1Screen/);
    expect(fonte).not.toContain('base44');
    expect(fonte).toContain('@/services/empresaService');
  });
});
