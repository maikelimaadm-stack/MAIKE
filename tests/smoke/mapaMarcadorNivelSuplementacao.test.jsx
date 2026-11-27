/**
 * D-PROD-178 (MAPA-NIVEIS-COCHO-DEPOSITO-UX01) — cocho/depósito no renderer REAL do Mapa Geral (`useMapRenderer`),
 * com MapLibre e canvas falsos. Desde a D-PROD-352 o cocho é desenhado pelo próprio mapa (fonte `mg-supl`, camada
 * `symbol`), não é mais marcador HTML:
 *
 *  - o `titulo` do ponto na fonte = nome do ponto + " — " + o mesmo texto do nível (`indicador_titulo`, que vem do
 *    SSOT): é o que era o `title`/`aria-label` do marcador (vira o título do canvas no mouse; o detalhe que abre ao
 *    tocar mostra o nível por extenso);
 *  - selo pintado no canto da imagem: "?" cinza quando o nível é neutro (sem estimativa, período fechado, sem
 *    limite…) e "!" âmbar quando o depósito está acima do limite operacional;
 *  - o MESMO ponto da fonte (mesmo id) troca de imagem quando o nível muda (virada do dia); quando só o texto muda,
 *    a imagem é a mesma (nada redesenhado); nível igual não mexe em nada;
 *  - o SVG não muda de modelo: a figura é `urlIconeCocho/urlIconeDeposito` do `indicador_percentual` (já
 *    quantizado em 1% pelo SSOT).
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { urlIconeCocho } from '@/assets/icones/cocho-descoberto.js';
import { urlIconeDeposito } from '@/assets/icones/deposito-sal.js';
import { descreverMarcadorSuplementacao } from '@/lib/maplibre/mapaGeralRender.js';
import { limparCacheImagensLotes } from '@/lib/maplibre/lotesNoMapa.js';
import { CORES_SELO_SUPLEMENTACAO, SUPL_LAYER_ID, SUPL_SOURCE_ID } from '@/lib/maplibre/pontosNoMapa.js';
import { instalarCanvasFalso } from './helpers/canvasLotesFalso.js';

const marcadores = [];
vi.mock('@/lib/maplibre/lifecycle.js', async (orig) => {
  const real = await orig();
  class Marker {
    constructor(opts) {
      this.el = opts.element;
      this.opts = opts;
      this.removed = false;
      marcadores.push(this);
    }
    setLngLat() {
      return this;
    }
    addTo(map) {
      map.container.appendChild(this.el);
      return this;
    }
    getElement() {
      return this.el;
    }
    setOffset() {
      return this;
    }
    remove() {
      this.removed = true;
      this.el.remove();
    }
  }
  class Popup {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() {}
  }
  return { ...real, maplibregl: { Marker, Popup, LngLatBounds: class {} }, setSourceData: (map, id, data) => map.data.set(id, data) };
});

const mkMap = () => {
  const container = document.createElement('div');
  const handlers = [];
  const images = new Map();
  const canvas = document.createElement('canvas');
  return {
    container,
    data: new Map(),
    handlers,
    images,
    getSource: () => undefined,
    addSource: () => {},
    getLayer: () => undefined,
    addLayer: () => {},
    addImage: vi.fn((id, img, opts) => images.set(id, { img, opts })),
    hasImage: (id) => images.has(id),
    removeImage: vi.fn((id) => images.delete(id)),
    on: (...a) => handlers.push(a),
    off: () => {},
    getZoom: () => 15,
    getCanvas: () => canvas,
    setFeatureState: vi.fn(),
    queryRenderedFeatures: () => [],
  };
};

const montarRenderer = async () => {
  const { default: useMapRenderer } = await import('@/components/mapa/useMapRenderer.jsx');
  const map = mkMap();
  const { result } = renderHook(() => useMapRenderer(/** @type {any} */ ({ current: map })));
  return { r: result.current, map };
};

const COCHO = { id: 'c1', nome_ponto: 'Cocho Norte', categoria_ponto: 'COCHO', coordenadas: { lat: -15, lng: -47 } };
const DEPOSITO = { id: 'd1', nome_ponto: 'Depósito Sede', categoria_ponto: 'DEPOSITO', coordenadas: { lat: -15.1, lng: -47.1 } };
const TXT_100 = 'Restante estimado: 200 kg de 200 kg (100%).';
const TXT_75 = 'Restante estimado: 150 kg de 200 kg (75%).';
const TXT_SEM_PV = 'Estimativa de consumo indisponível: o produto não tinha %PV no lançamento.';
const TXT_DEP_200 = 'Saldo de 600 kg: 200% do limite operacional de 300 kg (300 kg acima).';
const TXT_DEP_50 = 'Saldo de 150 kg: 50% do limite operacional de 300 kg.';

const cocho = (extra) => ({ ...COCHO, indicador_neutro: false, ...extra });
const deposito = (extra) => ({ ...DEPOSITO, indicador_neutro: false, indicador_alerta_excesso: false, ...extra });
/** O cocho/depósito na fonte do mapa (D-PROD-352). */
const pontoNaFonte = (map, id) => (map.data.get(SUPL_SOURCE_ID)?.features || []).find((f) => f.properties.id === id);
/** Selos escritos na imagem ("?" ou "!"), na ordem. */
const selosDesenhados = () => canvas.textos().filter((t) => t === '?' || t === '!');
/** Clique na camada dos cochos. */
const clicar = (map, id) => {
  for (const h of map.handlers) if (h[0] === 'click' && h[1] === SUPL_LAYER_ID) h[2]({ point: { x: 0, y: 0 }, features: [{ properties: { id } }] });
};

let canvas;
beforeEach(() => {
  marcadores.length = 0;
  limparCacheImagensLotes();
  canvas = instalarCanvasFalso();
});

describe('descreverMarcadorSuplementacao (pura)', () => {
  it('título = nome — texto do nível; sem texto do nível, só o nome', () => {
    expect(descreverMarcadorSuplementacao(cocho({ indicador_titulo: TXT_75 }))).toEqual({ titulo: `Cocho Norte — ${TXT_75}`, selo: null, farol: null });
    expect(descreverMarcadorSuplementacao({ nome_ponto: 'Cocho' })).toEqual({ titulo: 'Cocho', selo: null, farol: null });
    expect(descreverMarcadorSuplementacao({ nome_ponto: '  ', indicador_titulo: TXT_75 }).titulo).toBe(TXT_75);
    expect(descreverMarcadorSuplementacao(null)).toEqual({ titulo: '', selo: null, farol: null });
  });

  it('selo "?" quando neutro; "!" quando o depósito passa do limite', () => {
    expect(descreverMarcadorSuplementacao(cocho({ indicador_neutro: true, indicador_titulo: TXT_SEM_PV })).selo).toEqual({ tipo: 'neutro', texto: '?' });
    expect(descreverMarcadorSuplementacao(deposito({ indicador_alerta_excesso: true, indicador_titulo: TXT_DEP_200 })).selo).toEqual({ tipo: 'excesso', texto: '!' });
    expect(descreverMarcadorSuplementacao(deposito({ indicador_titulo: TXT_DEP_50 })).selo).toBeNull();
  });
});

describe('useMapRenderer.syncPontosSuplementacao — nível no cocho desenhado pelo mapa (D-PROD-178, D-PROD-352)', () => {
  it('cria com a figura do nível e o título do nível; sem selo quando há estimativa; nenhum marcador HTML', async () => {
    const { r, map } = await montarRenderer();
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 1, indicador_titulo: TXT_100 })], true, [], vi.fn());
    const f = pontoNaFonte(map, 'c1');
    expect(f).toBeTruthy();
    expect(f.properties.titulo).toBe(`Cocho Norte — ${TXT_100}`);
    expect(canvas.figurasCarregadas).toEqual([urlIconeCocho(1, true)]);
    expect(map.images.has(f.properties.imagem)).toBe(true);
    expect(selosDesenhados()).toEqual([]);
    expect(marcadores).toHaveLength(0);
  });

  it('virada do dia: o MESMO ponto troca figura e título; nível igual não redesenha nem republica', async () => {
    const { r, map } = await montarRenderer();
    const onClick = vi.fn();
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 1, indicador_titulo: TXT_100 })], true, [], onClick);
    const antes = pontoNaFonte(map, 'c1');
    const dados = map.data.get(SUPL_SOURCE_ID);
    const desenhos = canvas.desenhos();

    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 1, indicador_titulo: TXT_100 })], true, [], onClick);
    expect(canvas.desenhos(), 'mesmo nível: nada redesenhado').toBe(desenhos);
    expect(map.data.get(SUPL_SOURCE_ID), 'mesmo nível: fonte intacta').toBe(dados);

    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.75, indicador_titulo: TXT_75 })], true, [], onClick);
    expect(map.data.get(SUPL_SOURCE_ID).features).toHaveLength(1);
    const depois = pontoNaFonte(map, 'c1');
    expect(depois.properties.imagem).not.toBe(antes.properties.imagem);
    expect(canvas.figurasCarregadas).toContain(urlIconeCocho(0.75, true));
    expect(depois.properties.titulo).toBe(`Cocho Norte — ${TXT_75}`);

    // o clique entrega o ponto mais recente (o do nível novo)
    clicar(map, 'c1');
    expect(onClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c1', indicador_percentual: 0.75 }));
  });

  it('neutro ganha selo "?" cinza pintado na imagem; voltar a ter estimativa tira o selo', async () => {
    const { r, map } = await montarRenderer();
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.75, indicador_titulo: TXT_75 })], true, [], vi.fn());

    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV })], true, [], vi.fn());
    const texto = canvas.chamadas.find((c) => c.nome === 'fillText' && c.args[0] === '?');
    expect(texto.estado.fillStyle).toBe(CORES_SELO_SUPLEMENTACAO.neutro.texto);
    expect(canvas.chamadas.find((c) => c.nome === 'arc' && c.estado.fillStyle === CORES_SELO_SUPLEMENTACAO.neutro.fundo)).toBeTruthy();
    expect(canvas.figurasCarregadas).toContain(urlIconeCocho(0, true));
    const f = pontoNaFonte(map, 'c1');
    expect(f.properties.titulo).toBe(`Cocho Norte — ${TXT_SEM_PV}`);
    expect(f.properties.imagem).toMatch(/\|neutro\|/);

    canvas.chamadas.length = 0;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.5, indicador_titulo: 'Restante estimado: 100 kg de 200 kg (50%).' })], true, [], vi.fn());
    expect(selosDesenhados()).toEqual([]);
    expect(pontoNaFonte(map, 'c1').properties.imagem).not.toMatch(/neutro/);
    expect(canvas.figurasCarregadas).toContain(urlIconeCocho(0.5, true));
  });

  it('depósito acima do limite: figura cheia (fração ≤ 1), selo "!" âmbar e 200% no título; só o texto mudando não redesenha', async () => {
    const { r, map } = await montarRenderer();
    await r.syncPontosSuplementacao([deposito({ indicador_percentual: 1, indicador_alerta_excesso: true, indicador_titulo: TXT_DEP_200 })], true, [], vi.fn());
    expect(canvas.figurasCarregadas).toEqual([urlIconeDeposito(1, true)]);
    const f = pontoNaFonte(map, 'd1');
    expect(f.properties.titulo).toBe(`Depósito Sede — ${TXT_DEP_200}`);
    expect(f.properties.titulo).toContain('200%');
    expect(selosDesenhados(), 'na imagem e na reserva').toEqual(['!', '!']);
    expect(canvas.chamadas.find((c) => c.nome === 'fillText' && c.args[0] === '!').estado.fillStyle).toBe(CORES_SELO_SUPLEMENTACAO.excesso.texto);
    expect(canvas.chamadas.find((c) => c.nome === 'arc' && c.estado.fillStyle === CORES_SELO_SUPLEMENTACAO.excesso.fundo)).toBeTruthy();
    const desenhos = canvas.desenhos();

    // Mesmo ícone (continua cheio), texto diferente: só o título muda; a imagem é a mesma.
    const TXT_DEP_150 = 'Saldo de 450 kg: 150% do limite operacional de 300 kg (150 kg acima).';
    await r.syncPontosSuplementacao([deposito({ indicador_percentual: 1, indicador_alerta_excesso: true, indicador_titulo: TXT_DEP_150 })], true, [], vi.fn());
    expect(canvas.desenhos(), 'figura igual: nada redesenhado').toBe(desenhos);
    expect(pontoNaFonte(map, 'd1').properties.imagem).toBe(f.properties.imagem);
    expect(pontoNaFonte(map, 'd1').properties.titulo).toBe(`Depósito Sede — ${TXT_DEP_150}`);

    // Volta para dentro do limite: figura nova, sem selo.
    await r.syncPontosSuplementacao([deposito({ indicador_percentual: 0.5, indicador_titulo: TXT_DEP_50 })], true, [], vi.fn());
    expect(canvas.figurasCarregadas).toContain(urlIconeDeposito(0.5, true));
    expect(pontoNaFonte(map, 'd1').properties.imagem).not.toMatch(/excesso/);
    expect(pontoNaFonte(map, 'd1').properties.titulo).toBe(`Depósito Sede — ${TXT_DEP_50}`);
  });

  it('sem dados de nível (formato antigo): título só com o nome, sem selo', async () => {
    const { r, map } = await montarRenderer();
    await r.syncPontosSuplementacao([{ id: 'c9', nome_ponto: 'Cocho', coordenadas: { lat: 0, lng: 0 } }], true, [], vi.fn());
    expect(pontoNaFonte(map, 'c9').properties.titulo).toBe('Cocho');
    expect(selosDesenhados()).toEqual([]);
  });
});

describe('D-PROD-205 — farol da leitura de cocho no cocho desenhado pelo mapa', () => {
  const FAROL_VAZIO = { cor: 'vermelho', hex: '#dc2626', rotulo: 'Cocho vazio', texto: 'Leitura: Cocho vazio · Estrutura quebrada', avisos: 1 };
  const FAROL_CHEIO = { cor: 'azul', hex: '#2563eb', rotulo: 'Cocho cheio', texto: 'Leitura: Cocho cheio', avisos: 0 };
  /** Cores do miolo das bolinhas do farol pintadas (raio 4). */
  const farois = () => canvas.chamadas.filter((c) => c.nome === 'arc' && c.args[2] === 4).map((c) => c.estado.fillStyle);

  it('pura: o texto do farol entra no fim do título e a cor sai separada; sem farol, null', () => {
    expect(descreverMarcadorSuplementacao(cocho({ indicador_titulo: TXT_75, indicador_farol: FAROL_VAZIO }))).toEqual({
      titulo: `Cocho Norte — ${TXT_75} · Leitura: Cocho vazio · Estrutura quebrada`,
      selo: null,
      farol: { cor: 'vermelho', hex: '#dc2626' },
    });
    expect(descreverMarcadorSuplementacao(deposito({ indicador_titulo: TXT_DEP_50, indicador_farol: null })).farol).toBeNull();
  });

  it('pinta o farol sem tirar o selo; troca de cor no MESMO ponto; sem farol, some', async () => {
    const { r, map } = await montarRenderer();
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV, indicador_farol: FAROL_VAZIO })], true, [], vi.fn());
    // a imagem do ponto e a reserva dele levam o farol
    expect(farois()).toEqual(['#dc2626', '#dc2626']);
    expect(selosDesenhados(), 'o selo "?" continua').toEqual(['?', '?']);
    expect(pontoNaFonte(map, 'c1').properties.titulo).toBe(`Cocho Norte — ${TXT_SEM_PV} · Leitura: Cocho vazio · Estrutura quebrada`);

    canvas.chamadas.length = 0;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV, indicador_farol: FAROL_CHEIO })], true, [], vi.fn());
    expect(map.data.get(SUPL_SOURCE_ID).features).toHaveLength(1);
    expect(farois()).toContain('#2563eb');
    expect(pontoNaFonte(map, 'c1').properties.imagem).toMatch(/#2563eb/);

    canvas.chamadas.length = 0;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV, indicador_farol: null })], true, [], vi.fn());
    expect(farois()).toEqual([]);
    expect(selosDesenhados()).toEqual(['?', '?']);
  });
});
