import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Nenhuma chamada real à Base44 ─────────────────────────────────────────
vi.mock('@/api/base44Client', async () => {
  const { createBase44Stub } = await import('./base44Stub.js');
  return { base44: createBase44Stub() };
});

// O cache offline usa IndexedDB, que não existe no jsdom. Desde a P1.2 a
// política vive em `@/services/mapaCacheService`; o arquivo antigo não existe
// mais e não há shim com o nome anterior.
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
  warmMapaCache: () => Promise.resolve(),
}));

const wrapper = ({ children }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'empresa-smoke');
});

describe('MapaGeral — superfície primária', () => {
  it('sem chave do Google Maps, mostra fallback controlado e não fica em branco', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    const { default: MapaGeral } = await import('@/pages/MapaGeral');

    const { container } = render(<MapaGeral />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Mapa indisponível')).toBeInTheDocument();
    });

    expect(screen.getByText(/VITE_GOOGLE_MAPS_API_KEY/)).toBeInTheDocument();
    // Tela branca = container sem conteúdo. Aqui há árvore renderizada.
    expect(container.textContent.trim().length).toBeGreaterThan(0);
    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
  });

  it('a mensagem de fallback não vaza nenhuma chave', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    const { default: MapaGeral } = await import('@/pages/MapaGeral');
    const { container } = render(<MapaGeral />, { wrapper });

    await waitFor(() => expect(screen.getByText('Mapa indisponível')).toBeInTheDocument());
    expect(container.innerHTML).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });
});

describe('MapaCadastro — editor geográfico', () => {
  it('inicializa com o SDK do Google Maps mockado', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'chave-de-teste');

    const listener = { remove: vi.fn() };
    const mapsStub = {
      Map: vi.fn(() => ({
        addListener: vi.fn(() => listener),
        setOptions: vi.fn(),
        fitBounds: vi.fn(),
        getZoom: vi.fn(() => 15),
        setZoom: vi.fn(),
        getProjection: vi.fn(() => null),
      })),
      OverlayView: class {
        setMap() {}
        getPanes() {
          return { overlayLayer: document.createElement('div') };
        }
        getProjection() {
          return null;
        }
      },
      Marker: vi.fn(() => ({ setMap: vi.fn(), addListener: vi.fn(), setIcon: vi.fn() })),
      Polygon: vi.fn(() => ({ setMap: vi.fn(), addListener: vi.fn(), setOptions: vi.fn() })),
      Polyline: vi.fn(() => ({ setMap: vi.fn(), addListener: vi.fn() })),
      LatLngBounds: vi.fn(() => ({ extend: vi.fn(), isEmpty: () => true })),
      LatLng: vi.fn(),
      Size: vi.fn(),
      Point: vi.fn(),
      SymbolPath: { CIRCLE: 0 },
      geometry: { spherical: { computeDistanceBetween: vi.fn(() => 0) } },
      drawing: {},
      event: { addListenerOnce: vi.fn(), removeListener: vi.fn(), clearInstanceListeners: vi.fn() },
    };
    vi.stubGlobal('google', { maps: mapsStub });
    window.google = { maps: mapsStub };

    const { default: MapaCadastro } = await import('@/pages/MapaCadastro');
    const { container } = render(<MapaCadastro />, { wrapper });

    await waitFor(() => {
      expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
    });

    delete window.google;
  });
});

describe('App — montagem completa', () => {
  it('monta com autenticação e providers mockados', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');

    vi.doMock('@/lib/AuthContext', () => ({
      AuthProvider: ({ children }) => <>{children}</>,
      useAuth: () => ({
        isLoadingAuth: false,
        isLoadingPublicSettings: false,
        authError: null,
        navigateToLogin: vi.fn(),
      }),
    }));

    const { default: App } = await import('@/App');
    const { container } = render(<App />);

    await waitFor(() => {
      expect(container.querySelectorAll('*').length).toBeGreaterThan(5);
    });

    expect(container.innerHTML).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    vi.doUnmock('@/lib/AuthContext');
  });
});
