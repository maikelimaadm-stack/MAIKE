/**
 * PR #201 / R1 — escopo dos filtros do Mapa Geral com o componente MONTADO.
 *
 * Defeito: ao trocar de conta/empresa sem desmontar a página, um escopo SEM
 * preferência salva mantinha os estados React do escopo anterior — e os
 * gravava como seus. A herança da chave antiga por empresa copiava, para
 * QUALQUER conta, filtros de outra pessoa do mesmo aparelho. Sem `cliente_id`
 * ainda carregado, gravava numa chave com tenant "-".
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { persistirEmpresaSelecionada } from '@/hooks/useEmpresaSelecionadaId';
import { camadasVisiveis } from '@/lib/mapaGeralFiltrosStorage';

const sessao = vi.hoisted(() => ({ usuario: null, clienteIdAuth: 'tenant-1', permissoes: null }));

vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ clienteId: sessao.clienteIdAuth, isAuthenticated: true, logout: vi.fn() }),
}));
vi.mock('@/services/sessionService', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    getCurrentUser: vi.fn(async () => sessao.usuario),
    carregarPermissaoEfetiva: vi.fn(
      (u) => new Promise((ok) => setTimeout(() => ok(orig.permissaoEfetiva(u, sessao.permissoes ?? {
        user_email: u.login, is_admin: false, modulos_permitidos: ['mapa'],
        permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', visualizar: true }],
        mapa_geral_permissoes: {},
      })), 40))
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

const A = { id: 'u-a', login: 'ana', email: 'ana', cliente_id: 'tenant-1', administrador_fazenda: false };
const B = { id: 'u-b', login: 'bruno', email: 'bruno', cliente_id: 'tenant-1', administrador_fazenda: false };
const chave = (cliente, login, empresa) => `mapa_geral_filtros_u:${cliente}:${login}:${empresa}`;
const ler = (k) => JSON.parse(localStorage.getItem(k) || 'null');
/** Filtros que A deixou da última vez. */
const PREF_A = { showAreas: false, showLotes: false, showNomesAreas: false, filtroCategoria: 'BOI', filtroSetor: 'setor-9', modoColoracao: 'situacao_pasto' };
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 200)); });

let client;
const abrir = async () => {
  const { default: MapaGeral } = await import('@/pages/MapaGeral');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(<MemoryRouter><QueryClientProvider client={client}><MapaGeral /></QueryClientProvider></MemoryRouter>);
  });
  await assentar();
};
/** Troca a conta da sessão com a página MONTADA. */
const trocarConta = async (u) => {
  sessao.usuario = u;
  await act(async () => { await client.invalidateQueries(); });
  await assentar();
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  sessao.usuario = A;
  sessao.clienteIdAuth = 'tenant-1';
  sessao.permissoes = null;
});
afterEach(cleanup);

describe('ESCOPO — troca de conta/empresa sem desmontar o mapa', () => {
  it('A (filtros salvos) → B (sem preferência): B recebe o PADRÃO (Áreas, Detalhes, Lotes ligados), nada de A; A intacta', async () => {
    localStorage.setItem(chave('tenant-1', 'ana', 'emp-1'), JSON.stringify(PREF_A));
    await abrir();
    await trocarConta(B);
    const deB = ler(chave('tenant-1', 'bruno', 'emp-1'));
    expect(deB, 'B gravou a própria preferência (padrão)').toBeTruthy();
    expect(deB.showAreas).toBe(true);
    expect(deB.showNomesAreas).toBe(true);
    expect(deB.showLotes).toBe(true);
    expect(deB.filtroCategoria).toBe('todas');
    expect(deB.filtroSetor).toBe('todos');
    expect(deB.modoColoracao).toBe('padrao');
    expect(ler(chave('tenant-1', 'ana', 'emp-1'))).toMatchObject(PREF_A);
  });

  it('empresa 1 → empresa 2 (sem preferência): padrão; volta à empresa 1: preferências intactas e reaplicadas', async () => {
    localStorage.setItem(chave('tenant-1', 'ana', 'emp-1'), JSON.stringify(PREF_A));
    await abrir();
    await act(async () => { persistirEmpresaSelecionada('emp-2', 'tenant-1'); });
    await assentar();
    const emp2 = ler(chave('tenant-1', 'ana', 'emp-2'));
    expect(emp2?.showAreas).toBe(true);
    expect(emp2?.filtroCategoria).toBe('todas');
    await act(async () => { persistirEmpresaSelecionada('emp-1', 'tenant-1'); });
    await assentar();
    expect(ler(chave('tenant-1', 'ana', 'emp-1'))).toMatchObject(PREF_A);
  });

  it('mesmo login em outro tenant: isolado; sem tenant conhecido NÃO grava em chave compartilhada ("-")', async () => {
    localStorage.setItem(chave('tenant-1', 'ana', 'emp-1'), JSON.stringify(PREF_A));
    sessao.usuario = { ...A, cliente_id: undefined };
    sessao.clienteIdAuth = undefined;
    await abrir();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('mapa_geral_filtros_u:-:'))).toEqual([]);
    expect(Object.keys(localStorage).filter((k) => k.includes(':ana:') && !k.startsWith('mapa_geral_filtros_u:tenant-1:'))).toEqual([]);
    await trocarConta({ ...A, cliente_id: 'tenant-2' });
    const outroTenant = ler(chave('tenant-2', 'ana', 'emp-1'));
    expect(outroTenant?.filtroCategoria).toBe('todas');
    expect(outroTenant?.showLotes).toBe(true);
    expect(ler(chave('tenant-1', 'ana', 'emp-1'))).toMatchObject(PREF_A);
  });

  it('legado por empresa (sem titular verificável) NÃO é copiado para nenhuma conta; a chave antiga não é apagada', async () => {
    localStorage.setItem('mapa_geral_filtros_emp-1', JSON.stringify(PREF_A));
    sessao.usuario = B;
    await abrir();
    const deB = ler(chave('tenant-1', 'bruno', 'emp-1'));
    expect(deB?.filtroCategoria).toBe('todas');
    expect(deB?.showLotes).toBe(true);
    expect(ler('mapa_geral_filtros_emp-1')).toEqual(PREF_A);
  });

  it('permissão atrasada não apaga preferência; camada proibida não aparece mesmo preferida', async () => {
    localStorage.setItem(chave('tenant-1', 'ana', 'emp-1'), JSON.stringify({ showAreas: true, showLotes: true, filtroCategoria: 'VACA' }));
    sessao.permissoes = {
      user_email: 'ana', is_admin: false, modulos_permitidos: ['mapa'],
      permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', visualizar: true }],
      mapa_geral_permissoes: { visualizar_lotes: false },
    };
    await abrir();
    expect(ler(chave('tenant-1', 'ana', 'emp-1'))).toMatchObject({ showAreas: true, showLotes: true, filtroCategoria: 'VACA' });
    const vis = camadasVisiveis({ showAreas: true, showLotes: true }, { visualizar_areas: true, visualizar_lotes: false });
    expect(vis.showAreas).toBe(true);
    expect(vis.showLotes).toBe(false);
  });
});
