/**
 * D-PROD-361 — cadastrar no mapa como no AgriWebb, etapa 1:
 *  - o "+" da aba Pontos oferece Novo pasto · Novo ponto · Nova linha;
 *  - `/mapacadastro?novo=area|linha` abre direto o editor certo (antes só `ponto`);
 *  - no dedo, o vértice e a linha têm folga de toque maior e os botões do editor têm alvo de 44px.
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

describe('D-PROD-361 — "+" com pasto, ponto e linha', () => {
  it('MC-01: o "+" abre a escolha e cada opção pede o seu tipo', async () => {
    const { default: NovoCadastroMapaBotao } = await import('@/components/mapa/NovoCadastroMapaBotao.jsx');
    const onEscolher = vi.fn();
    render(<NovoCadastroMapaBotao onEscolher={onEscolher} />);
    expect(screen.queryByRole('menu')).toBeNull();
    for (const [nome, tipo] of [['Novo pasto', 'area'], ['Novo ponto', 'ponto'], ['Nova linha', 'linha']]) {
      fireEvent.click(screen.getByRole('button', { name: 'Novo cadastro no mapa' }));
      fireEvent.click(screen.getByRole('menuitem', { name: nome }));
      expect(onEscolher).toHaveBeenLastCalledWith(tipo);
      expect(screen.queryByRole('menu'), 'a escolha fecha depois do toque').toBeNull();
    }
  });

  it('MC-02: /mapacadastro?novo=area abre o editor de pasto e limpa o endereço', async () => {
    const { default: MapaCadastro } = await import('@/pages/MapaCadastro.jsx');
    await act(async () => {
      render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/mapacadastro?novo=area']}><SondaDeRota /><MapaCadastro /></MemoryRouter></QueryClientProvider>);
    });
    await carregarMapa();
    expect(screen.getByRole('button', { name: 'Desenhar pontos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mover área inteira' })).toBeInTheDocument();
    expect(screen.queryByText('lista do cadastro')).toBeNull();
    expect(rota.atual).toBe('/mapacadastro');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fechar editor' })); });
    expect(rota.atual, 'aberto pelo "+", fechar volta ao Mapa Geral').toBe('/mapageral');
  });

  it('MC-03: /mapacadastro?novo=linha abre o editor de linha, com "Mover linha inteira"', async () => {
    const { default: MapaCadastro } = await import('@/pages/MapaCadastro.jsx');
    await act(async () => {
      render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/mapacadastro?novo=linha']}><SondaDeRota /><MapaCadastro /></MemoryRouter></QueryClientProvider>);
    });
    await carregarMapa();
    expect(screen.getByRole('button', { name: 'Desenhar pontos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mover linha inteira' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mover área inteira' })).toBeNull();
  });

  it('MC-04: um pedido desconhecido abre a lista, como antes', async () => {
    const { default: MapaCadastro } = await import('@/pages/MapaCadastro.jsx');
    await act(async () => {
      render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/mapacadastro?novo=toString']}><MapaCadastro /></MemoryRouter></QueryClientProvider>);
    });
    expect(screen.getByText('lista do cadastro')).toBeInTheDocument();
  });
});

describe('D-PROD-361 — editor no dedo', () => {
  it('MC-05: o toque é reconhecido pelo touchstart e pelo pointer do WebView', async () => {
    const { eToque } = await import('@/lib/maplibre/editorVisual.js');
    expect(eToque({ type: 'touchstart' })).toBe(true);
    expect(eToque({ type: 'pointerdown', pointerType: 'touch' })).toBe(true);
    expect(eToque({ type: 'pointerdown', pointerType: 'pen' })).toBe(true);
    expect(eToque({ type: 'mousedown' })).toBe(false);
    expect(eToque({ type: 'pointerdown', pointerType: 'mouse' })).toBe(false);
    expect(eToque(null)).toBe(false);
  });

  it('MC-06: no dedo o vértice e o meio pegam a 22px (antes 14px), no mouse continua 8px', async () => {
    const { EDITOR_VISUAL } = await import('@/lib/maplibre/estiloAreas.js');
    const { acertoEditor } = await import('@/lib/maplibre/editorVisual.js');
    expect(EDITOR_VISUAL.acerto).toEqual({ mouse: 8, toque: 22 });
    const camadas = { vertices: 'v', meios: null };
    const visto = [];
    const m = {
      getLayer: () => true,
      queryRenderedFeatures: (caixa) => {
        visto.push(caixa);
        const [[x0, y0], [x1, y1]] = caixa;
        return x0 <= 0 && x1 >= 0 && y0 <= 20 && y1 >= 20 ? [{ properties: { role: 'vertex', index: 0 }, layer: { id: 'v' }, geometry: { type: 'Point', coordinates: [0, 0] } }] : [];
      },
      project: () => ({ x: 0, y: 20 }),
    };
    expect(acertoEditor(m, { x: 0, y: 0 }, { camadas }), 'mouse: 20px está longe').toBeNull();
    expect(acertoEditor(m, { x: 0, y: 0 }, { camadas, toque: true })).toMatchObject({ role: 'vertex', index: 0 });
  });

  it('MC-07: botões do editor com alvo de 44px na tela de toque', () => {
    const css = readFileSync('src/styles/mk-cadastro-mapa.css', 'utf8');
    const bloco = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(bloco).toMatch(/\.mk-editor-mapa \.mk-editor-fechar \{ width: 44px; height: 44px; \}/);
    expect(bloco).toMatch(/\.mk-editor-mapa \.mk-editor-barra button \{ min-height: 44px; min-width: 44px; \}/);
    const editor = readFileSync('src/components/mapa/MapaDesenho.jsx', 'utf8');
    expect(editor).toContain('mk-editor-mapa');
    expect(editor.match(/mk-editor-barra[ "]/g)?.length).toBe(2);
    expect(editor).toContain('mk-editor-barra-baixo');
    expect(editor).toContain('mk-editor-rodape');
    // a barra de baixo ocupa até a tela inteira e quebra em linhas (presa em left:50% ela passava da tela)
    expect(css).toMatch(/\.mk-editor-mapa \.mk-editor-rodape \{ width: max-content; max-width: calc\(100vw - 16px\); \}/);
    expect(css).toMatch(/\.mk-editor-mapa \.mk-editor-barra-baixo \{ flex-wrap: wrap;/);
    expect(editor).toContain('mk-editor-fechar');
  });
});
