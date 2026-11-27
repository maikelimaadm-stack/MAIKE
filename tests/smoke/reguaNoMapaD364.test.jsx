/**
 * D-PROD-364 — a régua (medir no mapa sem gravar nada), como no AgriWebb:
 *  - o editor em `soMedir` mede distância ou área, troca entre as duas e não tem Salvar/Terminar nem formulário;
 *  - a área mostra o perímetro já aberta; fechar a régua nunca pergunta (não há nada a perder).
 * O botão "Medir no mapa" do Mapa Geral está em mapaFocoBarraV12.test.jsx (BARRA-10).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ aoCarregar: [], canvas: null }));

vi.mock('maplibre-gl', () => {
  const Map = vi.fn(function Map() {
    return {
      dragPan: { disable: vi.fn(), enable: vi.fn() },
      touchZoomRotate: { disableRotation: vi.fn() },
      addControl: vi.fn(), remove: vi.fn(), getZoom: () => 16, setZoom: vi.fn(), setCenter: vi.fn(), fitBounds: vi.fn(), jumpTo: vi.fn(), easeTo: vi.fn(),
      getCenter: () => ({ lat: -15.6, lng: -56.1 }), isStyleLoaded: () => true,
      project: vi.fn((ll) => { const lng = Array.isArray(ll) ? ll[0] : ll.lng; const lat = Array.isArray(ll) ? ll[1] : ll.lat; return { x: lng * 1e5, y: -lat * 1e5 }; }),
      unproject: vi.fn((p) => { const [x, y] = Array.isArray(p) ? p : [p.x, p.y]; return { lng: x / 1e5, lat: -y / 1e5 }; }),
      getSource: () => null, getLayer: () => null, addSource: vi.fn(), addLayer: vi.fn(), setPaintProperty: vi.fn(), setStyle: vi.fn(),
      queryRenderedFeatures: vi.fn(() => []), once: vi.fn(), off: vi.fn(),
      on: vi.fn((ev, a) => { if (ev === 'load' && typeof a === 'function') m.aoCarregar.push(a); }),
      getCanvas: () => (m.canvas ||= document.createElement('canvas')),
    };
  });
  class LngLatBounds { extend() { return this; } }
  const Marker = vi.fn(function Marker(opts) {
    const mk = { setLngLat: () => mk, addTo: () => mk, remove: vi.fn(), getElement: () => opts?.element || document.createElement('div'), on: vi.fn() };
    return mk;
  });
  return { default: { Map, NavigationControl: vi.fn(), Marker, LngLatBounds }, Map, NavigationControl: vi.fn(), Marker, LngLatBounds };
});
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaService', () => ({
  listarAreasAtivas: vi.fn(async () => []), listarPontosAtivos: vi.fn(async () => []),
  listarLinhasAtivas: vi.fn(async () => []), listarIconesAtivos: vi.fn(async () => []),
}));
const formularios = vi.hoisted(() => ({ abertos: 0 }));
vi.mock('@/components/mapa/FormularioPonto', () => ({ default: () => { formularios.abertos += 1; return null; }, FORMULARIO_PONTO_ID: 'f-ponto' }));
vi.mock('@/components/mapa/FormularioArea', () => ({ default: () => { formularios.abertos += 1; return null; }, FORMULARIO_AREA_ID: 'f-area' }));
vi.mock('@/components/mapa/FormularioLinha', () => ({ default: () => { formularios.abertos += 1; return null; }, FORMULARIO_LINHA_ID: 'f-linha' }));

let qc;
const geolocalizacaoOriginal = navigator.geolocation;
beforeEach(() => {
  cleanup();
  m.aoCarregar = []; m.canvas = null; formularios.abertos = 0;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocalizacaoOriginal });
});

const abrir = async (tipo, props = {}) => {
  const { default: MapaDesenho } = await import('@/components/mapa/MapaDesenho.jsx');
  await act(async () => {
    render(<QueryClientProvider client={qc}><MapaDesenho tipoDesenho={tipo} soMedir {...props} /></QueryClientProvider>);
  });
  await act(async () => { for (const f of m.aoCarregar.splice(0)) f(); await Promise.resolve(); });
};
const tocar = (x, y) => act(async () => {
  m.canvas.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }), { pointerType: 'mouse', isPrimary: true }));
  m.canvas.dispatchEvent(Object.assign(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }), { pointerType: 'mouse', isPrimary: true }));
});

describe('D-PROD-364 — régua', () => {
  it('RG-01: distância — mede ao vivo, sem Terminar/Salvar; troca para área; fechar não pergunta', async () => {
    const onTrocarMedida = vi.fn();
    const onCancelar = vi.fn();
    await abrir('linha', { onTrocarMedida, onCancelar });
    expect(screen.getByRole('radio', { name: 'Distância' })).toHaveAttribute('aria-checked', 'true');
    await tocar(100, 100);
    await tocar(3000, 100);
    expect(screen.getByText(/\d.*(m|km)$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terminar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Área' }));
    expect(onTrocarMedida).toHaveBeenCalledWith('area');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fechar editor' })); });
    expect(onCancelar, 'com pontos desenhados, a régua fecha sem perguntar').toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('RG-02: área — perímetro já com a área aberta; "Fechar área" fecha e não abre formulário nem Salvar', async () => {
    await abrir('area');
    await tocar(100, 100);
    await tocar(3000, 100);
    await tocar(3000, 3000);
    expect(screen.getByTestId('medidas-area').textContent).toMatch(/Área: .* ha.*Perímetro:/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fechar área' })); });
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fechar área' })).toBeNull();
    expect(formularios.abertos, 'a régua nunca abre o formulário').toBe(0);
  });

  it('RG-03: fora da régua, o editor continua pedindo confirmação ao sair com desenho', async () => {
    const { default: MapaDesenho } = await import('@/components/mapa/MapaDesenho.jsx');
    const onCancelar = vi.fn();
    await act(async () => {
      render(<QueryClientProvider client={qc}><MapaDesenho tipoDesenho="linha" onCancelar={onCancelar} /></QueryClientProvider>);
    });
    await act(async () => { for (const f of m.aoCarregar.splice(0)) f(); await Promise.resolve(); });
    await tocar(100, 100);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fechar editor' })); });
    expect(onCancelar).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
