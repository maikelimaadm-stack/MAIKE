/**
 * D-PROD-230 — o Mapa Geral aplica o filtro pedido pelo Assistente (`?af=`): substitui
 * os filtros (o que não vier fica sem restrição), depois de carregar a preferência do
 * usuário, tira o parâmetro da URL e respeita a permissão de filtros do mapa.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { lerFiltrosMapaGeral, salvarFiltrosMapaGeral } from '@/lib/mapaGeralFiltrosStorage';

const sessao = vi.hoisted(() => ({ usuario: null, permissoesMapa: {} }));
const avisos = vi.hoisted(() => ({ sucesso: [], alerta: [] }));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: (m) => avisos.sucesso.push(m),
    warning: (m) => avisos.alerta.push(m),
    error: vi.fn(),
    info: vi.fn(),
  }),
  Toaster: () => null,
}));
vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ clienteId: 'tenant-1', isAuthenticated: true, logout: vi.fn() }),
}));
vi.mock('@/services/sessionService', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    getCurrentUser: vi.fn(async () => sessao.usuario),
    carregarPermissaoEfetiva: vi.fn(
      (u) => new Promise((ok) => setTimeout(() => ok(((x) => { return x; })(orig.permissaoEfetiva(u, {
        user_email: u.login, is_admin: false, modulos_permitidos: ['mapa'],
        permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', visualizar: true }],
        mapa_geral_permissoes: sessao.permissoesMapa,
      }))), 20))
    ),
  };
});
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
}));
vi.mock('@/lib/googleMaps', () => ({
  loadGoogleMaps: () => Promise.reject(new Error('skip')),
  isGoogleMapsConfigured: () => false,
  GOOGLE_MAPS_MISSING_KEY_MESSAGE: 'Mapa indisponível (teste)',
}));

const OPERADOR = { id: 'u-1', login: 'vaqueiro', email: 'vaqueiro', cliente_id: 'tenant-1', administrador_fazenda: false };
const ESCOPO = { clienteId: 'tenant-1', login: 'vaqueiro', empresaId: 'emp-1' };

const abrirMapaCom = async (filtros) => {
  window.history.replaceState(null, '', `/mapageral?af=${encodeURIComponent(JSON.stringify(filtros))}`);
  const { default: MapaGeral } = await import('@/pages/MapaGeral');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(<MemoryRouter><QueryClientProvider client={client}><MapaGeral /></QueryClientProvider></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 1000)); });
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  sessao.usuario = OPERADOR;
  avisos.sucesso.length = 0;
  avisos.alerta.length = 0;
});
afterEach(cleanup);

describe('Mapa Geral — filtro do Assistente', () => {
  it('substitui os filtros salvos pelos do assistente e tira o parâmetro da URL', async () => {
    // Administrador da fazenda: acesso total ao mapa, sem esperar a permissão da conta.
    sessao.usuario = { ...OPERADOR, administrador_fazenda: true };
    salvarFiltrosMapaGeral(ESCOPO, { filtroCategoria: 'BOI', filtroSetor: 'setor-2', modoColoracao: 'padrao', showLotes: false });
    await abrirMapaCom({ tipos_cultura: ['Pastagem'], peso_min: 300, colorir_por: 'ua_ha', invalida: 1 });
    const salvo = lerFiltrosMapaGeral(ESCOPO);
    expect(salvo?.filtroTipoCultura).toEqual(['Pastagem']);
    expect(salvo?.filtroPesoMin).toBe(300);
    expect(salvo?.filtroPesoMax).toBe(null);
    expect(salvo?.modoColoracao).toBe('ua_ha');
    expect(salvo?.filtroCategoria).toBe('todas');
    expect(salvo?.filtroSetor).toBe('todos');
    expect(salvo?.showLotes).toBe(true);
    expect(window.location.search).toBe('');
    expect(avisos.sucesso).toContain('Filtro do assistente aplicado no mapa');
  });

  it('operador sem permissão de filtros: não aplica', async () => {
    sessao.permissoesMapa = { visualizar_filtros_camadas: false, visualizar_areas: true };
    salvarFiltrosMapaGeral(ESCOPO, { filtroCategoria: 'BOI' });
    await abrirMapaCom({ peso_min: 300 });
    expect(lerFiltrosMapaGeral(ESCOPO)?.filtroCategoria).toBe('BOI');
    expect(lerFiltrosMapaGeral(ESCOPO)?.filtroPesoMin ?? null).toBe(null);
    expect(avisos.sucesso).toEqual([]);
  });
});
