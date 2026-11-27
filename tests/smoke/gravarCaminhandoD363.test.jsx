/**
 * D-PROD-363 — caminhar com o GPS gravando o contorno sozinho, como no AgriWebb:
 *  - gravando, cada leitura boa (≤ 25 m de precisão) a ≥ 5 m da última vira ponto; leitura ruim ou perto não;
 *  - Pausar para de gravar; Terminar enxuga a trilha (Douglas-Peucker) sem tirar os cantos marcados à mão;
 *  - a captura abre por cima de tudo (no body) e no satélite, com os pastos já cadastrados por baixo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ aoCarregar: [], basemapOpts: null }));

vi.mock('maplibre-gl', () => {
  const Map = vi.fn(function Map() {
    return {
      dragPan: { disable: vi.fn(), enable: vi.fn() },
      touchZoomRotate: { disableRotation: vi.fn() },
      addControl: vi.fn(), remove: vi.fn(), getZoom: () => 18, setZoom: vi.fn(), setCenter: vi.fn(), fitBounds: vi.fn(), jumpTo: vi.fn(), easeTo: vi.fn(),
      isStyleLoaded: () => true, project: vi.fn(() => ({ x: 0, y: 0 })), unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
      getSource: () => null, getLayer: () => null, addSource: vi.fn(), addLayer: vi.fn(), setPaintProperty: vi.fn(), setStyle: vi.fn(),
      queryRenderedFeatures: vi.fn(() => []), once: vi.fn(), off: vi.fn(), getStyle: () => ({ layers: [] }),
      on: vi.fn((ev, a) => { if (ev === 'load' && typeof a === 'function') m.aoCarregar.push(a); }), getCanvas: () => document.createElement('canvas'),
    };
  });
  class LngLatBounds { extend() { return this; } }
  const Marker = vi.fn(function Marker() {
    const mk = { setLngLat: () => mk, addTo: () => mk, remove: vi.fn(), getElement: () => document.createElement('div'), on: vi.fn(), getLngLat: () => ({ lat: 0, lng: 0 }) };
    return mk;
  });
  return { default: { Map, NavigationControl: vi.fn(), Marker, LngLatBounds }, Map, NavigationControl: vi.fn(), Marker, LngLatBounds };
});
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaService', () => ({
  listarAreasAtivas: vi.fn(async () => []),
  listarLinhasAtivas: vi.fn(async () => []),
}));
vi.mock('@/components/mapa/useBasemap', () => ({
  default: (map, opts) => { m.basemapOpts = opts; return { basemapId: opts?.inicial, status: 'pronto', mensagem: null, setBasemap: vi.fn(), retry: vi.fn() }; },
}));

let gpsOk = null;
let qc;
const geolocalizacaoOriginal = navigator.geolocation;
beforeEach(() => {
  cleanup();
  m.aoCarregar = []; m.basemapOpts = null;
  gpsOk = null;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: vi.fn((ok) => { gpsOk = ok; return 7; }), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocalizacaoOriginal });
});

const BASE = { lat: -15.6, lng: -56.1 };
/** Leitura a `norteM` metros ao norte e `lesteM` a leste da base. */
const leitura = (norteM, lesteM = 0, accuracy = 4) => act(async () => {
  gpsOk?.({ coords: { latitude: BASE.lat + norteM / 111_320, longitude: BASE.lng + lesteM / (111_320 * Math.cos((BASE.lat * Math.PI) / 180)), accuracy }, timestamp: Date.now() });
});

const abrir = async (onSalvar = vi.fn()) => {
  const { default: CapturaGPSPoligono } = await import('@/components/mapa/CapturaGPSPoligono.jsx');
  await act(async () => {
    render(<QueryClientProvider client={qc}><CapturaGPSPoligono tipo="area" onSalvar={onSalvar} onCancelar={() => {}} /></QueryClientProvider>);
  });
  await act(async () => { for (const f of m.aoCarregar.splice(0)) f(); await Promise.resolve(); });
  return onSalvar;
};
const contagem = () => Number(screen.getByText('pontos').previousSibling.textContent);

describe('D-PROD-363 — regra da gravação', () => {
  it('GC-01: grava a primeira leitura e as que estão a ≥ 5 m; não grava perto, sem precisão ou velha', async () => {
    const { deveGravar, distanciaM } = await import('@/lib/maplibre/gravacaoCaminhando.js');
    const a = { lat: -15.6, lng: -56.1 };
    const norte = (mm) => ({ lat: a.lat + mm / 111_320, lng: a.lng });
    expect(Math.round(distanciaM(a, norte(10)))).toBe(10);
    expect(deveGravar(null, { ...a, accuracy: 3 })).toBe(true);
    expect(deveGravar(a, { ...norte(3), accuracy: 3 }), '3 m: perto').toBe(false);
    expect(deveGravar(a, { ...norte(6), accuracy: 3 })).toBe(true);
    expect(deveGravar(a, { ...norte(30), accuracy: 40 }), 'precisão ruim').toBe(false);
    expect(deveGravar(a, { ...norte(30), accuracy: 3, stale: true }), 'leitura velha').toBe(false);
  });

  it('GC-02: enxugar a trilha tira os pontos no meio da reta e mantém cantos e os marcados à mão', async () => {
    const { simplificarTrilha } = await import('@/lib/maplibre/gravacaoCaminhando.js');
    const p = (n, l, extra = {}) => ({ lat: -15.6 + n / 111_320, lng: -56.1 + l / 107_000, ...extra });
    // um "L": 50 m ao norte e 50 m ao leste, um ponto a cada 5 m, com 30 cm de tremor
    const trilha = [];
    for (let i = 0; i <= 10; i += 1) trilha.push(p(i * 5, i % 2 ? 0.3 : 0));
    for (let i = 1; i <= 10; i += 1) trilha.push(p(50 + (i % 2 ? 0.3 : 0), i * 5));
    const enxuta = simplificarTrilha(trilha);
    expect(enxuta).toHaveLength(3);
    expect(enxuta[1]).toBe(trilha[10]);
    // um ponto marcado à mão no meio da reta fica
    trilha[4] = { ...trilha[4], fixo: true };
    expect(simplificarTrilha(trilha)).toContain(trilha[4]);
  });
});

describe('D-PROD-363 — gravar caminhando na tela', () => {
  it('GC-03: gravando, leituras a cada 6 m viram pontos; perto e ruim não; Pausar para; Terminar enxuga; Confirmar salva sem a marca interna', async () => {
    const onSalvar = await abrir();
    await leitura(0);
    expect(contagem()).toBe(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Gravar caminhando/ })); });
    await leitura(0);
    await leitura(2);
    expect(contagem(), 'perto demais').toBe(1);
    await leitura(6);
    await leitura(12);
    await leitura(18, 0, 60);
    expect(contagem(), 'a de 60 m de precisão não grava').toBe(3);
    await leitura(18, 6);
    await leitura(18, 12);
    expect(contagem()).toBe(5);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Pausar/ })); });
    await leitura(40, 40);
    expect(contagem(), 'pausado não grava').toBe(5);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Terminar/ })); });
    // (0,0) (6,0) (12,0) (18,6) (18,12): o (6,0) está no meio da reta e sai; a diagonal até (18,6) é um canto
    expect(contagem(), 'o meio das retas sai').toBe(4);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Confirmar/ })); });
    expect(onSalvar).toHaveBeenCalledTimes(1);
    const salvos = onSalvar.mock.calls[0][0];
    expect(salvos).toHaveLength(4);
    expect(salvos.every((x) => !('fixo' in x))).toBe(true);
  });

  it('GC-04: o canto marcado à mão durante a gravação não sai ao terminar', async () => {
    await abrir();
    await leitura(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Gravar caminhando/ })); });
    await leitura(0);
    await leitura(6);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Canto/ })); });
    await leitura(12);
    await leitura(18);
    expect(contagem()).toBe(5);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Terminar/ })); });
    expect(contagem(), 'reta: ficam as pontas e o canto à mão').toBe(3);
  });

  it('GC-05: abre no body (fora do formulário lateral) e no satélite, guardando as camadas de captura acima do fundo', async () => {
    await abrir();
    const tela = document.querySelector('[data-mk-captura-gps]');
    expect(tela?.parentElement).toBe(document.body);
    expect(m.basemapOpts?.inicial).toBe('satelite');
    expect(m.basemapOpts?.prefixosNegocio).toContain('m2a-');
  });
});
