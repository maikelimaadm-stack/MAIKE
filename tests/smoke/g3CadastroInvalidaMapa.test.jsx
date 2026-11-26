/**
 * G3 — gravar/excluir área, ponto e linha no Cadastro do Mapa (MapaCadastro e
 * o editor MapaDesenho) invalida também o cache do Mapa Geral ('mapa-cache').
 * Antes só ['areas'] / ['pontos', ...] / ['linhas'] eram invalidados e o Mapa
 * Geral voltava com o dado antigo por até 5 minutos.
 */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const capturado = vi.hoisted(() => ({ forms: {}, telas: {} }));

vi.mock('maplibre-gl', () => {
  const Map = vi.fn(function Map() {
    return {
      dragPan: { disable: vi.fn(), enable: vi.fn() },
      touchZoomRotate: { disableRotation: vi.fn() },
      addControl: vi.fn(), remove: vi.fn(), getZoom: () => 14, setZoom: vi.fn(), setCenter: vi.fn(), fitBounds: vi.fn(),
      isStyleLoaded: () => true, project: vi.fn(() => ({ x: 0, y: 0 })), unproject: vi.fn(() => ({ lng: 0, lat: 0 })),
      getSource: () => null, getLayer: () => null, addSource: vi.fn(), addLayer: vi.fn(), setPaintProperty: vi.fn(), setStyle: vi.fn(),
      queryRenderedFeatures: vi.fn(() => []), once: vi.fn(), on: vi.fn(), off: vi.fn(), getCanvas: () => document.createElement('canvas'),
    };
  });
  class LngLatBounds { extend() { return this; } }
  const Marker = vi.fn(() => ({ setLngLat: () => ({ addTo: () => ({ remove: vi.fn() }) }) }));
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
  excluirArea: vi.fn(async () => {}),
  excluirLinha: vi.fn(async () => {}),
  excluirPontoComCascata: vi.fn(async () => {}),
}));
// Sheet sempre aberto: os três formulários ficam montados e o onSave acessível.
vi.mock('@/components/ui/sheet', () => {
  const Passa = ({ children }) => <div>{children}</div>;
  return { Sheet: Passa, SheetContent: Passa, SheetHeader: Passa, SheetTitle: Passa, SheetDescription: Passa };
});
const formFalso = (nome) => ({ default: (props) => { capturado.forms[nome] = props; return null; }, [`FORMULARIO_${nome.toUpperCase()}_ID`]: `f-${nome}` });
vi.mock('@/components/mapa/FormularioArea', () => formFalso('area'));
vi.mock('@/components/mapa/FormularioPonto', () => formFalso('ponto'));
vi.mock('@/components/mapa/FormularioLinha', () => formFalso('linha'));
vi.mock('@/components/mapa/cadastro/TelaCadastroMapa', () => ({
  default: (props) => {
    capturado.telas[props.queryKey[0]] = props;
    return null;
  },
}));
vi.mock('@/components/mapa/cadastro/AcoesEmLoteAreas', () => ({ default: () => null }));
vi.mock('@/components/mapa/importacaoAreas/ImportarAreasDialog', () => ({ default: () => null }));
vi.mock('@/components/mapa/SelecaoAreasMapa', () => ({ default: () => null }));
vi.mock('@/components/mapa/ModalCadastroLotePontos', () => ({ default: () => null }));

const CHAVES = ['areas', 'pontos', 'pontosSuplementacao', 'linhas'];
let qc;
const semear = () => {
  for (const k of CHAVES) qc.setQueryData(['mapa-cache', k, 'emp-1', 'default'], [{ id: 'velho' }]);
};
const invalidada = (k) => qc.getQueryState(['mapa-cache', k, 'emp-1', 'default'])?.isInvalidated === true;

beforeEach(() => {
  cleanup();
  capturado.forms = {};
  capturado.telas = {};
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  semear();
});
afterEach(() => cleanup());

describe('MapaDesenho — salvar no editor invalida o Mapa Geral', () => {
  for (const tipo of ['area', 'ponto', 'linha']) {
    it(`salvar ${tipo} invalida 'mapa-cache'`, async () => {
      const { default: MapaDesenho } = await import('@/components/mapa/MapaDesenho.jsx');
      const onSalvar = vi.fn();
      render(<QueryClientProvider client={qc}><MapaDesenho tipoDesenho={tipo} onSalvar={onSalvar} onCancelar={() => {}} /></QueryClientProvider>);
      expect(typeof capturado.forms[tipo]?.onSave).toBe('function');
      await act(async () => { capturado.forms[tipo].onSave({ id: 'novo' }); });
      expect(onSalvar).toHaveBeenCalled();
      expect(invalidada('areas')).toBe(true);
      expect(invalidada('linhas')).toBe(true);
    });
  }
});

describe('MapaCadastro — excluir e salvar no registro invalida o Mapa Geral', () => {
  const abrir = async () => {
    const { default: MapaCadastro } = await import('@/pages/MapaCadastro.jsx');
    render(<QueryClientProvider client={qc}><MemoryRouter><MapaCadastro /></MemoryRouter></QueryClientProvider>);
  };

  it('excluir área', async () => {
    await abrir();
    await act(async () => { await capturado.telas.areas.excluir(['a1']); });
    expect(invalidada('areas')).toBe(true);
  });

  it('salvar área pelo registro (formulário da tela)', async () => {
    await abrir();
    const onSalvo = vi.fn();
    render(<QueryClientProvider client={qc}>{capturado.telas.areas.formulario({ item: { id: 'a1' }, readOnly: false, onSalvo, onSalvandoChange: () => {}, chave: 'k' })}</QueryClientProvider>);
    await act(async () => { capturado.forms.area.onSave({ id: 'a1' }); });
    expect(onSalvo).toHaveBeenCalledWith({ id: 'a1' });
    expect(invalidada('areas')).toBe(true);
  });

  const trocarAba = async (rotulo) => {
    const { getAllByRole } = render(<div>{capturado.telas.areas.abas}</div>);
    const aba = getAllByRole('tab').find((el) => el.textContent === rotulo);
    await act(async () => { fireEvent.click(aba); });
  };

  it('excluir linha', async () => {
    await abrir();
    await trocarAba('Linhas');
    expect(typeof capturado.telas.linhas?.excluir).toBe('function');
    await act(async () => { await capturado.telas.linhas.excluir(['l1']); });
    expect(invalidada('linhas')).toBe(true);
  });

  it('excluir ponto', async () => {
    await abrir();
    await trocarAba('Pontos');
    await act(async () => { await capturado.telas.pontos.excluir(['p1'], [{ id: 'p1' }]); });
    expect(invalidada('pontos')).toBe(true);
    expect(invalidada('pontosSuplementacao')).toBe(true);
  });
});
