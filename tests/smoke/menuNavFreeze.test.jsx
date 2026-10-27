/**
 * Navegação rápida entre menus — contratos anti-freeze (FIX-MENU-NAV-FREEZE-3).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const codigoDe = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('NAV3 — debounce de rota e cancelamento de fetch', () => {
  it('AppShell usa DebouncedOutlet em vez de Outlet direto', () => {
    const app = codigoDe('src/App.jsx');
    expect(app).toContain('DebouncedOutlet');
    expect(app).not.toMatch(/<Outlet\s*\/>/);
  });

  it('DebouncedOutlet desmonta durante settle e cancela queries em flight', () => {
    const outlet = codigoDe('src/components/navigation/DebouncedOutlet.jsx');
    expect(outlet).toContain('useLayoutEffect');
    expect(outlet).toContain('cancelQueries');
    expect(outlet).toContain('data-nav-pending');
    expect(outlet).toMatch(/NAV_ROUTE_SETTLE_MS\s*=\s*48/);
  });
});

describe('NAV3 — Mapa Geral libera Google Maps ao sair', () => {
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

describe('NAV3 — renderer do mapa não deixa intervalos de blink', () => {
  it('clearAll derruba blinkIntervals globais', () => {
    const renderer = codigoDe('src/components/mapa/useMapRenderer.jsx');
    expect(renderer).toContain('clearAllBlinkIntervals');
    expect(renderer).toMatch(/clearAllBlinkIntervals\(\)/);
  });
});

describe('NAV3 — Layout isola slot da página por pathname', () => {
  it('main content usa key de pathname', () => {
    const layout = codigoDe('src/Layout.jsx');
    expect(layout).toContain('key={location.pathname}');
  });
});
