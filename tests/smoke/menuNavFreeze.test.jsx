/**
 * Navegação rápida entre menus — contratos anti-freeze (FIX-MENU-NAV-FREEZE-4).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const codigoDe = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('NAV4 — AppRouteContent sem debounce de rota', () => {
  it('AppShell usa AppRouteContent em vez de Outlet direto', () => {
    const app = codigoDe('src/App.jsx');
    expect(app).toContain('AppRouteContent');
    expect(app).not.toMatch(/<Outlet\s*\/>/);
    expect(app).not.toContain('DebouncedOutlet');
  });

  it('AppRouteContent cancela queries em flight sem atraso de settle', () => {
    const outlet = codigoDe('src/components/navigation/AppRouteContent.jsx');
    expect(outlet).toContain('useLayoutEffect');
    expect(outlet).toContain('cancelQueries');
    expect(outlet).not.toContain('setTimeout');
    expect(outlet).not.toContain('data-nav-pending');
  });

  it('Mapa Geral persiste oculto após primeira visita', () => {
    const outlet = codigoDe('src/components/navigation/AppRouteContent.jsx');
    const app = codigoDe('src/App.jsx');
    expect(outlet).toContain('data-persistent-map');
    expect(outlet).toContain('mapaPersistenteAtivo');
    expect(app).toMatch(/path === ['"]MapaGeral['"] \? null/);
  });
});

describe('NAV4 — Mapa Geral libera Google Maps ao sair (fallback unmount)', () => {
  const fonte = codigoDe('src/pages/MapaGeral.jsx');

  it('teardown limpa overlay, listeners e referência do mapa', () => {
    expect(fonte).toContain('teardownMapInstance');
    expect(fonte).toContain('clearInstanceListeners(map)');
    expect(fonte).toContain('projectionOverlayRef.current.setMap(null)');
    expect(fonte).toContain('mapInstanceRef.current = null');
    expect(fonte).toContain('setMapReady(false)');
  });

  it('init aborta se a página desmontou antes do SDK', () => {
    expect(fonte).toMatch(/let cancelled = false/);
    expect(fonte).toMatch(/if \(cancelled\)/);
    expect(fonte).toContain('teardownMapInstance()');
  });
});

describe('NAV4 — renderer do mapa não deixa intervalos de blink', () => {
  it('clearAll derruba blinkIntervals globais', () => {
    const renderer = codigoDe('src/components/mapa/useMapRenderer.jsx');
    expect(renderer).toContain('clearAllBlinkIntervals');
    expect(renderer).toMatch(/clearAllBlinkIntervals\(\)/);
  });
});

describe('NAV4 — Layout evita remount duplo e navegação duplicada', () => {
  it('main content não usa key de pathname', () => {
    const layout = codigoDe('src/Layout.jsx');
    expect(layout).not.toMatch(/key=\{location\.pathname\}/);
  });

  it('menu desktop usa Button asChild + Link (sem Link envolvendo Button)', () => {
    const layout = codigoDe('src/Layout.jsx');
    expect(layout).toContain('asChild');
    expect(layout).toContain('deveBloquearCliqueMenu');
    expect(layout).not.toMatch(/<Link[^>]*>\s*<Button/);
  });
});

describe('NAV4 — dedupe de clique no menu', () => {
  it('bloqueia mesma rota e repetição rápida', async () => {
    const { deveBloquearCliqueMenu, MENU_NAV_DEDUPE_MS } = await import('@/lib/menuNavigation');
    expect(deveBloquearCliqueMenu('/mapageral', '/mapageral', null)).toBe(true);
    expect(
      deveBloquearCliqueMenu('/mapageral', '/cadastrolotes', { path: '/cadastrolotes', at: 1000 }, 1200)
    ).toBe(true);
    expect(
      deveBloquearCliqueMenu('/mapageral', '/cadastrolotes', { path: '/cadastrolotes', at: 1000 }, 1000 + MENU_NAV_DEDUPE_MS)
    ).toBe(false);
  });
});
