/**
 * Mapa Geral — preferências de camadas e filtros POR USUÁRIO, mantidas entre acessos.
 *
 * Defeito: ao abrir o mapa, a permissão ainda carregando vale "nada liberado";
 * um efeito DESLIGAVA Áreas, Detalhes Áreas, Lotes… e o efeito de gravação
 * salvava isso por cima da preferência. Todo acesso começava "limpo".
 * Agora: preferência (o que o usuário escolheu) ≠ o que aparece (preferência
 * E permissão); só grava depois de carregar a preferência DESTE usuário; chave
 * fazenda + conta + empresa.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';

import { lerFiltrosMapaGeral, salvarFiltrosMapaGeral, chaveFiltrosDoUsuario } from '@/lib/mapaGeralFiltrosStorage';

const sessao = vi.hoisted(() => ({ usuario: null, atrasoPermissao: 50 }));

vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ clienteId: 'tenant-1', isAuthenticated: true, logout: vi.fn() }),
}));
vi.mock('@/services/sessionService', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    getCurrentUser: vi.fn(async () => sessao.usuario),
    // Permissão chega DEPOIS da primeira renderização (como na vida real).
    carregarPermissaoEfetiva: vi.fn(
      (u) => new Promise((ok) => setTimeout(() => ok(orig.permissaoEfetiva(u, {
        user_email: u.login, is_admin: false, modulos_permitidos: ['mapa'],
        permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', visualizar: true }],
        mapa_geral_permissoes: {},
      })), sessao.atrasoPermissao))
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
/** O que o usuário escolheu no acesso anterior. */
const PREFERENCIA = { showAreas: true, showNomesAreas: false, showLotes: true, showHectaresAreas: false, filtroCategoria: 'BOI', filtroSetor: 'setor-2', modoColoracao: 'situacao_pasto' };

const abrirMapa = async () => {
  const { default: MapaGeral } = await import('@/pages/MapaGeral');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(<MemoryRouter><QueryClientProvider client={client}><MapaGeral /></QueryClientProvider></MemoryRouter>);
  });
  // deixa a permissão chegar e os efeitos assentarem
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  sessao.usuario = OPERADOR;
});
afterEach(cleanup);

describe('MAPA-FILTROS — a preferência do usuário sobrevive ao acesso', () => {
  it('reabrir o mapa NÃO apaga as camadas e filtros salvos (permissão carregando não grava "desligado")', async () => {
    salvarFiltrosMapaGeral(ESCOPO, PREFERENCIA);
    await abrirMapa();
    const salvo = lerFiltrosMapaGeral(ESCOPO);
    for (const [k, v] of Object.entries(PREFERENCIA)) expect(salvo?.[k], k).toEqual(v);
  });

  it('primeiro acesso de um usuário herda a preferência antiga do aparelho (sem começar limpo) e passa a ter a sua', async () => {
    localStorage.setItem('mapa_geral_filtros_emp-1', JSON.stringify(PREFERENCIA));
    await abrirMapa();
    const proprio = JSON.parse(localStorage.getItem(chaveFiltrosDoUsuario(ESCOPO)) || 'null');
    expect(proprio?.filtroCategoria).toBe('BOI');
    expect(proprio?.showNomesAreas).toBe(false);
    expect(proprio?.showAreas).toBe(true);
  });

  it('cada usuário tem a sua: a preferência de um não muda a do outro', async () => {
    const OUTRO = { ...ESCOPO, login: 'gerente' };
    salvarFiltrosMapaGeral(ESCOPO, PREFERENCIA);
    salvarFiltrosMapaGeral(OUTRO, { showLotes: false, filtroCategoria: 'VACA' });
    await abrirMapa();
    expect(lerFiltrosMapaGeral(OUTRO)).toEqual({ showLotes: false, filtroCategoria: 'VACA' });
    expect(lerFiltrosMapaGeral(ESCOPO)?.filtroCategoria).toBe('BOI');
    expect(chaveFiltrosDoUsuario(ESCOPO)).not.toBe(chaveFiltrosDoUsuario(OUTRO));
    expect(chaveFiltrosDoUsuario(ESCOPO)).not.toBe(chaveFiltrosDoUsuario({ ...ESCOPO, clienteId: 'tenant-2' }));
  });

  it('o que aparece é preferência E permissão; a permissão nunca reescreve a preferência', () => {
    const fonte = readFileSync('src/pages/MapaGeral.jsx', 'utf8');
    expect(fonte).toContain('const showAreas = prefShowAreas && mapaGeralPermissions.visualizar_areas;');
    expect(fonte).toContain('const showLotes = prefShowLotes && mapaGeralPermissions.visualizar_lotes;');
    expect(fonte).not.toContain('setShowAreas(false)');
    expect(fonte).not.toContain('setShowLotes(false)');
    expect(fonte).not.toContain('setShowNomesAreas(false)');
    expect(fonte).toContain('if (!escopoFiltros || filtrosCarregados !== escopoFiltros.chave) return;');
  });
});
