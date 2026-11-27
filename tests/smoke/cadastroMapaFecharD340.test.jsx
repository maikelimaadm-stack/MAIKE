/**
 * D-PROD-340 — fechar o cadastro do mapa não derruba o app; o "+" abre e volta sem a lista no meio.
 *  FC-01 fechar o editor (área nova, ponto marcado) com o mapa já removido não lança (antes: tela branca)
 *  FC-02 aberto pelo "+", a lista do cadastro nunca aparece (nem na ida nem na volta ao Mapa Geral)
 *  FC-03 o "+" fica dentro da coluna da direita, antes de Atualizar/Localizar/Mover
 *
 * (cabeçalho do harness herdado de D-PROD-333 — cadastro do mapa no celular:
 *  - "+" da aba Pontos abre o cadastro direto no ponto (`/mapacadastro?novo=ponto`);
 *  - "Usar minha localização" põe o ponto onde a pessoa está; "Continuar" abre o formulário com ele;
 *  - as listas do formulário lateral abrem DENTRO dele (tocar na lista não fecha o formulário).
 * O botão "Novo ponto" no Mapa Geral está em mapaFocoBarraV12.test.jsx (BARRA-9).
 */
import React, { useContext } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileSheetPortalCtx } from '@/components/common/MobileSheet';

const capturado = vi.hoisted(() => ({ ponto: null, alvo: undefined, aoCarregar: [], listas: 0 }));

vi.mock('maplibre-gl', () => {
  const Map = vi.fn(function Map() {
    return {
      dragPan: { disable: vi.fn(), enable: vi.fn() },
      touchZoomRotate: { disableRotation: vi.fn() },
      addControl: vi.fn(), remove() { this.removido = true; }, getZoom: () => 14, setZoom: vi.fn(), setCenter: vi.fn(), fitBounds: vi.fn(), jumpTo: vi.fn(),
      isStyleLoaded: () => true, project: vi.fn(() => ({ x: 0, y: 0 })), unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
      getSource() { if (this.removido) throw new TypeError("Cannot read properties of undefined (reading 'getSource')"); return null; }, getLayer: () => null, addSource: vi.fn(), addLayer: vi.fn(), setPaintProperty: vi.fn(), setStyle: vi.fn(),
      queryRenderedFeatures: vi.fn(() => []), once: vi.fn(), off: vi.fn(),
      on: vi.fn((ev, a) => { if (ev === 'load' && typeof a === 'function') capturado.aoCarregar.push(a); }), getCanvas: () => document.createElement('canvas'),
    };
  });
  class LngLatBounds { extend() { return this; } }
  const Marker = vi.fn(function Marker() {
    const m = { setLngLat: () => m, addTo: () => m, remove: vi.fn(), getElement: () => document.createElement('div'), on: vi.fn(), setDraggable: () => m };
    return m;
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
  listarSetoresAtivos: vi.fn(async () => []),
  listarPontosSuplementacaoDaEmpresa: vi.fn(async () => []),
  listarBebedourosAtivos: vi.fn(async () => []),
}));
/** O formulário de ponto falso guarda o que recebeu e para onde as listas dele abririam. */
function PontoFalso(props) {
  capturado.ponto = props;
  capturado.alvo = useContext(MobileSheetPortalCtx);
  return <p>formulário do ponto</p>;
}
vi.mock('@/components/mapa/FormularioPonto', () => ({ default: PontoFalso, FORMULARIO_PONTO_ID: 'f-ponto' }));
vi.mock('@/components/mapa/FormularioArea', () => ({ default: () => null, FORMULARIO_AREA_ID: 'f-area' }));
vi.mock('@/components/mapa/FormularioLinha', () => ({ default: () => null, FORMULARIO_LINHA_ID: 'f-linha' }));
vi.mock('@/components/mapa/cadastro/TelaCadastroMapa', () => ({ default: () => { capturado.listas += 1; return <p>lista do cadastro</p>; } }));
vi.mock('@/components/mapa/cadastro/AcoesEmLoteAreas', () => ({ default: () => null }));
vi.mock('@/components/mapa/importacaoAreas/ImportarAreasDialog', () => ({ default: () => null }));
vi.mock('@/components/mapa/SelecaoAreasMapa', () => ({ default: () => null }));
vi.mock('@/components/mapa/ModalCadastroLotePontos', () => ({ default: () => null }));

const AQUI = { latitude: -15.6, longitude: -56.1, accuracy: 4 };
let qc;
const rota = { atual: '' };
function SondaDeRota() {
  const l = useLocation();
  rota.atual = `${l.pathname}${l.search}`;
  return null;
}
const geolocalizacaoOriginal = navigator.geolocation;

beforeEach(() => {
  cleanup();
  capturado.ponto = null;
  capturado.alvo = undefined;
  capturado.aoCarregar = [];
  capturado.listas = 0;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn((ok) => ok({ coords: AQUI, timestamp: Date.now() })),
    },
  });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocalizacaoOriginal });
});

/** O mapa falso "termina de carregar". */
const carregarMapa = () => act(async () => { for (const f of capturado.aoCarregar.splice(0)) f(); await Promise.resolve(); });

const abrirDesenhoDePonto = async () => {
  const { default: MapaDesenho } = await import('@/components/mapa/MapaDesenho.jsx');
  await act(async () => {
    render(<QueryClientProvider client={qc}><MapaDesenho tipoDesenho="ponto" onSalvar={() => {}} onCancelar={() => {}} /></QueryClientProvider>);
  });
  await carregarMapa();
};


describe('D-PROD-340 — fechar o editor do cadastro', () => {
  for (const tipo of ['area', 'linha']) {
    it(`FC-01 fechar o editor de ${tipo} nova não lança (o mapa já foi removido)`, async () => {
      const { default: MapaDesenho } = await import('@/components/mapa/MapaDesenho.jsx');
      let r;
      await act(async () => {
        r = render(<QueryClientProvider client={qc}><MapaDesenho tipoDesenho={tipo} onSalvar={() => {}} onCancelar={() => {}} /></QueryClientProvider>);
      });
      await carregarMapa();
      expect(() => act(() => { r.unmount(); })).not.toThrow();
    });
  }

  it('FC-01 fechar o editor de ponto com o ponto marcado não lança', async () => {
    await abrirDesenhoDePonto();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usar minha localização' })); });
    expect(() => act(() => { cleanup(); })).not.toThrow();
  });
});

describe('D-PROD-340 — o "+" da aba Pontos', () => {
  it('FC-02 aberto pelo "+", a lista do cadastro nunca aparece — nem na ida nem na volta', async () => {
    const { default: MapaCadastro } = await import('@/pages/MapaCadastro.jsx');
    await act(async () => {
      render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/mapacadastro?novo=ponto']}><SondaDeRota /><MapaCadastro /></MemoryRouter></QueryClientProvider>);
    });
    await carregarMapa();
    expect(screen.getByRole('button', { name: 'Usar minha localização' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fechar editor' })); });
    expect(rota.atual).toBe('/mapageral');
    expect(capturado.listas).toBe(0);
  });

  it('FC-03 o "+" fica dentro da coluna da direita, antes de Atualizar/Localizar/Mover', async () => {
    const { default: MapaControlesMobile } = await import('@/components/mapa/MapaControlesMobile.jsx');
    const { container } = render(
      <MapaControlesMobile mapType="satellite" setMapType={() => {}} onRefresh={() => {}} onLocate={() => {}} onToggleDrag={() => {}}
        showLocalizarButton showMoverButton acimaDaPilha={<button type="button" aria-label="Novo ponto" />} />
    );
    const coluna = container.querySelector('.mk-mapa-dir');
    expect(coluna.firstElementChild).toBe(screen.getByRole('button', { name: 'Novo ponto' }));
    expect(coluna.querySelector('.mk-mapa-pilha')).toBeTruthy();
  });
});
