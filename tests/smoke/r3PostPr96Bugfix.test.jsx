/**
 * MAIKE-R3 — regressões pós PR #96.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { readFileSync } from 'node:fs';

import { persistirEmpresaSelecionada } from '@/hooks/useEmpresaSelecionadaId';
import { normalizeAppPathname } from '@/lib/navigation/normalizeAppPathname';
import { lerFiltrosMapaGeral } from '@/lib/mapaGeralFiltrosStorage';
import { queryClientInstance, resetAppQueryCache } from '@/lib/query-client';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const authState = {
  clienteId: 'tenant-1',
  user: { id: 'user-1', email: 'u@test' },
  isAuthenticated: true,
  logout: vi.fn(),
};

vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => authState,
}));

const listarUsuariosMock = vi.fn();
vi.mock('@/services/sessionService', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    listarUsuarios: (...a) => listarUsuariosMock(...a),
    listarPermissoes: vi.fn(async () => []),
    getCurrentUser: vi.fn(async () => ({ email: 'u@test', id: 'user-1' })),
  };
});

vi.mock('@/services/usuarioAdminService', () => ({
  listarContasAcesso: vi.fn(async () => []),
  criarContaAcesso: vi.fn(),
  atualizarContaAcesso: vi.fn(),
  validarPatchContaAcesso: vi.fn(),
}));

vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
}));

vi.mock('@/lib/googleMaps', () => ({
  loadGoogleMaps: () => Promise.reject(new Error('skip')),
  isGoogleMapsConfigured: () => false,
  GOOGLE_MAPS_MISSING_KEY_MESSAGE: 'Mapa indisponível (teste)',
}));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  listarUsuariosMock.mockReset();
  authState.clienteId = 'tenant-1';
});

afterEach(() => vi.unstubAllEnvs());

describe('R3-01 — empresa reativa', () => {
  it('Produtos, Setores e MapaGeral usam useEmpresaSelecionadaId', () => {
    for (const rel of ['src/pages/Produtos.jsx', 'src/pages/CadastroSetores.jsx', 'src/pages/MapaGeral.jsx']) {
      const src = readFileSync(rel, 'utf8');
      expect(src).toContain('useEmpresaSelecionadaId');
      expect(src).not.toMatch(/localStorage\.getItem\(['"]empresa_selecionada_id['"]\)/);
    }
  });

  it('persistirEmpresaSelecionada atualiza consumidores do hook na mesma aba', async () => {
    const { useEmpresaSelecionadaId } = await import('@/hooks/useEmpresaSelecionadaId');
    const { AuthProvider } = await import('@/lib/AuthContext');
    const Probe = () => {
      const id = useEmpresaSelecionadaId();
      return <span data-testid="empresa">{id || 'none'}</span>;
    };
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      persistirEmpresaSelecionada('empresa-a', 'tenant-1');
    });
    await waitFor(() => expect(screen.getByTestId('empresa')).toHaveTextContent('empresa-a'));
    await act(async () => {
      persistirEmpresaSelecionada('empresa-b', 'tenant-1');
    });
    await waitFor(() => expect(screen.getByTestId('empresa')).toHaveTextContent('empresa-b'));
  });
});

describe('R3-02 — sessão e cache', () => {
  it('resetAppQueryCache limpa dados do queryClientInstance', () => {
    queryClientInstance.setQueryData(['probe-r3'], [1]);
    resetAppQueryCache();
    expect(queryClientInstance.getQueryData(['probe-r3'])).toBeUndefined();
  });

  it('empresa de outro tenant não é reutilizada', async () => {
    localStorage.setItem('empresa_selecionada_id', 'empresa-antiga');
    localStorage.setItem('empresa_selecionada_cliente_id', 'tenant-antigo');
    authState.clienteId = 'tenant-novo';
    const { useEmpresaSelecionadaId } = await import('@/hooks/useEmpresaSelecionadaId');
    const { AuthProvider } = await import('@/lib/AuthContext');
    const Probe = () => <span data-testid="emp">{useEmpresaSelecionadaId() || 'none'}</span>;
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('emp')).toHaveTextContent('tenant-novo'));
  });
});

describe('R3-03 — shell App.jsx', () => {
  it('normalizeAppPathname cobre barra final e caixa', () => {
    expect(normalizeAppPathname('/Produtos/')).toBe('/produtos');
    expect(normalizeAppPathname('/PRODUTOS')).toBe('/produtos');
  });

  it('AppShell mantém Layout inclusive para 404 interno', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain("currentPageName || 'PageNotFound'");
    expect(app).toMatch(/<Route path="\*" element=\{<PageNotFound \/>} \/>/);
  });
});

describe('R3-04 — filtros Mapa Geral', () => {
  it('lerFiltrosMapaGeral tolera JSON inválido', () => {
    localStorage.setItem('mapa_geral_filtros_x', '{bad');
    expect(lerFiltrosMapaGeral('x')).toBeNull();
    localStorage.setItem('mapa_geral_filtros_x', JSON.stringify({ showLotes: false }));
    expect(lerFiltrosMapaGeral('x')).toEqual({ showLotes: false });
  });

  it('MapaGeral monta com storage corrompido', async () => {
    localStorage.setItem('mapa_geral_filtros_default', '<<<');
    const { default: MapaGeral } = await import('@/pages/MapaGeral');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { MemoryRouter } = await import('react-router-dom');
    await act(async () => {
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <MapaGeral />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    expect(document.querySelector('.relative.h-full')).toBeTruthy();
  });
});

describe('R3-05 — Usuarios erro vs restrito', () => {
  const renderUsuarios = async () => {
    const { default: Usuarios } = await import('@/pages/Usuarios');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Usuarios />
      </QueryClientProvider>,
    );
  };

  it('indisponibilidade exibe banner de erro', async () => {
    listarUsuariosMock.mockRejectedValue(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE));
    await renderUsuarios();
    await waitFor(() =>
      expect(screen.getByText(/indisponível|lista de usuários/i)).toBeInTheDocument(),
    );
  });

  it('REQUEST_REJECTED mantém tela sem banner de erro', async () => {
    listarUsuariosMock.mockRejectedValue(
      new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, { cause: { code: 'REQUEST_REJECTED' } }),
    );
    await renderUsuarios();
    await waitFor(() => expect(listarUsuariosMock).toHaveBeenCalled());
    expect(screen.queryByText(/Não foi possível carregar a lista de usuários/i)).toBeNull();
  });

  it('lista vazia real não exibe banner de erro', async () => {
    listarUsuariosMock.mockResolvedValue([]);
    await renderUsuarios();
    await waitFor(() => expect(listarUsuariosMock).toHaveBeenCalled());
    expect(screen.queryByText(/Não foi possível carregar a lista de usuários/i)).toBeNull();
  });
});

describe('R3-NAV — URL e conteúdo sincronizados', () => {
  const Pagina = ({ id }) => <div data-testid={`page-${id}`}>{id}</div>;

  const NavProbe = () => {
    const navigate = useNavigate();
    return (
      <div>
        <button type="button" onClick={() => navigate('/marcas')}>marcas</button>
        <button type="button" onClick={() => navigate('/produtos')}>produtos</button>
        <button type="button" onClick={() => navigate('/mapageral')}>mapa</button>
        <button type="button" onClick={() => navigate('/cadastrolotes')}>lotes</button>
      </div>
    );
  };

  it('MemoryRouter alterna pathname e conteúdo visível', async () => {
    render(
      <MemoryRouter initialEntries={['/cadastrolotes']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <NavProbe />
                <Routes>
                  <Route path="/cadastrolotes" element={<Pagina id="lotes" />} />
                  <Route path="/marcas" element={<Pagina id="marcas" />} />
                  <Route path="/produtos" element={<Pagina id="produtos" />} />
                  <Route path="/mapageral" element={<Pagina id="mapa" />} />
                </Routes>
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('page-lotes')).toBeInTheDocument();
    for (const [label, id] of [
      ['marcas', 'marcas'],
      ['produtos', 'produtos'],
      ['mapa', 'mapa'],
      ['lotes', 'lotes'],
    ]) {
      await act(async () => {
        screen.getByRole('button', { name: label }).click();
      });
      expect(await screen.findByTestId(`page-${id}`)).toBeInTheDocument();
    }
  });
});
