/**
 * D-PROD-146 — grupo "Gestão Rural" no menu e no gerenciador de permissões.
 *
 *  - SSOT: menu, páginas e manifesto de escopo têm exatamente as cinco telas
 *    (P1: Parceiros e Centros, D-PROD-146; P2: Naturezas Financeiras, D-PROD-153;
 *    P3-01: Lançamentos Financeiros, D-PROD-155 — página NATIVA autorizada; os
 *    domínios legados `Financeiro`/`LancamentoFinanceiro`… continuam proibidos);
 *  - o menu (shell real, Layout) mostra o grupo só para quem tem alguma das telas;
 *  - padrão para não-admin = NEGADO (sem concessão automática); admin vê tudo;
 *  - a tela Permissões lista as cinco telas com as ações, desligadas por padrão
 *    (a Central de Lançamentos tem 4 ações extras, só nela);
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
import { canAccessPage, createRestrictedPagePermission, detectPermissionAction, EXTRA_ACTION_KEYS_BY_PAGE } from '@/lib/permissions';
import { acoesDaTelaGestao, ACOES_EXTRAS_LANCAMENTOS, TELAS_GESTAO } from '@/lib/gestaoPermissions';

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
  it('grupo gestao-rural com exatamente as cinco telas', () => {
    const grupo = DEFAULT_MENU.find((m) => m.id === 'gestao-rural');
    expect(grupo.title).toBe('Gestão Rural');
    expect(grupo.submenu).toEqual([
      { id: 'ges-parceiros', title: 'Parceiros', url: 'Parceiros' },
      { id: 'ges-centros-custo', title: 'Centros de Custo', url: 'CentrosCusto' },
      { id: 'ges-centros-resultado', title: 'Centros de Resultado', url: 'CentrosResultado' },
      { id: 'ges-naturezas-financeiras', title: 'Naturezas Financeiras', url: 'NaturezasFinanceiras' },
      { id: 'ges-lancamentos-financeiros', title: 'Lançamentos Financeiros', url: 'LancamentosFinanceiros' },
    ]);
    for (const p of ['Parceiros', 'CentrosCusto', 'CentrosResultado', 'NaturezasFinanceiras', 'LancamentosFinanceiros']) expect(typeof PAGES[p]).toBe('function');
    expect(TELAS_GESTAO.NATUREZAS_FINANCEIRAS).toBe('ges-naturezas-financeiras');
    expect(TELAS_GESTAO.LANCAMENTOS_FINANCEIROS).toBe('ges-lancamentos-financeiros');
    // O singular "Financeiro" (domínio legado proibido) não aparece em título nem url do menu.
    expect(grupo.submenu.some((t) => /\bFinanceiro\b/.test(t.title) || /\bFinanceiro\b/.test(t.url))).toBe(false);
  });

  it('manifesto: páginas permitidas; demais domínios e a entidade Base44 continuam proibidos', () => {
    const scope = JSON.parse(readFileSync('config/mapa-manejo-scope.json', 'utf8'));
    expect(scope.allowedPages).toEqual(expect.arrayContaining(['Parceiros', 'CentrosCusto', 'CentrosResultado', 'NaturezasFinanceiras', 'LancamentosFinanceiros']));
    expect(scope.forbiddenDomains).not.toContain('CentrosCusto');
    // D-PROD-153/154: as fases só ganham páginas nativas; os domínios financeiros legados continuam proibidos.
    for (const d of [
      'Fornecedores', 'Financeiro', 'PlanoContas', 'GruposFinanceiros', 'ContasFinanceiras', 'CaixaBancos',
      'LancamentoFinanceiro', 'FluxoCaixa', 'MovimentacoesEstoque', 'FormasPagamento', 'LancamentoProdutosEstoque', 'LivroCaixa',
    ]) {
      expect(scope.forbiddenDomains).toContain(d);
    }
    expect(scope.forbiddenDomains).not.toContain('LancamentosFinanceiros');
    expect(scope.forbiddenBase44Entities).toContain('CentroCusto');
    for (const e of ['LancamentoFinanceiro', 'BaixaFinanceira', 'FormaPagamento', 'ContaFinanceira']) expect(scope.forbiddenBase44Entities).toContain(e);
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

  it('permissão restrita criada pelo gerenciador vem toda desligada (inclusive as 4 ações extras da Central)', () => {
    const mod = getMenuModules(DEFAULT_MENU).find((m) => m.id === 'gestao-rural');
    for (const page of mod.pages) {
      const p = createRestrictedPagePermission(mod.id, mod.title, page);
      expect(p.modulo_id).toBe('gestao-rural');
      expect(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar'].every((a) => p[a] === false)).toBe(true);
      expect(canAccessPage(registro(['gestao-rural'], [p]), page.id, 'gestao-rural')).toBe(false);
      const extras = ['confirmar', 'liquidar', 'estornar_liquidacao', 'cancelar'];
      if (page.id === 'ges-lancamentos-financeiros') expect(extras.every((a) => p[a] === false)).toBe(true);
      else expect(extras.some((a) => a in p)).toBe(false);
    }
  });

  it('Central de Lançamentos: cada ação extra exige a SUA chave (sem atalho por salvar/editar); is_admin libera', () => {
    const T = TELAS_GESTAO.LANCAMENTOS_FINANCEIROS;
    const com = (acoes) => registro(['gestao-rural'], [tela('gestao-rural', T, { visualizar: true, ...acoes })]);
    expect(acoesDaTelaGestao(com({ salvar: true, editar: true }), T)).toEqual({ ver: true, criar: true, editar: true, confirmar: false, liquidar: false, estornar: false, cancelar: false });
    expect(acoesDaTelaGestao(com({ confirmar: true }), T)).toMatchObject({ criar: false, editar: false, confirmar: true, liquidar: false });
    expect(acoesDaTelaGestao(com({ estornar_liquidacao: true }), T)).toMatchObject({ estornar: true, cancelar: false });
    expect(acoesDaTelaGestao({ user_email: 'x', is_admin: true }, T)).toEqual({ ver: true, criar: true, editar: true, confirmar: true, liquidar: true, estornar: true, cancelar: true });
    // As outras telas não ganham chaves novas.
    expect(acoesDaTelaGestao(com({}), TELAS_GESTAO.PARCEIROS)).toEqual({ ver: false, criar: false, editar: false });
    expect(EXTRA_ACTION_KEYS_BY_PAGE[T]).toEqual(Object.values(ACOES_EXTRAS_LANCAMENTOS));
    // "Confirmar…" seria lido pela heurística do Layout como "salvar": por isso a tela usa permissão explícita.
    expect(detectPermissionAction('Confirmar lançamento')).toBe('salvar');
  });

  it('paridade com o servidor: as ações extras do front são exatamente as de GUARDAS.operacaoFinanceira', () => {
    const fonte = readFileSync('backend/src/shared/auth/guardasRotas.js', 'utf8');
    const inicio = fonte.indexOf('operacaoFinanceira');
    expect(inicio, 'GUARDAS.operacaoFinanceira ausente em guardasRotas.js').toBeGreaterThan(-1);
    const trecho = fonte.slice(inicio, fonte.indexOf('}', fonte.indexOf('estornarLiquidacao', inicio)) + 1);
    const acoes = [...trecho.matchAll(/porTela\(\s*T\.LANCAMENTOS_FINANCEIROS\s*,\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1]);
    const extrasServidor = acoes.filter((a) => !['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar'].includes(a));
    expect([...new Set(extrasServidor)].sort()).toEqual([...EXTRA_ACTION_KEYS_BY_PAGE['ges-lancamentos-financeiros']].sort());
    const telas = readFileSync('backend/src/shared/auth/autorizacaoTela.js', 'utf8');
    expect(telas).toMatch(/LANCAMENTOS_FINANCEIROS:\s*(?:Object\.freeze\()?\{\s*modulo:\s*'gestao-rural',\s*tela:\s*'ges-lancamentos-financeiros'\s*\}/);
    const lista = telas.match(/ACOES_LANCAMENTOS_FINANCEIROS\s*=\s*Object\.freeze\(\[([^\]]*)\]/);
    expect(lista, 'ACOES_LANCAMENTOS_FINANCEIROS ausente em autorizacaoTela.js').toBeTruthy();
    expect([...lista[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...EXTRA_ACTION_KEYS_BY_PAGE['ges-lancamentos-financeiros']].sort());
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
    expect(screen.queryByText('Naturezas Financeiras')).toBeNull();
  });

  it('quem tem só Naturezas Financeiras vê o grupo só com ela', async () => {
    sessao.permissoes = [
      registro(['mapa', 'gestao-rural'], [tela('mapa', 'pec-mapa-geral', { visualizar: true }), tela('gestao-rural', 'ges-naturezas-financeiras', { visualizar: true })]),
    ];
    await renderShell();
    expect((await screen.findAllByText('Gestão Rural')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Naturezas Financeiras').length).toBeGreaterThan(0);
    expect(screen.queryByText('Parceiros')).toBeNull();
    expect(screen.queryByText('Centros de Custo')).toBeNull();
  });

  it('quem não tem nenhuma das telas não vê o grupo (padrão negado)', async () => {
    sessao.permissoes = [registro(['mapa', 'gestao-rural'], [tela('mapa', 'pec-mapa-geral', { visualizar: true })])];
    await renderShell();
    await screen.findByTestId('pagina');
    expect(screen.queryByText('Gestão Rural')).toBeNull();
    expect(screen.queryByText('Parceiros')).toBeNull();
  });

  it('administrador da fazenda vê o grupo e as cinco telas', async () => {
    sessao.usuario = admin;
    await renderShell();
    expect((await screen.findAllByText('Gestão Rural')).length).toBeGreaterThan(0);
    for (const t of ['Parceiros', 'Centros de Custo', 'Centros de Resultado', 'Naturezas Financeiras', 'Lançamentos Financeiros']) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
  });

  it('quem tem só Lançamentos Financeiros vê o grupo só com ela', async () => {
    sessao.permissoes = [
      registro(['mapa', 'gestao-rural'], [tela('mapa', 'pec-mapa-geral', { visualizar: true }), tela('gestao-rural', 'ges-lancamentos-financeiros', { visualizar: true })]),
    ];
    await renderShell();
    expect((await screen.findAllByText('Gestão Rural')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lançamentos Financeiros').length).toBeGreaterThan(0);
    expect(screen.queryByText('Naturezas Financeiras')).toBeNull();
    expect(screen.queryByText('Parceiros')).toBeNull();
  });
});

describe('GES-M4 — tela Permissões lista as cinco telas com as ações', () => {
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
    for (const t of ['Parceiros', 'Centros de Custo', 'Centros de Resultado', 'Naturezas Financeiras', 'Lançamentos Financeiros']) {
      const cartao = screen.getByText(t, { selector: 'p.font-semibold' }).closest('.rounded-lg');
      const caixas = within(cartao).getAllByRole('checkbox');
      // visualizar + 6 ações (novo, salvar, editar, excluir, importar, exportar), todas desligadas;
      // a Central de Lançamentos tem mais 4 extras SÓ nela (confirmar, liquidar, estornar baixa, cancelar).
      const lancamentos = t === 'Lançamentos Financeiros';
      expect(caixas).toHaveLength(lancamentos ? 11 : 7);
      expect(caixas.every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true);
      expect(within(cartao).getByText('NOVO')).toBeTruthy();
      expect(within(cartao).getByText('EDITAR')).toBeTruthy();
      if (lancamentos) {
        for (const r of ['CONFIRMAR LANÇAMENTO', 'REGISTRAR PAGAMENTO/RECEBIMENTO', 'ESTORNAR BAIXA', 'CANCELAR LANÇAMENTO']) expect(within(cartao).getByText(r)).toBeTruthy();
      } else {
        expect(within(cartao).queryByText('CONFIRMAR LANÇAMENTO')).toBeNull();
      }
    }
  });
});
