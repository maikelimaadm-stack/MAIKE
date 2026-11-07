// @vitest-environment jsdom
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import DesktopSidebar from '@/components/navigation/DesktopSidebar';
afterEach(cleanup);
const items = [{ id: 'manejo', title: 'Manejo', submenu: [{ id: 'lotes', title: 'Lotes', url: 'CadastroLotes' }] }];
function Fixture({ navegar }) {
  const [collapsed, setCollapsed] = React.useState(true);
  return <MemoryRouter><DesktopSidebar items={items} currentPath="/cadastrolotes" onNavigate={(e,p) => {e.preventDefault();navegar(p);}} collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} onSearch={() => {}} /></MemoryRouter>;
}
it('hover mostra o menu completo sobre a página e sair fecha sem fixar', async () => {
  render(<Fixture navegar={vi.fn()} />);
  const nav = document.querySelector('#app-shell-sidebar');
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Menu principal' }));
  expect(nav.getAttribute('data-peeking')).toBe('true');
  expect(nav.getAttribute('data-pinned')).toBe('false');
  expect(screen.getByRole('link', { name: 'Lotes' })).toBeTruthy();
  fireEvent.mouseLeave(nav);
  await waitFor(() => expect(nav.getAttribute('data-collapsed')).toBe('true'));
});
it('fixar mantém o menu aberto ao sair; desafixar volta ao trilho', async () => {
  render(<Fixture navegar={vi.fn()} />);
  const nav = document.querySelector('#app-shell-sidebar');
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Menu principal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Menu principal', exact: true }));
  fireEvent.mouseLeave(nav);
  expect(nav.getAttribute('data-pinned')).toBe('true');
  expect(nav.getAttribute('data-collapsed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Menu principal', exact: true }));
  expect(nav.getAttribute('data-pinned')).toBe('false');
  fireEvent.mouseLeave(nav);
  await waitFor(() => expect(nav.getAttribute('data-collapsed')).toBe('true'));
});
it('navega no menu temporário sem fixá-lo', () => {
  const navegar = vi.fn();
  render(<Fixture navegar={navegar} />);
  const nav = document.querySelector('#app-shell-sidebar');
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Menu principal' }));
  fireEvent.click(screen.getByRole('link', { name: 'Lotes' }));
  expect(navegar).toHaveBeenCalledWith('/cadastrolotes');
  expect(nav.getAttribute('data-pinned')).toBe('false');
});
