/**
 * MOTORBASE1-ROLLOUT-01 — UnidadesMedida consome preset lista integrada;
 * storageKey, droppableId e query keys permanecem da entidade.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BASE1_LISTA_INTEGRADA_VISUAL } from '@/components/cadastro/base1/base1VisualPreset';

const serviceMock = {
  listarUnidadesPagina: vi.fn(),
  numerarUnidadesSemNumero: vi.fn(),
};

vi.mock('@/services/unidadeMedidaService', () => ({
  listarUnidadesPagina: (...a) => serviceMock.listarUnidadesPagina(...a),
  criarUnidade: vi.fn(),
  atualizarUnidade: vi.fn(),
  numerarUnidadesSemNumero: (...a) => serviceMock.numerarUnidadesSemNumero(...a),
  excluirUnidades: vi.fn(),
}));

const PAGE_ENVELOPE = {
  items: [],
  next_cursor: null,
  has_more: false,
  total: 0,
  limit: 100,
};

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock('@/components/common/ConfirmDialog', () => ({
  default: () => null,
}));

const gradePropsSpy = vi.fn();
vi.mock('@/components/cadastro/base1/CadastroBase1Grade', () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-unidades">grade</div>;
  },
}));

const UNIDADES = [
  { id: 'u1', sigla: 'KG', descricao: 'QUILOGRAMA', ativo: true, numero_unidade: 1 },
];

const renderPagina = async () => {
  gradePropsSpy.mockClear();
  const { default: UnidadesMedida } = await import('@/pages/UnidadesMedida');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <UnidadesMedida />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
};

beforeEach(() => {
  serviceMock.listarUnidadesPagina.mockResolvedValue({ ...PAGE_ENVELOPE, items: UNIDADES, total: 1 });
  serviceMock.numerarUnidadesSemNumero.mockResolvedValue({ numeradas: [] });
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe('UnidadesMedida — rollout preset Base1 lista integrada', () => {
  it('aplica layout base1-list e preset na grade sem alterar storageKey/droppableId', async () => {
    await renderPagina();

    await waitFor(() => {
      expect(screen.getByTestId('grade-unidades')).toBeTruthy();
    });

    expect(document.querySelector('.cadastro-b1--full-page')).toBeTruthy();
    expect(BASE1_LISTA_INTEGRADA_VISUAL.workspace.pageLayout).toBe('base1-list');

    const gradeCall = gradePropsSpy.mock.calls.find((c) => c[0]?.storageKey === 'colunas_unidades_medida');
    expect(gradeCall).toBeTruthy();
    const props = gradeCall[0];
    expect(props.droppableId).toBe('colunas-unidades-medida');
    expect(props.referenceHeaders).toBe(BASE1_LISTA_INTEGRADA_VISUAL.grade.referenceHeaders);
    expect(props.storageKey).toBe('colunas_unidades_medida');
  });

  it('UnidadesMedida.jsx importa preset e unidadeMedidaService (não marcaService)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/UnidadesMedida.jsx'), 'utf8');
    expect(src).toMatch(/CadastroBase1Screen/);
    expect(src).toMatch(/unidadeMedidaService/);
    expect(src).not.toMatch(/marcaService/);
    expect(src).toMatch(/colunas_unidades_medida/);
    const tabela = fs.readFileSync(path.join(process.cwd(), 'src/components/unidades-medida/TabelaUnidadesMedida.jsx'), 'utf8');
    expect(tabela).toMatch(/colunas-unidades-medida/);
    expect(src).toMatch(/useCadastroBase1Controller/);
    expect(src).toMatch(/\["unidades_medida", "page"\]/);
  });
});
