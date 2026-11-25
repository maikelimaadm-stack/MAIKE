/**
 * D-PROD-302 — localização no Mapa Geral: GPS de alta precisão sempre ligado
 * com a camada, leitura ruim não substitui uma boa recente, e o mapa acompanha
 * depois de "Localizar" (arrastar para de acompanhar).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { leituraEntra, mensagemDoErroGps, useLocalizacaoNoMapa } from '@/components/mapa/useLocalizacaoNoMapa';

/** Mapa falso com os eventos que o hook usa. */
const novoMapa = () => {
  const ouvintes = {};
  return {
    jumps: [],
    eases: [],
    on: (ev, fn) => { (ouvintes[ev] ||= []).push(fn); },
    off: (ev, fn) => { ouvintes[ev] = (ouvintes[ev] || []).filter((f) => f !== fn); },
    disparar: (ev) => (ouvintes[ev] || []).forEach((f) => f()),
    jumpTo(o) { this.jumps.push(o); },
    easeTo(o) { this.eases.push(o); },
    getZoom: () => 14,
  };
};

const leitura = (lat, lng, accuracy, timestamp = Date.now()) => ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp });

let watch;
let pedidoAtual;
beforeEach(() => {
  watch = null;
  pedidoAtual = null;
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok, erro, opcoes) => { watch = { ok, erro, opcoes }; return 7; }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn((ok, erro, opcoes) => { pedidoAtual = { ok, erro, opcoes }; }),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('D-PROD-302 — leitura do GPS', () => {
  it('LM-01 leitura muito pior (rede no lugar do GPS) não substitui uma boa recente; depois de 30 s, entra', () => {
    const boa = { lat: -15, lng: -59, accuracy: 8, em: 1_000_000 };
    expect(leituraEntra(null, boa)).toBe(true);
    expect(leituraEntra(boa, { lat: -15.1, lng: -59.1, accuracy: 900, em: 1_010_000 })).toBe(false);
    expect(leituraEntra(boa, { lat: -15.0001, lng: -59, accuracy: 12, em: 1_010_000 })).toBe(true);
    expect(leituraEntra(boa, { lat: -15.1, lng: -59.1, accuracy: 900, em: 1_040_000 })).toBe(true);
  });

  it('LM-02 mensagens: permissão negada e GPS desligado avisam; tempo esgotado não', () => {
    expect(mensagemDoErroGps({ code: 1 })).toMatch(/Permita a localização/);
    expect(mensagemDoErroGps({ code: 2 })).toMatch(/Ligue a localização/);
    expect(mensagemDoErroGps({ code: 3 })).toBeNull();
  });
});

describe('D-PROD-302 — o mapa acompanha a pessoa', () => {
  it('LM-03 com a camada ligada o GPS fica ligado em alta precisão; "Localizar" centraliza, acompanha andando e para ao arrastar', () => {
    const mapa = novoMapa();
    const ref = { current: mapa };
    const { result, unmount } = renderHook(() => useLocalizacaoNoMapa({ mapInstanceRef: ref, ativo: true }));
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(watch.opcoes).toMatchObject({ enableHighAccuracy: true });

    act(() => watch.ok(leitura(-15.0, -59.0, 6)));
    expect(result.current.posicao).toMatchObject({ lat: -15.0, lng: -59.0, accuracy: 6 });
    expect(mapa.eases).toHaveLength(0); // ainda não pediu para acompanhar

    act(() => result.current.localizar());
    expect(mapa.jumps.at(-1)).toEqual({ center: [-59.0, -15.0], zoom: 18 });
    expect(result.current.seguindo).toBe(true);

    act(() => watch.ok(leitura(-15.001, -59.001, 5)));
    expect(mapa.eases.at(-1)).toMatchObject({ center: [-59.001, -15.001] });

    act(() => mapa.disparar('dragstart'));
    expect(result.current.seguindo).toBe(false);
    act(() => watch.ok(leitura(-15.002, -59.002, 5)));
    expect(mapa.eases).toHaveLength(1); // parou de acompanhar
    expect(result.current.posicao).toMatchObject({ lat: -15.002 }); // o ponto continua andando

    unmount();
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(7);
  });

  it('LM-04 a tela recusa a resposta (trocou de fazenda no meio): não pula nem acompanha', () => {
    const mapa = novoMapa();
    const { result } = renderHook(() => useLocalizacaoNoMapa({ mapInstanceRef: { current: mapa }, ativo: false }));
    act(() => result.current.localizar({ aoResponder: () => false }));
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(pedidoAtual.opcoes).toMatchObject({ enableHighAccuracy: true });
    act(() => pedidoAtual.ok(leitura(-21.5, -51.5, 10)));
    expect(mapa.jumps).toHaveLength(0);
    expect(result.current.seguindo).toBe(false);
    expect(result.current.posicao).toMatchObject({ lat: -21.5 });
  });

  it('LM-05 sem permissão do celular: avisa uma vez', () => {
    const aoErro = vi.fn();
    renderHook(() => useLocalizacaoNoMapa({ mapInstanceRef: { current: novoMapa() }, ativo: true, aoErro }));
    act(() => watch.erro({ code: 1 }));
    act(() => watch.erro({ code: 1 }));
    expect(aoErro).toHaveBeenCalledTimes(1);
  });
});
