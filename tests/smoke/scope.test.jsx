import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// pages.config importa as 16 páginas, que importam o cliente Base44.
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

  it('Layout monta uma vez via AppShell + Outlet (sem remount por rota)', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('AppShell');
    expect(app).toContain('<Outlet />');
    expect(app).not.toMatch(/LayoutWrapper currentPageName=\{path\}[\s\S]*<Page \/>/);
  });

  it('Layout não empilha rotas com AnimatePresence (evita freeze entre menus)', () => {
    const layout = readFileSync('src/Layout.jsx', 'utf8');
    expect(layout).not.toContain('AnimatePresence');
    expect(layout).not.toMatch(/key=\{location\.pathname\}/);
  });

  it('o menu só aponta para páginas permitidas', () => {
    const permitidas = new Set(scope.allowedPages);
    for (const page of flattenMenuPages(DEFAULT_MENU)) {
      expect(permitidas.has(page.url), `menu aponta para ${page.url}`).toBe(true);
    }
  });

  it('PageNotFound continua registrado como catch-all', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('path="*"');
    expect(app).toContain('<PageNotFound />');
  });
});
