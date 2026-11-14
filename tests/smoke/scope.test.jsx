import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// pages.config importa as páginas registradas, que importavam o cliente Base44.
// Sem este mock o SDK real tentaria rede durante a coleta.
vi.mock('@/api/base44Client', async () => {
  const { createBase44Stub } = await import('./base44Stub.js');
  return { base44: createBase44Stub() };
});

import { pagesConfig, PAGES } from '@/pages.config';
import { DEFAULT_MENU, flattenMenuPages } from '@/lib/menuConfig';

const scope = JSON.parse(readFileSync('config/mapa-manejo-scope.json', 'utf8'));

describe('escopo do produto', () => {
  it('pages.config registra exatamente as páginas do manifesto', () => {
    expect(Object.keys(PAGES).sort()).toEqual([...scope.allowedPages].sort());
  });

  it('toda página permitida é um módulo importável', () => {
    for (const nome of scope.allowedPages) {
      expect(typeof PAGES[nome], `página ${nome}`).toBe('function');
    }
  });

  it('a superfície primária é MapaGeral', () => {
    expect(pagesConfig.mainPage).toBe(scope.primarySurface);
    expect(pagesConfig.mainPage).toBe('MapaGeral');
  });

  it('a raiz encaminha para a URL canônica do mapa (minúsculas)', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('createPageUrl(mainPage)');
    expect(pagesConfig.mainPage).toBe('MapaGeral');
  });

  it('rotas registradas batem com createPageUrl do menu', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('path={createPageUrl(path)}');
  });

  it('Layout monta uma vez via AppShell + AppRouteContent (sem remount do Layout por rota)', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('AppShell');
    expect(app).toContain('AppRouteContent');
    expect(app).not.toMatch(/LayoutWrapper currentPageName=\{path\}[\s\S]*<Page \/>/);
  });

  it('Layout não empilha rotas com AnimatePresence (evita freeze entre menus)', () => {
    const layout = readFileSync('src/Layout.jsx', 'utf8');
    expect(layout).not.toContain('AnimatePresence');
    expect(layout).not.toContain('framer-motion');
  });

  it('o menu só aponta para páginas permitidas', () => {
    const permitidas = new Set(scope.allowedPages);
    for (const page of flattenMenuPages(DEFAULT_MENU)) {
      expect(permitidas.has(page.url), `menu aponta para ${page.url}`).toBe(true);
    }
  });

  it('D-PROD-162: Famílias, Tipos, Perfis de Medição e Combustíveis saíram (página, registro, manifesto e menu)', () => {
    const removidas = ['FamiliasPatrimoniais', 'TiposPatrimoniais', 'PerfisMedicao', 'Combustiveis'];
    const doMenu = flattenMenuPages(DEFAULT_MENU).map((page) => page.url);
    for (const nome of removidas) {
      expect(PAGES[nome], nome).toBeUndefined();
      expect(scope.allowedPages, nome).not.toContain(nome);
      expect(doMenu, nome).not.toContain(nome);
      expect(existsSync(`src/pages/${nome}.jsx`), nome).toBe(false);
    }
    // Patrimônio e Frota fica com as duas páginas.
    expect(scope.allowedPages.filter((p) => ['BensPatrimoniais', 'Abastecimentos'].includes(p))).toEqual(['BensPatrimoniais', 'Abastecimentos']);
    // +1 Tipos de Atividade (D-PROD-182); +1 Estações (D-PROD-188); +1 Curvas de Ganho (D-PROD-189);
    // +1 Apontamentos de Atividade (D-PROD-190), trocado por Lançamento de Atividades (D-PROD-200, uma por uma).
    expect(scope.allowedPages).toHaveLength(28);
  });

  it('D-PROD-200: Apontamentos de Atividade deu lugar a Lançamento de Atividades, uma por uma (página, registro, manifesto e menu)', () => {
    const doMenu = flattenMenuPages(DEFAULT_MENU).map((page) => page.url);
    expect(PAGES.ApontamentosAtividade).toBeUndefined();
    expect(scope.allowedPages).not.toContain('ApontamentosAtividade');
    expect(doMenu).not.toContain('ApontamentosAtividade');
    expect(existsSync('src/pages/ApontamentosAtividade.jsx')).toBe(false);
    expect(existsSync('src/components/apontamentos-atividade')).toBe(false);
    expect(typeof PAGES.LancamentoAtividades).toBe('function');
    expect(scope.allowedPages).toContain('LancamentoAtividades');
    expect(doMenu.filter((url) => url === 'LancamentoAtividades')).toHaveLength(1);
    // A nova ocupa o lugar da antiga no manifesto: logo depois de Tipos de Atividade.
    expect(scope.allowedPages.indexOf('LancamentoAtividades')).toBe(scope.allowedPages.indexOf('TiposAtividade') + 1);
  });

  it('PageNotFound continua registrado como catch-all', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('path="*"');
    expect(app).toContain('<PageNotFound />');
  });
});
