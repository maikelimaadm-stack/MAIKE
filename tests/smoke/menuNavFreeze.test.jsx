/**
 * Navegação rápida entre menus — contratos anti-freeze (ROOT-CAUSE 2026-10-27).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const codigoDe = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('NAV — AppRouteContent: Outlet único, sem mapa persistente', () => {
  it('AppShell usa AppRouteContent em vez de Outlet direto', () => {
    const app = codigoDe('src/App.jsx');
    expect(app).toContain('AppRouteContent');
    expect(app).not.toMatch(/<Outlet\s*\/>/);
    expect(app).not.toContain('DebouncedOutlet');
  });

  it('AppRouteContent é só Outlet + cancelamento assíncrono de queries', () => {
    const outlet = codigoDe('src/components/navigation/AppRouteContent.jsx');
    expect(outlet).toContain('useEffect');
    expect(outlet).toContain('cancelQueries');
    expect(outlet).not.toContain('useLayoutEffect');
    expect(outlet).not.toContain('setTimeout');
    expect(outlet).not.toContain('data-persistent-map');
    expect(outlet).not.toContain('MapaGeral');
    expect(outlet).not.toContain('mapaPersistenteAtivo');
  });

  it('Mapa Geral monta via rota React Router (sem element null)', () => {
    const app = codigoDe('src/App.jsx');
    expect(app).not.toMatch(/path === ['"]MapaGeral['"] \? null/);
    expect(app).toMatch(/element=\{<Page \/>}/);
  });
});

describe('NAV — Mapa Geral libera Google Maps ao sair (teardown unmount)', () => {
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

describe('NAV — renderer do mapa não deixa intervalos de blink', () => {
  it('clearAll derruba blinkIntervals globais', () => {
    const renderer = codigoDe('src/components/mapa/useMapRenderer.jsx');
    expect(renderer).toContain('clearAllBlinkIntervals');
    expect(renderer).toMatch(/clearAllBlinkIntervals\(\)/);
  });
});

describe('NAV — Layout evita remount duplo e navegação duplicada', () => {
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

  it('dedupe de menu limpa intento após mudança de rota', () => {
    const layout = codigoDe('src/Layout.jsx');
    expect(layout).toMatch(/menuNavIntentRef\.current = null/);
    expect(layout).toMatch(/\[location\.pathname\]/);
  });
});

describe('NAV — dedupe de clique no menu', () => {
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
