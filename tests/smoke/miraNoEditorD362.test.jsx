/**
 * D-PROD-362 — cadastrar no mapa como no AgriWebb, etapa 2:
 *  - mira fixa no centro: o mapa anda por baixo e "Marcar aqui" põe o ponto/vértice (ou leva o vértice escolhido);
 *  - seguir minha posição: o mapa acompanha o GPS; arrastar com o dedo para de seguir;
 *  - a seta do ponto azul mostra para onde o celular aponta (bússola; andando, o rumo do GPS).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ aoCarregar: [], centro: { lat: -15.6, lng: -56.1 }, easeTo: null, ouvintes: {}, marcadores: [], canvas: null }));

vi.mock('maplibre-gl', () => {
  const Map = vi.fn(function Map() {
    const map = {
      dragPan: { disable: vi.fn(), enable: vi.fn() },
      touchZoomRotate: { disableRotation: vi.fn() },
      addControl: vi.fn(), remove: vi.fn(), getZoom: () => 16, setZoom: vi.fn(), setCenter: vi.fn(), fitBounds: vi.fn(), jumpTo: vi.fn(),
      easeTo: vi.fn((o) => { m.easeTo = o; }),
      getCenter: () => ({ ...m.centro }),
      isStyleLoaded: () => true,
      // projeção simples: 1e5 px por grau (pontos diferentes ficam longe uns dos outros na tela)
      project: vi.fn((ll) => { const lng = Array.isArray(ll) ? ll[0] : ll.lng; const lat = Array.isArray(ll) ? ll[1] : ll.lat; return { x: lng * 1e5, y: -lat * 1e5 }; }),
      unproject: vi.fn((p) => { const [x, y] = Array.isArray(p) ? p : [p.x, p.y]; return { lng: x / 1e5, lat: -y / 1e5 }; }),
      getSource: () => null, getLayer: () => null, addSource: vi.fn(), addLayer: vi.fn(), setPaintProperty: vi.fn(), setStyle: vi.fn(),
      queryRenderedFeatures: vi.fn(() => []), once: vi.fn(),
      off: vi.fn((ev, f) => { m.ouvintes[ev] = (m.ouvintes[ev] || []).filter((x) => x !== f); }),
      on: vi.fn((ev, a) => {
        if (ev === 'load' && typeof a === 'function') m.aoCarregar.push(a);
        if (typeof a === 'function') (m.ouvintes[ev] ||= []).push(a);
      }),
      getCanvas: () => (m.canvas ||= document.createElement('canvas')),
    };
    return map;
  });
  class LngLatBounds { extend() { return this; } }
  const Marker = vi.fn(function Marker(opts) {
    const mk = { opts, setLngLat: () => mk, addTo: () => mk, remove: vi.fn(), getElement: () => opts?.element || document.createElement('div'), on: vi.fn() };
    m.marcadores.push(mk);
    return mk;
  });
  return { default: { Map, NavigationControl: vi.fn(), Marker, LngLatBounds }, Map, NavigationControl: vi.fn(), Marker, LngLatBounds };
});
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaService', () => ({
  listarAreasAtivas: vi.fn(async () => []),
  listarPontosAtivos: vi.fn(async () => []),
  listarLinhasAtivas: vi.fn(async () => []),
  listarIconesAtivos: vi.fn(async () => []),
}));
vi.mock('@/components/mapa/FormularioPonto', () => ({ default: () => null, FORMULARIO_PONTO_ID: 'f-ponto' }));
vi.mock('@/components/mapa/FormularioArea', () => ({ default: () => null, FORMULARIO_AREA_ID: 'f-area' }));
vi.mock('@/components/mapa/FormularioLinha', () => ({ default: () => null, FORMULARIO_LINHA_ID: 'f-linha' }));

let qc;
let gpsOk = null;
const geolocalizacaoOriginal = navigator.geolocation;
beforeEach(() => {
  cleanup();
  m.aoCarregar = []; m.easeTo = null; m.ouvintes = {}; m.marcadores = []; m.canvas = null; m.centro = { lat: -15.6, lng: -56.1 };
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  gpsOk = null;
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok) => { gpsOk = ok; return 1; }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocalizacaoOriginal });
});

const abrir = async (tipo) => {
  const { default: MapaDesenho } = await import('@/components/mapa/MapaDesenho.jsx');
  await act(async () => {
    render(<QueryClientProvider client={qc}><MapaDesenho tipoDesenho={tipo} onSalvar={() => {}} onCancelar={() => {}} /></QueryClientProvider>);
  });
  await act(async () => { for (const f of m.aoCarregar.splice(0)) f(); await Promise.resolve(); });
};
const gps = (lat, lng, extra = {}) => act(async () => {
  gpsOk?.({ coords: { latitude: lat, longitude: lng, accuracy: 4, heading: extra.heading ?? null, speed: extra.speed ?? null }, timestamp: Date.now() });
});

describe('D-PROD-362 — o que "Marcar aqui" faz (regra)', () => {
  it('MI-01: ponto marca; desenho aberto põe vértice; vértice escolhido vai para a mira; fechado sem escolha não faz nada', async () => {
    const { acaoDaMira } = await import('@/lib/maplibre/miraDoEditor.js');
    expect(acaoDaMira({ tipo: 'ponto', fechado: false, editando: false, selecionado: null, pontos: 0 })).toMatchObject({ acao: 'ponto', rotulo: 'Marcar aqui' });
    expect(acaoDaMira({ tipo: 'area', fechado: false, editando: false, selecionado: null, pontos: 0 })).toMatchObject({ acao: 'vertice', rotulo: 'Marcar 1º ponto aqui' });
    expect(acaoDaMira({ tipo: 'linha', fechado: false, editando: false, selecionado: null, pontos: 2 })).toMatchObject({ acao: 'vertice', rotulo: 'Marcar ponto aqui' });
    expect(acaoDaMira({ tipo: 'area', fechado: true, editando: false, selecionado: 2, pontos: 4 })).toMatchObject({ acao: 'mover-vertice', rotulo: 'Levar ponto 3 para a mira' });
    expect(acaoDaMira({ tipo: 'area', fechado: false, editando: true, selecionado: null, pontos: 4 })).toMatchObject({ acao: null });
    expect(acaoDaMira({ tipo: 'area', fechado: true, editando: false, selecionado: 9, pontos: 4 }).acao, 'índice fora da forma').toBeNull();
  });

  it('MI-02: o centro da mira vem do centro do mapa (e nada sem mapa)', async () => {
    const { centroDaMira } = await import('@/lib/maplibre/miraDoEditor.js');
    expect(centroDaMira({ getCenter: () => ({ lat: 1, lng: 2 }) })).toEqual({ lat: 1, lng: 2 });
    expect(centroDaMira(null)).toBeNull();
    expect(centroDaMira({ getCenter: () => ({ lat: NaN, lng: 2 }) })).toBeNull();
  });

  it('MI-03: rumo da bússola (Android absoluto, iPhone) e do GPS só andando', async () => {
    const { rumoDaOrientacao, rumoDoGps, normalizarGraus } = await import('@/components/mapa/useRumoDoAparelho.js');
    expect(rumoDaOrientacao({ absolute: true, alpha: 90 })).toBe(270);
    expect(rumoDaOrientacao({ absolute: false, alpha: 90 }), 'relativo não serve de bússola').toBeNull();
    expect(rumoDaOrientacao({ webkitCompassHeading: 45 })).toBe(45);
    expect(rumoDoGps({ rumo: 120, velocidade: 2 })).toBe(120);
    expect(rumoDoGps({ rumo: 120, velocidade: 0.2 }), 'parado o rumo do GPS é ruído').toBeNull();
    expect(normalizarGraus(-30)).toBe(330);
  });
});

describe('D-PROD-362 — mira no editor', () => {
  it('MI-04: pasto pela mira — três "Marcar" em lugares diferentes desenham a área', async () => {
    await abrir('area');
    expect(screen.queryByTestId('mira-centro')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mira no centro' }));
    expect(screen.getByTestId('mira-centro')).toBeInTheDocument();
    expect(screen.getByText('Mova o mapa até a mira e toque em Marcar')).toBeInTheDocument();
    for (const [i, c] of [[0, { lat: -15.6, lng: -56.1 }], [1, { lat: -15.6, lng: -56.09 }], [2, { lat: -15.61, lng: -56.09 }]]) {
      m.centro = c;
      const botao = screen.getByRole('button', { name: i === 0 ? 'Marcar 1º ponto aqui' : 'Marcar ponto aqui' });
      await act(async () => { fireEvent.click(botao); });
    }
    expect(screen.getByTestId('medidas-area').textContent).toMatch(/Área: .* ha/);
  });

  it('MI-05: ponto pela mira — "Marcar aqui" põe o ponto no centro e libera Continuar', async () => {
    await abrir('ponto');
    const continuar = () => screen.getByRole('button', { name: 'Continuar' });
    expect(continuar()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mira no centro' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marcar aqui' })); });
    expect(continuar()).not.toBeDisabled();
  });
});

describe('D-PROD-362 — o toque com a mira ligada', () => {
  const tocar = (x, y) => act(async () => {
    m.canvas.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }), { pointerType: 'mouse', isPrimary: true }));
    m.canvas.dispatchEvent(Object.assign(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }), { pointerType: 'mouse', isPrimary: true }));
  });
  const tresToques = async () => { await tocar(100, 100); await tocar(3000, 100); await tocar(3000, 3000); };

  it('MI-08: com a mira ligada o toque só move o mapa (não cria ponto); desligada, o toque volta a desenhar', async () => {
    await abrir('area');
    fireEvent.click(screen.getByRole('button', { name: 'Mira no centro' }));
    await tresToques();
    expect(screen.queryByTestId('medidas-area'), 'nenhum ponto pelo toque').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mira no centro' }));
    await tresToques();
    expect(screen.getByTestId('medidas-area')).toBeInTheDocument();
  });
});

describe('D-PROD-362 — seguir minha posição e seta', () => {
  it('MI-06: seguindo, cada leitura do GPS recentra o mapa; arrastar com o dedo para de seguir', async () => {
    await abrir('area');
    await gps(-15.7, -56.2);
    const seguir = () => screen.getByRole('button', { name: 'Seguir minha posição' });
    expect(seguir()).toHaveAttribute('aria-pressed', 'false');
    await act(async () => { fireEvent.click(seguir()); });
    expect(seguir()).toHaveAttribute('aria-pressed', 'true');
    await gps(-15.71, -56.21);
    expect(m.easeTo?.center).toEqual([-56.21, -15.71]);
    await act(async () => { for (const f of m.ouvintes.dragstart || []) f({ originalEvent: {} }); });
    expect(seguir()).toHaveAttribute('aria-pressed', 'false');
    m.easeTo = null;
    await gps(-15.72, -56.22);
    expect(m.easeTo, 'parado de seguir, o mapa fica onde a pessoa deixou').toBeNull();
  });

  it('MI-07: andando, a seta do ponto azul aponta o rumo do GPS', async () => {
    await abrir('area');
    await gps(-15.7, -56.2, { heading: 90, speed: 2 });
    const ponto = m.marcadores.map((x) => x.opts?.element).find((el) => el?.hasAttribute?.('data-mk-minha-localizacao'));
    const seta = ponto?.querySelector('[data-mk-rumo]');
    expect(seta?.getAttribute('data-mk-rumo')).toBe('90');
    expect(seta?.style.display).toBe('block');
    expect(seta?.style.transform).toBe('rotate(90deg)');
  });
});
