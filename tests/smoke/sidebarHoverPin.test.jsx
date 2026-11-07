// @vitest-environment jsdom
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import DesktopSidebar from '@/components/navigation/DesktopSidebar';
afterEach(cleanup);
const items = [{ id: 'manejo', title: 'Manejo', submenu: [{ id: 'lotes', title: 'Lotes', url: 'CadastroLotes' }] }];
function Fixture({ navegar }) {
  const [collapsed, setCollapsed] = React.useState(true);
  return <MemoryRouter><DesktopSidebar items={items} currentPath="/cadastrolotes" onNavigate={(e,p) => {e.preventDefault();navegar(p);}} collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} onSearch={() => {}} /></MemoryRouter>;
}
it('hover abre a lista, clique no ícone não expande; fixar expande e desafixar recolhe', () => {
  render(<Fixture navegar={vi.fn()} />);
  const icon = screen.getByRole('button', { name: 'Abrir menu Manejo' });
  fireEvent.mouseEnter(icon);
  expect(screen.getByRole('menu', { name: 'Manejo' })).toBeTruthy();
  fireEvent.click(icon);
  expect(document.querySelector('#app-shell-sidebar').getAttribute('data-collapsed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Fixar menu', exact: true }));
  expect(document.querySelector('#app-shell-sidebar').getAttribute('data-collapsed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Desafixar menu' }));
  expect(document.querySelector('#app-shell-sidebar').getAttribute('data-collapsed')).toBe('true');
});
it('escolher uma tela navega sem fixar o menu', () => {
  const navegar = vi.fn();
  render(<Fixture navegar={navegar} />);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Abrir menu Manejo' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Lotes' }));
  expect(navegar).toHaveBeenCalledWith('/cadastrolotes');
  expect(document.querySelector('#app-shell-sidebar').getAttribute('data-collapsed')).toBe('true');
});
