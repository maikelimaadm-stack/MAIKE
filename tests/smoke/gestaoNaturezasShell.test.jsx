/**
 * D-PROD-152 — Naturezas Financeiras dentro do shell real (Layout):
 *  - a tela declara `permissaoExplicita`: o ✓ Salvar do cabeçalho do celular
 *    segue a regra do servidor (editar OU salvar) e quem só tem "editar" grava;
 *  - deep link `/naturezasfinanceiras` (mesma convenção de `/parceiros`).
 * Mocks só da borda: `fetch` (backend falso) e a sessão (`@/apis/session`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { API_FAKE, envelope, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: [] }));

vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
  warmMapaCache: () => Promise.resolve(),
  esquecerCacheDoTenant: () => Promise.resolve(),
  CACHE_KEYS: [],
}));
vi.mock('@/apis/session', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => sessao.usuario),
  listPermissoes: vi.fn(async () => sessao.permissoes),
}));

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', administrador_fazenda: false, cliente_id: 'fazenda-1' };
const soEditar = {
  id: 'p1', user_email: 'vaqueiro', is_admin: false, modulos_permitidos: ['gestao-rural'], mobile_menu_ids: [],
  permissoes_telas: [{ modulo_id: 'gestao-rural', tela_id: 'ges-naturezas-financeiras', visualizar: true, novo: false, salvar: false, editar: true, excluir: false, importar: false, exportar: false }],
};
const ENERGIA = {
  id: 'n4', empresa_id: 'emp-1', numero: '4', tipo: 'DESPESA', nome: 'ENERGIA', descricao: null, pai_id: null, pai_nome: null,
  caminho: 'ENERGIA', nivel: 1, ativo: true, created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-01T00:00:00Z',
};

let backend;

const renderShell = async () => {
  const { default: Layout } = await import('@/Layout');
  const { default: NaturezasFinanceiras } = await import('@/pages/NaturezasFinanceiras');
  const { AuthProvider } = await import('@/lib/AuthContext');
  const { BootSplashProvider } = await import('@/lib/bootSplashContext');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/naturezasfinanceiras']}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BootSplashProvider>
              <Routes>
                <Route path="*" element={<Layout currentPageName="NaturezasFinanceiras"><NaturezasFinanceiras /></Layout>} />
              </Routes>
            </BootSplashProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
};

beforeEach(async () => {
  cleanup();
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  localStorage.setItem('empresa_selecionada_cliente_id', 'fazenda-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.usuario = operador;
  sessao.permissoes = [soEditar];
  backend = instalarBackendFake(({ method, path, body }) => {
    if (method === 'GET' && path === '/naturezas-financeiras') return { status: 200, body: envelope([ENERGIA]) };
    if (method === 'PATCH' && path === '/naturezas-financeiras/n4') return { status: 200, body: { ...ENERGIA, nome: body.nome ?? ENERGIA.nome } };
    if (method === 'GET') return { status: 200, body: [] };
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Naturezas no shell — ✓ Salvar do cabeçalho do celular (permissaoExplicita)', () => {
  it('quem só tem "editar" salva pelo ✓ do cabeçalho; o botão carrega data-permissao-explicita', async () => {
    await renderShell();
    const celula = await screen.findByTestId('natureza-caminho-n4', {}, { timeout: 3000 });
    expect(celula.closest('[data-permissao-explicita]')).toBeTruthy();
    fireEvent.doubleClick(celula);
    await waitFor(() => expect(screen.getByTestId('b1-form')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'luz' } });
    const botao = await vi.waitFor(() => {
      const b = document.querySelector('.mk-mhdr__round--salvar');
      if (!b) throw new Error('sem ✓');
      return b;
    });
    expect(botao.hasAttribute('data-permissao-explicita')).toBe(true);
    await act(async () => {
      fireEvent.click(botao);
    });
    expect(screen.queryAllByText(/Ação bloqueada/i)).toHaveLength(0);
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === 'PATCH')).toBe(true));
    expect(backend.chamadas.find((c) => c.method === 'PATCH').body).toEqual({ empresa_id: 'emp-1', nome: 'LUZ' });
  });
});
