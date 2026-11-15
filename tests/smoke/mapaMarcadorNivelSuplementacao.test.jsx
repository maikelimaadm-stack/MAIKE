/**
 * D-PROD-178 (MAPA-NIVEIS-COCHO-DEPOSITO-UX01) — marcador de cocho/depósito no
 * renderer REAL do Mapa Geral (`useMapRenderer`), com MapLibre falso.
 *
 *  - `title` e `aria-label` do marcador = nome do ponto + " — " + o mesmo texto
 *    do nível (`indicador_titulo`, que vem do SSOT);
 *  - selo pequeno no canto: "?" cinza quando o nível é neutro (sem estimativa,
 *    período fechado, sem limite…) e "!" âmbar quando o depósito está acima do
 *    limite operacional; o selo é decorativo (`aria-hidden`) — o texto acessível
 *    é o `aria-label`;
 *  - o diff por `estado` inclui título e selo: quando o nível muda (virada do
 *    dia), o MESMO marcador troca ícone, título e selo; quando só o texto muda,
 *    o `<img>` é preservado; nível igual não mexe em nada;
 *  - o SVG não muda de modelo: o ícone é `urlIconeCocho/urlIconeDeposito` do
 *    `indicador_percentual` (já quantizado em 1% pelo SSOT).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { urlIconeCocho } from '@/assets/icones/cocho-descoberto.js';
import { urlIconeDeposito } from '@/assets/icones/deposito-sal.js';
import { descreverMarcadorSuplementacao } from '@/lib/maplibre/mapaGeralRender.js';

const marcadores = [];
vi.mock('@/lib/maplibre/lifecycle.js', async (orig) => {
  const real = await orig();
  class Marker {
    constructor(opts) {
      this.el = opts.element;
      this.opts = opts;
      this.handlers = {};
      this.removed = false;
      marcadores.push(this);
    }
    setLngLat(ll) {
      this.ll = Array.isArray(ll) ? { lng: ll[0], lat: ll[1] } : ll;
      return this;
    }
    getLngLat() {
      return this.ll;
    }
    addTo(map) {
      map.container.appendChild(this.el);
      return this;
    }
    getElement() {
      return this.el;
    }
    setDraggable(v) {
      this.draggable = v;
      return this;
    }
    setOffset() {
      return this;
    }
    on(ev, fn) {
      this.handlers[ev] = fn;
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
  return {
    container,
    data: new Map(),
    handlers,
    getSource: () => undefined,
    addSource: () => {},
    getLayer: () => undefined,
    addLayer: () => {},
    on: (...a) => handlers.push(a),
    off: () => {},
    getZoom: () => 15,
    getCanvas: () => ({ style: {} }),
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
const marcadorDe = (nome) => marcadores.find((m) => !m.removed && String(m.el.title).startsWith(nome));
const img = (m) => m.el.querySelector('img');
const selo = (m) => m.el.querySelector('.mg-supl-selo');

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

describe('useMapRenderer.syncPontosSuplementacao — nível no marcador (D-PROD-178)', () => {
  it('cria com ícone do nível, title e aria-label do nível; sem selo quando há estimativa', async () => {
    marcadores.length = 0;
    const { r } = await montarRenderer();
    r.syncPontosSuplementacao([cocho({ indicador_percentual: 1, indicador_titulo: TXT_100 })], true, [], vi.fn());
    const m = marcadorDe('Cocho Norte');
    expect(m).toBeTruthy();
    expect(m.el.title).toBe(`Cocho Norte — ${TXT_100}`);
    expect(m.el.getAttribute('aria-label'), 'aria-label definido ANTES do addTo (o MapLibre poria "Map marker")').toBe(`Cocho Norte — ${TXT_100}`);
    expect(img(m).getAttribute('src')).toBe(urlIconeCocho(1, true));
    expect(selo(m)).toBeNull();
  });

  it('virada do dia: o MESMO marcador troca ícone e título; nível igual não recria nada', async () => {
    marcadores.length = 0;
    const { r } = await montarRenderer();
    const onClick = vi.fn();
    r.syncPontosSuplementacao([cocho({ indicador_percentual: 1, indicador_titulo: TXT_100 })], true, [], onClick);
    const m = marcadorDe('Cocho Norte');
    const imgAntes = img(m);

    r.syncPontosSuplementacao([cocho({ indicador_percentual: 1, indicador_titulo: TXT_100 })], true, [], onClick);
    expect(img(m), 'mesmo nível: <img> preservado').toBe(imgAntes);

    r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.75, indicador_titulo: TXT_75 })], true, [], onClick);
    expect(marcadores.filter((x) => !x.removed)).toHaveLength(1);
    expect(m.removed).toBe(false);
    expect(img(m).getAttribute('src')).toBe(urlIconeCocho(0.75, true));
    expect(img(m).getAttribute('src')).not.toBe(urlIconeCocho(1, true));
    expect(m.el.title).toBe(`Cocho Norte — ${TXT_75}`);
    expect(m.el.getAttribute('aria-label')).toBe(`Cocho Norte — ${TXT_75}`);

    // o clique entrega o ponto mais recente (o do nível novo)
    m.el.click();
    expect(onClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c1', indicador_percentual: 0.75 }));
  });

  it('neutro ganha selo "?" cinza (decorativo); voltar a ter estimativa remove o selo', async () => {
    marcadores.length = 0;
    const { r } = await montarRenderer();
    r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.75, indicador_titulo: TXT_75 })], true, [], vi.fn());
    const m = marcadorDe('Cocho Norte');

    r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV })], true, [], vi.fn());
    const s = selo(m);
    expect(s).toBeTruthy();
    expect(s.textContent).toBe('?');
    expect(s.dataset.selo).toBe('neutro');
    expect(s.getAttribute('aria-hidden')).toBe('true');
    expect(s.style.pointerEvents).toBe('none');
    expect(img(m).getAttribute('src')).toBe(urlIconeCocho(0, true));
    expect(m.el.getAttribute('aria-label')).toBe(`Cocho Norte — ${TXT_SEM_PV}`);
    expect(m.el.querySelectorAll('.mg-supl-selo')).toHaveLength(1);

    r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.5, indicador_titulo: 'Restante estimado: 100 kg de 200 kg (50%).' })], true, [], vi.fn());
    expect(selo(m)).toBeNull();
    expect(img(m).getAttribute('src')).toBe(urlIconeCocho(0.5, true));
  });

  it('depósito acima do limite: ícone cheio (fração ≤ 1), selo "!" âmbar e 200% no título; só o texto mudando preserva o <img>', async () => {
    marcadores.length = 0;
    const { r } = await montarRenderer();
    r.syncPontosSuplementacao([deposito({ indicador_percentual: 1, indicador_alerta_excesso: true, indicador_titulo: TXT_DEP_200 })], true, [], vi.fn());
    const m = marcadorDe('Depósito Sede');
    expect(img(m).getAttribute('src')).toBe(urlIconeDeposito(1, true));
    expect(m.el.title).toBe(`Depósito Sede — ${TXT_DEP_200}`);
    expect(m.el.getAttribute('aria-label')).toContain('200%');
    expect(selo(m)?.textContent).toBe('!');
    expect(selo(m)?.dataset.selo).toBe('excesso');
    const imgAntes = img(m);

    // Mesmo ícone (continua cheio), texto diferente: só título e selo mudam.
    const TXT_DEP_150 = 'Saldo de 450 kg: 150% do limite operacional de 300 kg (150 kg acima).';
    r.syncPontosSuplementacao([deposito({ indicador_percentual: 1, indicador_alerta_excesso: true, indicador_titulo: TXT_DEP_150 })], true, [], vi.fn());
    expect(img(m), 'ícone igual: <img> preservado').toBe(imgAntes);
    expect(m.el.title).toBe(`Depósito Sede — ${TXT_DEP_150}`);
    expect(selo(m)?.textContent).toBe('!');

    // Volta para dentro do limite: ícone novo, sem selo.
    r.syncPontosSuplementacao([deposito({ indicador_percentual: 0.5, indicador_titulo: TXT_DEP_50 })], true, [], vi.fn());
    expect(img(m).getAttribute('src')).toBe(urlIconeDeposito(0.5, true));
    expect(selo(m)).toBeNull();
    expect(m.el.getAttribute('aria-label')).toBe(`Depósito Sede — ${TXT_DEP_50}`);
  });

  it('sem dados de nível (formato antigo): título só com o nome, sem selo', async () => {
    marcadores.length = 0;
    const { r } = await montarRenderer();
    r.syncPontosSuplementacao([{ id: 'c9', nome_ponto: 'Cocho', coordenadas: { lat: 0, lng: 0 } }], true, [], vi.fn());
    const m = marcadorDe('Cocho');
    expect(m.el.title).toBe('Cocho');
    expect(m.el.getAttribute('aria-label')).toBe('Cocho');
    expect(selo(m)).toBeNull();
  });
});

describe('D-PROD-205 — farol da leitura de cocho no marcador', () => {
  const farol = (m) => m.el.querySelector('.mg-supl-farol');
  const FAROL_VAZIO = { cor: 'vermelho', hex: '#dc2626', rotulo: 'Cocho vazio', texto: 'Leitura: Cocho vazio · Estrutura quebrada', avisos: 1 };
  const FAROL_CHEIO = { cor: 'azul', hex: '#2563eb', rotulo: 'Cocho cheio', texto: 'Leitura: Cocho cheio', avisos: 0 };

  it('pura: o texto do farol entra no fim do título e a cor sai separada; sem farol, null', () => {
    expect(descreverMarcadorSuplementacao(cocho({ indicador_titulo: TXT_75, indicador_farol: FAROL_VAZIO }))).toEqual({
      titulo: `Cocho Norte — ${TXT_75} · Leitura: Cocho vazio · Estrutura quebrada`,
      selo: null,
      farol: { cor: 'vermelho', hex: '#dc2626' },
    });
    expect(descreverMarcadorSuplementacao(deposito({ indicador_titulo: TXT_DEP_50, indicador_farol: null })).farol).toBeNull();
  });

  it('desenha o ponto do farol (decorativo) sem tirar o selo; troca de cor no MESMO marcador; sem farol, some', async () => {
    marcadores.length = 0;
    const { r } = await montarRenderer();
    r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV, indicador_farol: FAROL_VAZIO })], true, [], vi.fn());
    const m = marcadorDe('Cocho Norte');
    expect(farol(m).dataset.farol).toBe('vermelho');
    expect(farol(m).getAttribute('aria-hidden')).toBe('true');
    expect(selo(m).textContent, 'o selo "?" continua').toBe('?');
    expect(m.el.getAttribute('aria-label')).toBe(`Cocho Norte — ${TXT_SEM_PV} · Leitura: Cocho vazio · Estrutura quebrada`);

    r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV, indicador_farol: FAROL_CHEIO })], true, [], vi.fn());
    expect(m.removed).toBe(false);
    expect(m.el.querySelectorAll('.mg-supl-farol')).toHaveLength(1);
    expect(farol(m).dataset.farol).toBe('azul');

    r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV, indicador_farol: null })], true, [], vi.fn());
    expect(farol(m)).toBeNull();
    expect(selo(m)).toBeTruthy();
  });
});
