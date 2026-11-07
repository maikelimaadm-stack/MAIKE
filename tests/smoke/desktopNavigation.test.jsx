// @vitest-environment jsdom
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import DesktopNavigation from '@/components/navigation/DesktopNavigation';
afterEach(cleanup);
it('mantém módulos visíveis e abre suas telas somente no clique', () => {
  const navegar = vi.fn((e) => e.preventDefault());
  render(<MemoryRouter><DesktopNavigation items={[{id:'manejo',title:'Manejo',submenu:[{id:'lotes',title:'Lotes',url:'CadastroLotes'}]}]} currentPath="/cadastrolotes" onNavigate={navegar} onSearch={() => {}} /></MemoryRouter>);
  const modulo = screen.getByRole('button', { name: 'Manejo' });
  fireEvent.mouseEnter(modulo);
  expect(screen.queryByRole('link', { name: 'Lotes' })).toBeNull();
  expect(document.querySelector('#app-shell-sidebar')).toBeNull();
  fireEvent.click(modulo);
  fireEvent.click(screen.getByRole('link', { name: 'Lotes' }));
  expect(navegar).toHaveBeenCalledWith(expect.anything(), '/cadastrolotes');
  expect(screen.queryByRole('link', { name: 'Lotes' })).toBeNull();
});
it('preserva a busca e os controles da conta no cabeçalho', () => {
  const pesquisar = vi.fn();
  render(<MemoryRouter><DesktopNavigation items={[]} currentPath="/cadastrolotes" onNavigate={() => {}} onSearch={pesquisar}><button>Fazenda</button></DesktopNavigation></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Pesquisar telas' }));
  expect(pesquisar).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Fazenda' })).toBeTruthy();
});
