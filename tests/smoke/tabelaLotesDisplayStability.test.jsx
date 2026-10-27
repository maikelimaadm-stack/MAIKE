/**
 * Regressão: ciclo TabelaLotes ↔ CadastroBase1Grade via onDisplayChange (FIX-LOTES-URL-R2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import TabelaLotes from '@/components/lotes/TabelaLotes';
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
  Base1CardsToolbar: function MockBase1CardsToolbar() {
    return null;
  },
}));

function LotesTableHarness({ lotes, isLoading }) {
  const chrome = useCadastroListaChromeState();
  return (
    <TabelaLotes
      lotes={lotes}
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

describe('Lotes — onDisplayChange estável (lista vazia / omitida)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prop lotes omitida + chrome não entram em avalanche de renders', async () => {
    let harnessRenders = 0;

    function CountingHarness() {
      harnessRenders += 1;
      return <LotesTableHarness isLoading={false} />;
    }

    render(<CountingHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(harnessRenders).toBeLessThan(MAX_RENDER_BURST);
  });

  it('lista vazia estável + loading não dispara loop', async () => {
    const EMPTY = [];
    let harnessRenders = 0;

    function PendingHarness() {
      harnessRenders += 1;
      return <LotesTableHarness lotes={EMPTY} isLoading />;
    }

    render(<PendingHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(harnessRenders).toBeLessThan(MAX_RENDER_BURST);
  });

  it('propaga alteração de campo quando a referência do row muda (mesmo id)', async () => {
    const loteA = { id: '1', nome: 'Lote Alpha', quantidade_entrada: 10, peso_medio_kg: 100 };
    const loteB = { id: '1', nome: 'Lote Beta', quantidade_entrada: 10, peso_medio_kg: 200 };
    const visibleSnapshots = [];

    function Harness({ lotes }) {
      return (
        <TabelaLotes
          lotes={lotes}
          isLoading={false}
          searchQuery=""
          resetFiltersKey={0}
          onFiltersActiveChange={() => {}}
          viewMode="table"
          showConfigColunas={false}
          setShowConfigColunas={() => {}}
          onVisibleDataChange={(payload) => {
            visibleSnapshots.push(payload.allRows?.[0]?.[1] ?? null);
          }}
        />
      );
    }

    const { rerender } = render(<Harness lotes={[loteA]} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    rerender(<Harness lotes={[loteB]} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(visibleSnapshots.length).toBeGreaterThan(1);
    expect(visibleSnapshots.at(-1)).not.toBe(visibleSnapshots[0]);
  });
});
