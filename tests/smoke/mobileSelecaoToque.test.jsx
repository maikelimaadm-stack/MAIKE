/**
 * Seleção no celular: tocar numa opção da folha de baixo precisa escolher a
 * opção (bug: a folha fechava no pointerdown e a escolha se perdia).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

const celular = () => {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: /max-width:\s*639px/.test(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
};

/**
 * Toque real: pointerdown, pointerup e click chegam em tarefas separadas, e o
 * React redesenha entre elas. Cada evento num `act` próprio reproduz isso.
 */
const tocar = async (el) => {
  await act(async () => {
    fireEvent.pointerDown(el);
  });
  await act(async () => {
    fireEvent.pointerUp(el);
  });
  await act(async () => {
    fireEvent.click(el);
  });
};

let original;
beforeEach(() => {
  cleanup();
  original = window.matchMedia;
  celular();
});
afterEach(() => {
  window.matchMedia = original;
});

describe('Seleção no celular — tocar na opção escolhe', () => {
  it('SEL1 — AutocompleteGenerico (Setor, Categoria, Marca…)', async () => {
    const { default: AutocompleteGenerico } = await import('@/components/financeiro/AutocompleteGenerico');
    const onChange = vi.fn();
    render(
      <AutocompleteGenerico
        items={[{ id: 'a', nome: 'Setor Norte' }, { id: 'b', nome: 'Setor Sul' }]}
        value=""
        onChange={onChange}
        placeholder="BUSCAR SETOR..."
      />,
    );
    await tocar(screen.getByPlaceholderText('BUSCAR SETOR...'));
    await tocar(await screen.findByRole('option', { name: 'Setor Sul' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('option', { name: 'Setor Sul' })).toBeNull();
  });

  it('SEL2 — B1Select (selects nativos dos cadastros)', async () => {
    const { default: B1Select } = await import('@/components/cadastro/base1/B1Select');
    const onChange = vi.fn();
    render(
      <B1Select aria-label="Tipo de Uso" value="" onChange={onChange}>
        <option value="">SELECIONE</option>
        <option value="consumo">CONSUMO</option>
        <option value="revenda">REVENDA</option>
      </B1Select>,
    );
    await tocar(screen.getByRole('combobox', { name: 'Tipo de Uso' }));
    await tocar(await screen.findByRole('option', { name: 'REVENDA' }));
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].target.value).toBe('revenda');
  });

  it('SEL3 — MgSelect (selects Base1)', async () => {
    const { MgSelect } = await import('@/components/cadastro/base1/MgSelect');
    const onChange = vi.fn();
    render(
      <MgSelect
        ariaLabel="Sexo"
        value=""
        onChange={onChange}
        options={[{ value: 'f', label: 'Fêmea' }, { value: 'm', label: 'Macho' }]}
      />,
    );
    await tocar(screen.getByRole('combobox', { name: 'Sexo' }));
    await tocar(await screen.findByRole('option', { name: 'Macho' }));
    expect(onChange).toHaveBeenCalledWith('m');
  });
});
