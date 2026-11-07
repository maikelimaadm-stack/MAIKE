// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MapaFiltroSelecao from '@/components/mapa/MapaFiltroSelecao';
import { filtroInclui, filtroSemRestricao } from '@/lib/mapaFiltroSelecao';
import { normalizarFiltrosMapa } from '@/lib/mapaGeralFiltrosStorage';
afterEach(cleanup);

it('seleciona mais de uma opção sem fechar a lista nem abrir folha mobile', () => {
  function Campo() {
    const [value, setValue] = React.useState('todos');
    return <MapaFiltroSelecao aria-label="Setor" value={value} onChange={e => setValue(e.target.value)}>
      <option value="todos">Todos</option><option value="a">Setor A</option><option value="b">Setor B</option>
    </MapaFiltroSelecao>;
  }
  render(<Campo />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Setor' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Setor A' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Setor B' }));
  expect(screen.getByRole('combobox').textContent).toContain('2 selecionados');
  expect(screen.getByRole('checkbox', { name: 'Setor A' }).checked).toBe(true);
  expect(screen.getByRole('checkbox', { name: 'Setor B' }).checked).toBe(true);
  expect(document.querySelector('.mk-sheet-root')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Todos' }));
  expect(screen.getByRole('combobox').textContent).toContain('Todos');
});

describe('preferências de multisseleção', () => {
  it('preserva listas, remove valores inválidos e aceita preferências antigas', () => {
    const st = normalizarFiltrosMapa({ filtroSetor: ['a', 'b', 'a', 4], filtroCategoria: 'BOI', filtroStatus: [] });
    expect(st.filtroSetor).toEqual(['a', 'b']);
    expect(st.filtroCategoria).toBe('BOI');
    expect(st.filtroStatus).toBe('todos');
  });
  it('aceita qualquer opção marcada dentro do campo, inclusive status de alertas', () => {
    expect(filtroInclui(['a', 'b'], 'b')).toBe(true);
    expect(filtroInclui(['a', 'b'], 'c')).toBe(false);
    expect(filtroInclui('BOI', 'BOI')).toBe(true);
    expect(filtroInclui('todos', 'qualquer')).toBe(true);
    expect(filtroSemRestricao([])).toBe(true);
    expect(filtroInclui(['com_alerta', 'sem_alerta'], 'sem_alerta')).toBe(true);
  });
});
