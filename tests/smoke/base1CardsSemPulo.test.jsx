/**
 * D-PROD-137: tocar/clicar num card não faz a lista pular para outro card.
 * Antes, a cada mudança de seleção o primeiro selecionado era centralizado e o
 * próximo toque caía em outro card.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Base1Cards } from '@/components/cadastro/base1/Base1Cards';

const ROWS = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, nome: `LOTE ${i + 1}`, numero: 100 + i }));
const COLS = [{ id: 'nome', label: 'Nome' }, { id: 'numero', label: 'Código' }];

function Lista({ inicial = [] }) {
  const [sel, setSel] = useState(new Set(inicial));
  return (
    <>
      <Base1Cards
        rows={ROWS}
        columns={COLS}
        fields={['numero']}
        perRow={1}
        selected={sel}
        onSelectClick={(id) => setSel((s) => new Set([...s, id]))}
        getFieldValue={(r, c) => String(r[c])}
      />
      <button type="button" onClick={() => setSel(new Set(['l5']))}>de fora</button>
    </>
  );
}

let rolar;
beforeEach(() => {
  rolar = vi.fn();
  Element.prototype.scrollIntoView = rolar;
});

describe('Base1Cards — sem pulo ao tocar', () => {
  it('CAR-01 clicar em cards não rola a lista', () => {
    render(<Lista inicial={['l0']} />);
    rolar.mockClear();
    const cards = screen.getAllByTestId('b1-card');
    fireEvent.click(cards[3]);
    fireEvent.click(cards[4]);
    expect(rolar).not.toHaveBeenCalled();
  });

  it('CAR-02 seleção vinda de fora rola até o card, sem centralizar', () => {
    render(<Lista />);
    rolar.mockClear();
    fireEvent.click(screen.getByText('de fora'));
    expect(rolar).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
