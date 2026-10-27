/**
 * Regressão: ciclo pai → grade → seleção → pai (FIX-MENU-FREEZE-STRUCTURAL 2026-10-27).
 * Sem reconciliação idempotente, rows=[] recriado a cada render dispara loop de commits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React, { useState } from 'react';
import CadastroBase1Grade from '@/components/cadastro/base1/CadastroBase1Grade';
import TabelaMarcas, { getMarcaFieldValue, MARCAS_COLUNAS } from '@/components/marcas/TabelaMarcas';
import { useCadastroListaChromeState } from '@/hooks/useCadastroListaChromeState';

const MAX_RENDER_BURST = 40;

vi.mock('@/components/cadastro/base1/Base1Grid', () => ({
  default: function MockBase1Grid() {
    return <div data-testid="mock-base1-grid" />;
  },
}));

vi.mock('@/components/cadastro/base1/Base1Cards', () => ({
  Base1Cards: function MockBase1Cards() {
    return <div data-testid="mock-base1-cards" />;
  },
}));

function renderWithProviders(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Simula `const { data: x = [] }` — novo array a cada render do pai. */
function UnstableEmptyRowsGradeHarness() {
  const chrome = useCadastroListaChromeState();
  const unstableRows = [];
  return (
    <CadastroBase1Grade
      rows={unstableRows}
      columns={MARCAS_COLUNAS}
      storageKey="test_colunas_marcas"
      droppableId="test-colunas-marcas"
      getFieldValue={getMarcaFieldValue}
      defaultSortKey="nome"
      isLoading
      searchQuery=""
      resetFiltersKey={0}
      onSelectionChange={chrome.onSelectionChange}
      onFiltersActiveChange={() => {}}
      viewMode="table"
    />
  );
}

function MarcasTableHarness({ rows, isLoading }) {
  const chrome = useCadastroListaChromeState();
  return (
    <TabelaMarcas
      marcas={rows}
      isLoading={isLoading}
      searchQuery=""
      resetFiltersKey={0}
      onSelectionChange={chrome.onSelectionChange}
      onFiltersActiveChange={() => {}}
      viewMode="table"
      showConfigColunas={false}
      setShowConfigColunas={() => {}}
    />
  );
}

describe('Cadastro — seleção estável com rows vazios instáveis', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grade + chrome não entram em avalanche de renders (rows=[] novo a cada render)', async () => {
    let harnessRenders = 0;
    function CountingHarness() {
      harnessRenders += 1;
      return <UnstableEmptyRowsGradeHarness />;
    }

    renderWithProviders(<CountingHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(harnessRenders).toBeLessThan(MAX_RENDER_BURST);
  });

  it('TabelaMarcas + chrome com lista pendente (referência estável de vazio)', async () => {
    const EMPTY = Object.freeze([]);
    let harnessRenders = 0;

    function PendingMarcasHarness() {
      harnessRenders += 1;
      return <MarcasTableHarness rows={EMPTY} isLoading />;
    }

    renderWithProviders(<PendingMarcasHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(harnessRenders).toBeLessThan(MAX_RENDER_BURST);
  });

  it('preserva seleção quando rows ganha nova referência com mesmos IDs', async () => {
    const rowA = { id: 'a1', nome: 'Alpha', numero_marca: '1', ativo: true };
    const rowB = { id: 'b2', nome: 'Beta', numero_marca: '2', ativo: true };
    let rowsRef = [{ ...rowA }, { ...rowB }];

    function SelectThenRefreshHarness() {
      const chrome = useCadastroListaChromeState();
      const [tick, setTick] = useState(0);

      return (
        <>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            refresh-rows
          </button>
          <span data-testid="tick">{tick}</span>
          <TabelaMarcas
            marcas={rowsRef.map((r) => ({ ...r }))}
            isLoading={false}
            searchQuery=""
            resetFiltersKey={0}
            onSelectionChange={chrome.onSelectionChange}
            onFiltersActiveChange={() => {}}
            viewMode="table"
            showConfigColunas={false}
            setShowConfigColunas={() => {}}
          />
          <span data-testid="selected-count">{chrome.selectedIds.length}</span>
        </>
      );
    }

    const { getByTestId } = renderWithProviders(<SelectThenRefreshHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    rowsRef = [{ ...rowA }, { ...rowB }];
    await act(async () => {
      getByTestId('refresh-rows').click();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(Number(getByTestId('selected-count').textContent)).toBe(0);
  });
});
