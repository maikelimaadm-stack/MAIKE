/**
 * Navegação rápida entre menus — contratos anti-freeze (ROOT-CAUSE 2026-10-27).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const codigoDe = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('NAV — AppRouteContent: Outlet + Mapa Geral vivo e inerte (D-PROD-305)', () => {
  it('AppShell usa AppRouteContent em vez de Outlet direto', () => {
    const app = codigoDe('src/App.jsx');
    expect(app).toContain('AppRouteContent');
    expect(app).not.toMatch(/<Outlet\s*\/>/);
    expect(app).not.toContain('DebouncedOutlet');
  });

  it('AppRouteContent: sem cancelamento global de queries nem efeito de layout (o que travava, #94)', () => {
    const outlet = codigoDe('src/components/navigation/AppRouteContent.jsx');
    expect(outlet).toContain('<Outlet');
    expect(outlet).not.toContain('cancelQueries');
    expect(outlet).not.toContain('queryClientInstance');
    expect(outlet).not.toContain('useLayoutEffect');
    expect(outlet).not.toContain('setTimeout');
  });

  it('D-PROD-305: o Mapa Geral fica montado e escondido fora da rota, INERTE (ativo=false), e não duplica com o Outlet', () => {
    const outlet = codigoDe('src/components/navigation/AppRouteContent.jsx');
    expect(outlet).toMatch(/<MapaGeral ativo=\{naMapa\} \/>/);
    expect(outlet).toMatch(/display: naMapa \? "contents" : "none"/);
    expect(outlet).toMatch(/naMapa \? null : <Outlet \/>/);
    const mapa = codigoDe('src/pages/MapaGeral.jsx');
    // Escondido: sem GPS; ao voltar, ajusta o tamanho; ao sair, fecha as janelas (portais).
    expect(mapa).toMatch(/ativo: ativo && mapReady/);
    expect(mapa).toContain('map.resize()');
    expect(mapa).toMatch(/if \(ativo\) return;\s*setShowDetalhesLote\(false\)/);
  });

  it('Mapa Geral continua registrado como rota React Router (sem element null)', () => {
    const app = codigoDe('src/App.jsx');
    expect(app).not.toMatch(/path === ['"]MapaGeral['"] \? null/);
    expect(app).toMatch(/element=\{<Page \/>}/);
  });
});

describe('NAV — Mapa Geral libera o MapLibre ao sair (teardown unmount)', () => {
  const fonte = codigoDe('src/pages/MapaGeral.jsx');

  it('teardown limpa marcadores, listeners e a instância (map.remove via dispose)', () => {
    expect(fonte).toContain('teardownMapInstance');
    expect(fonte).toContain('renderer.clearAll()');
    expect(fonte).toContain('disposeMapRef.current?.()');
    expect(fonte).toContain('created.dispose()');
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
    expect(renderer).toContain('const clearBlinks');
    expect(renderer).toMatch(/const clearAll = useCallback\(\(\) => \{\s*clearBlinks\(\);/);
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

describe('NAV — marcadores do mapa não atravessam janelas (D-PROD-80)', () => {
  it('o contêiner do MapLibre isola o z-index dos marcadores', () => {
    const fonte = codigoDe('src/pages/MapaGeral.jsx');
    expect(fonte).toMatch(/data-testid="mapa-geral-maplibre"[^>]*isolation: 'isolate'/);
  });
});
