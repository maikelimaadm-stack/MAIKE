/**
 * D-PROD-333 — cadastro do mapa no celular:
 *  - "+" da aba Pontos abre o cadastro direto no ponto (`/mapacadastro?novo=ponto`);
 *  - "Usar minha localização" põe o ponto onde a pessoa está; "Continuar" abre o formulário com ele;
 *  - as listas do formulário lateral abrem DENTRO dele (tocar na lista não fecha o formulário).
 * O botão "Novo ponto" no Mapa Geral está em mapaFocoBarraV12.test.jsx (BARRA-9).
 */
import React, { useContext } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileSheetPortalCtx } from '@/components/common/MobileSheet';

const capturado = vi.hoisted(() => ({ ponto: null, alvo: undefined, aoCarregar: [] }));

vi.mock('maplibre-gl', () => {
  const Map = vi.fn(function Map() {
    return {
      dragPan: { disable: vi.fn(), enable: vi.fn() },
      touchZoomRotate: { disableRotation: vi.fn() },
      addControl: vi.fn(), remove: vi.fn(), getZoom: () => 14, setZoom: vi.fn(), setCenter: vi.fn(), fitBounds: vi.fn(), jumpTo: vi.fn(),
      isStyleLoaded: () => true, project: vi.fn(() => ({ x: 0, y: 0 })), unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
      getSource: () => null, getLayer: () => null, addSource: vi.fn(), addLayer: vi.fn(), setPaintProperty: vi.fn(), setStyle: vi.fn(),
      queryRenderedFeatures: vi.fn(() => []), once: vi.fn(), off: vi.fn(),
      on: vi.fn((ev, a) => { if (ev === 'load' && typeof a === 'function') capturado.aoCarregar.push(a); }), getCanvas: () => document.createElement('canvas'),
    };
  });
  class LngLatBounds { extend() { return this; } }
  const Marker = vi.fn(function Marker() {
    const m = { setLngLat: () => m, addTo: () => m, remove: vi.fn(), getElement: () => document.createElement('div'), on: vi.fn() };
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
vi.mock('@/components/mapa/cadastro/TelaCadastroMapa', () => ({ default: () => <p>lista do cadastro</p> }));
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

describe('D-PROD-333 — "+" da aba Pontos abre o cadastro direto no ponto', () => {
  it('/mapacadastro?novo=ponto abre o editor de ponto (com "Usar minha localização") e limpa o endereço', async () => {
    const { default: MapaCadastro } = await import('@/pages/MapaCadastro.jsx');
    await act(async () => {
      render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/mapacadastro?novo=ponto']}><SondaDeRota /><MapaCadastro /></MemoryRouter></QueryClientProvider>);
    });
    await carregarMapa();
    expect(screen.getByRole('button', { name: 'Usar minha localização' })).toBeInTheDocument();
    expect(screen.queryByText('lista do cadastro')).toBeNull();
    expect(rota.atual, 'o pedido sai do endereço: voltar não reabre o cadastro').toBe('/mapacadastro');
  });

  it('aberto pelo "+", fechar o editor volta ao Mapa Geral (não à lista do cadastro)', async () => {
    const { default: MapaCadastro } = await import('@/pages/MapaCadastro.jsx');
    await act(async () => {
      render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/mapacadastro?novo=ponto']}><SondaDeRota /><MapaCadastro /></MemoryRouter></QueryClientProvider>);
    });
    await carregarMapa();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fechar editor' })); });
    expect(rota.atual).toBe('/mapageral');
  });

  it('sem o pedido, o cadastro abre na lista, como antes', async () => {
    const { default: MapaCadastro } = await import('@/pages/MapaCadastro.jsx');
    await act(async () => {
      render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/mapacadastro']}><MapaCadastro /></MemoryRouter></QueryClientProvider>);
    });
    expect(screen.getByText('lista do cadastro')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar minha localização' })).toBeNull();
  });
});

describe('D-PROD-333 — "Usar minha localização" no cadastro de ponto', () => {
  it('põe o ponto na posição do GPS; "Continuar" abre o formulário com ela', async () => {
    await abrirDesenhoDePonto();
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();
    expect(screen.getByText('Toque no mapa para marcar — ou use a sua localização')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usar minha localização' })); });
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalled();
    expect(screen.getByText('Arraste o ponto para ajustar e toque em Continuar')).toBeInTheDocument();
    expect(continuar).not.toBeDisabled();
    expect(screen.queryByText('formulário do ponto'), 'marcar não abre o formulário sozinho').toBeNull();

    await act(async () => { fireEvent.click(continuar); });
    expect(screen.getByText('formulário do ponto')).toBeInTheDocument();
    expect(capturado.ponto.coordenadas).toEqual({ lat: AQUI.latitude, lng: AQUI.longitude });
  });

  it('sem GPS, avisa e não marca o ponto', async () => {
    navigator.geolocation.getCurrentPosition = vi.fn((_ok, erro) => erro({ code: 1 }));
    await abrirDesenhoDePonto();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usar minha localização' })); });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });
});

describe('D-PROD-333 — a lista do formulário abre dentro do formulário lateral', () => {
  it('as listas do formulário de ponto têm como destino um lugar DENTRO do painel', async () => {
    await abrirDesenhoDePonto();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usar minha localização' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continuar' })); });
    const painel = screen.getByRole('dialog');
    expect(painel.className).toContain('mk-form-mapa-host');
    expect(capturado.alvo).toBeInstanceOf(HTMLElement);
    expect(painel.contains(capturado.alvo)).toBe(true);
  });

  it('os três formulários (área, ponto, linha) usam o destino de dentro e o Esc fecha só a lista', () => {
    const src = readFileSync('src/components/mapa/MapaDesenho.jsx', 'utf8');
    for (const alvo of ['alvoFolhaArea', 'alvoFolhaPonto', 'alvoFolhaLinha']) {
      expect(src).toContain(`<MobileSheetPortalCtx.Provider value={${alvo}}>`);
      expect(src).toContain(`onEscapeKeyDown={(e) => escSoDaLista(e, ${alvo})}`);
    }
    expect(src.match(/mk-form-mapa-host/g)?.length).toBe(3);
    const css = readFileSync('src/styles/mk-cadastro-mapa.css', 'utf8');
    expect(css).toMatch(/\.mk-form-mapa-host \.mk-sheet-root\s*\{\s*pointer-events:\s*auto;/);
  });

  it('o mapa do cadastro abre no satélite e mostra a minha localização, como o Mapa Geral', () => {
    const src = readFileSync('src/components/mapa/MapaDesenho.jsx', 'utf8');
    expect(src).toContain('inicial: BASEMAP_IDS.SATELITE');
    expect(src).toContain('useMinhaLocalizacaoNoEditor(');
  });
});
