/**
 * D-PROD-145 — grupo "Gestão Rural" no menu e no gerenciador de permissões.
 *
 *  - SSOT: menu, páginas e manifesto de escopo têm exatamente as três telas;
 *  - o menu (shell real, Layout) mostra o grupo só para quem tem alguma das telas;
 *  - padrão para não-admin = NEGADO (sem concessão automática); admin vê tudo;
 *  - a tela Permissões lista as três telas com as ações, desligadas por padrão;
 *  - a regra de botões é a mesma do servidor (novo|salvar, editar|salvar).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { readFileSync } from 'node:fs';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: [] }));

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));
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

import { DEFAULT_MENU, getMenuModules } from '@/lib/menuConfig';
import { PAGES } from '@/pages.config';
import { canAccessPage, createRestrictedPagePermission } from '@/lib/permissions';
import { acoesDaTelaGestao, TELAS_GESTAO } from '@/lib/gestaoPermissions';

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', administrador_fazenda: false, cliente_id: 'fazenda-1' };
const admin = { ...operador, id: 'u-adm', login: 'dono', email: 'dono', administrador_fazenda: true };

const tela = (modulo_id, tela_id, acoes = {}) => ({
  modulo_id, tela_id, visualizar: false, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes,
});
const registro = (modulos, telas) => ({ id: 'p1', user_email: 'vaqueiro', is_admin: false, modulos_permitidos: modulos, permissoes_telas: telas, mobile_menu_ids: [] });

const renderShell = async () => {
  const { default: Layout } = await import('@/Layout');
  const { AuthProvider } = await import('@/lib/AuthContext');
  const { BootSplashProvider } = await import('@/lib/bootSplashContext');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/mapageral']}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BootSplashProvider>
              <Routes>
                <Route path="*" element={<Layout currentPageName="MapaGeral"><div data-testid="pagina" /></Layout>} />
              </Routes>
            </BootSplashProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'empresa-smoke');
  sessao.usuario = operador;
  sessao.permissoes = [];
});

describe('GES-M1 — SSOT de menu, páginas e escopo', () => {
  it('grupo gestao-rural com exatamente as três telas', () => {
    const grupo = DEFAULT_MENU.find((m) => m.id === 'gestao-rural');
    expect(grupo.title).toBe('Gestão Rural');
    expect(grupo.submenu).toEqual([
      { id: 'ges-parceiros', title: 'Parceiros', url: 'Parceiros' },
      { id: 'ges-centros-custo', title: 'Centros de Custo', url: 'CentrosCusto' },
      { id: 'ges-centros-resultado', title: 'Centros de Resultado', url: 'CentrosResultado' },
    ]);
    for (const p of ['Parceiros', 'CentrosCusto', 'CentrosResultado']) expect(typeof PAGES[p]).toBe('function');
  });

  it('manifesto: páginas permitidas; demais domínios e a entidade Base44 continuam proibidos', () => {
    const scope = JSON.parse(readFileSync('config/mapa-manejo-scope.json', 'utf8'));
    expect(scope.allowedPages).toEqual(expect.arrayContaining(['Parceiros', 'CentrosCusto', 'CentrosResultado']));
    expect(scope.forbiddenDomains).not.toContain('CentrosCusto');
    for (const d of ['Fornecedores', 'Financeiro', 'PlanoContas', 'LancamentoFinanceiro', 'FluxoCaixa', 'MovimentacoesEstoque']) {
      expect(scope.forbiddenDomains).toContain(d);
    }
    expect(scope.forbiddenBase44Entities).toContain('CentroCusto');
    expect(scope.allowedBase44Entities).not.toContain('CentroCusto');
  });
});

describe('GES-M2 — regra de ações igual à do servidor; padrão negado', () => {
  const comAcoes = (acoes) => registro(['gestao-rural'], [tela('gestao-rural', TELAS_GESTAO.PARCEIROS, { visualizar: true, ...acoes })]);
  it('visualizar só vê; novo|salvar cria; editar|salvar edita', () => {
    expect(acoesDaTelaGestao(comAcoes({}), TELAS_GESTAO.PARCEIROS)).toEqual({ ver: true, criar: false, editar: false });
    expect(acoesDaTelaGestao(comAcoes({ novo: true }), TELAS_GESTAO.PARCEIROS)).toEqual({ ver: true, criar: true, editar: false });
    expect(acoesDaTelaGestao(comAcoes({ editar: true }), TELAS_GESTAO.PARCEIROS)).toEqual({ ver: true, criar: false, editar: true });
    expect(acoesDaTelaGestao(comAcoes({ salvar: true }), TELAS_GESTAO.PARCEIROS)).toEqual({ ver: true, criar: true, editar: true });
    // `excluir` não dá inativar: o servidor não tem DELETE e inativar é edição.
    expect(acoesDaTelaGestao(comAcoes({ excluir: true }), TELAS_GESTAO.PARCEIROS).editar).toBe(false);
  });

  it('sem registro / sem módulo / sem linha → nada; is_admin → tudo', () => {
    expect(acoesDaTelaGestao(null, TELAS_GESTAO.CENTROS_CUSTO)).toEqual({ ver: false, criar: false, editar: false });
    expect(acoesDaTelaGestao(registro([], [tela('gestao-rural', TELAS_GESTAO.CENTROS_CUSTO, { visualizar: true })]), TELAS_GESTAO.CENTROS_CUSTO).ver).toBe(false);
    expect(acoesDaTelaGestao(registro(['gestao-rural'], []), TELAS_GESTAO.CENTROS_CUSTO).ver).toBe(false);
    expect(acoesDaTelaGestao({ user_email: 'x', is_admin: true }, TELAS_GESTAO.CENTROS_RESULTADO)).toEqual({ ver: true, criar: true, editar: true });
  });

  it('permissão restrita criada pelo gerenciador vem toda desligada', () => {
    const mod = getMenuModules(DEFAULT_MENU).find((m) => m.id === 'gestao-rural');
    for (const page of mod.pages) {
      const p = createRestrictedPagePermission(mod.id, mod.title, page);
      expect(p.modulo_id).toBe('gestao-rural');
      expect(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar'].every((a) => p[a] === false)).toBe(true);
      expect(canAccessPage(registro(['gestao-rural'], [p]), page.id, 'gestao-rural')).toBe(false);
    }
  });
});

describe('GES-M3 — menu do shell real', () => {
  it('quem tem só Parceiros vê o grupo com Parceiros e sem os Centros', async () => {
    sessao.permissoes = [
      registro(['mapa', 'gestao-rural'], [tela('mapa', 'pec-mapa-geral', { visualizar: true }), tela('gestao-rural', 'ges-parceiros', { visualizar: true })]),
    ];
    await renderShell();
    expect((await screen.findAllByText('Gestão Rural')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Parceiros').length).toBeGreaterThan(0);
    expect(screen.queryByText('Centros de Custo')).toBeNull();
    expect(screen.queryByText('Centros de Resultado')).toBeNull();
  });

  it('quem não tem nenhuma das telas não vê o grupo (padrão negado)', async () => {
    sessao.permissoes = [registro(['mapa', 'gestao-rural'], [tela('mapa', 'pec-mapa-geral', { visualizar: true })])];
    await renderShell();
    await screen.findByTestId('pagina');
    expect(screen.queryByText('Gestão Rural')).toBeNull();
    expect(screen.queryByText('Parceiros')).toBeNull();
  });

  it('administrador da fazenda vê o grupo e as três telas', async () => {
    sessao.usuario = admin;
    await renderShell();
    expect((await screen.findAllByText('Gestão Rural')).length).toBeGreaterThan(0);
    for (const t of ['Parceiros', 'Centros de Custo', 'Centros de Resultado']) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
  });
});

describe('GES-M4 — tela Permissões lista as três telas com as ações', () => {
  it('módulo Gestão Rural aparece no gerenciador com as telas e ações desligadas', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const { default: FormularioUsuario } = await import('@/components/usuarios/FormularioUsuario');
    render(<FormularioUsuario onSubmit={() => {}} onCancel={() => {}} initialData={null} usuarios={[]} />);
    const rotuloModulo = screen.getByText('Gestão Rural', { selector: 'span' });
    const caixaModulo = within(rotuloModulo.closest('label')).getByRole('checkbox');
    expect(caixaModulo.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      caixaModulo.click();
    });
    for (const t of ['Parceiros', 'Centros de Custo', 'Centros de Resultado']) {
      const cartao = screen.getByText(t, { selector: 'p.font-semibold' }).closest('.rounded-lg');
      const caixas = within(cartao).getAllByRole('checkbox');
      // visualizar + 6 ações (novo, salvar, editar, excluir, importar, exportar), todas desligadas
      expect(caixas).toHaveLength(7);
      expect(caixas.every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true);
      expect(within(cartao).getByText('NOVO')).toBeTruthy();
      expect(within(cartao).getByText('EDITAR')).toBeTruthy();
    }
  });
});
