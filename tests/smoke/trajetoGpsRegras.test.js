/**
 * Rastreio do trajeto (GPS fase 1) — regras puras: filtro de ponto, amostragem, haversine, lotes de 200, distância e
 * o formato "1,2 km" / "850 m". Sem React e sem navegador.
 */
import { describe, it, expect } from 'vitest';
import {
  dividirEmLotes,
  deveGravar,
  distanciaAcumulada,
  filtroDePonto,
  formatarDistancia,
  haversineM,
  paraPontoDoServidor,
  LOTE_MAX_PONTOS,
} from '@/lib/trajetoGpsRegras';

/** Desloca a latitude em `metros` (1 grau de latitude ≈ 111.320 m). */
const deslocar = (lat, metros) => lat + metros / 111320;
const ponto = (lat, lng, em, extra = {}) => ({ lat, lng, em, precisao_m: 5, velocidade_ms: null, ...extra });

describe('haversine', () => {
  it('1 grau de latitude dá ~111,2 km; mesmo ponto dá zero', () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111195, -2);
    expect(haversineM({ lat: -15, lng: -59 }, { lat: -15, lng: -59 })).toBe(0);
  });

  it('10 m de deslocamento em latitude dá ~10 m', () => {
    expect(haversineM({ lat: -15, lng: -59 }, { lat: deslocar(-15, 10), lng: -59 })).toBeCloseTo(10, 1);
  });
});

describe('filtro de ponto', () => {
  const a = ponto(-15, -59, 1_000_000);

  it('o primeiro ponto entra se a precisão for boa', () => {
    expect(filtroDePonto(null, ponto(-15, -59, 1_000_000))).toEqual({ aceito: true });
  });

  it('descarta precisão acima de 50 m (e sem precisão)', () => {
    expect(filtroDePonto(null, ponto(-15, -59, 1, { precisao_m: 50 })).aceito).toBe(true);
    expect(filtroDePonto(null, ponto(-15, -59, 1, { precisao_m: 50.1 }))).toEqual({ aceito: false, motivo: 'precisao' });
    expect(filtroDePonto(null, ponto(-15, -59, 1, { precisao_m: null }))).toEqual({ aceito: false, motivo: 'precisao' });
  });

  it('descarta salto acima de 60 km/h em relação ao último gravado', () => {
    // 2 km em 60 s = 120 km/h: salto.
    const longe = ponto(deslocar(-15, 2000), -59, a.em + 60_000);
    expect(filtroDePonto(a, longe)).toEqual({ aceito: false, motivo: 'salto' });
    // 100 m em 60 s = 6 km/h: normal.
    expect(filtroDePonto(a, ponto(deslocar(-15, 100), -59, a.em + 60_000)).aceito).toBe(true);
  });
});

describe('amostragem', () => {
  const a = ponto(-15, -59, 1_000_000);

  it('o primeiro ponto grava', () => {
    expect(deveGravar(null, a)).toBe(true);
  });

  it('grava quando passou 10 s, ou 10 m (o que vier primeiro); não antes disso', () => {
    expect(deveGravar(a, ponto(-15, -59, 1_000_000 + 9_000))).toBe(false); // 9 s, no mesmo lugar
    // 10 s andando (3 m em 10 s = 0,3 m/s, acima do parado): grava pelo tempo.
    expect(deveGravar(a, ponto(deslocar(-15, 3), -59, 1_000_000 + 10_000))).toBe(true);
    const perto = ponto(deslocar(-15, 10.5), -59, 1_000_000 + 2_000); // 10,5 m em 2 s
    expect(deveGravar(a, perto)).toBe(true);
    const pertoDemais = ponto(deslocar(-15, 5), -59, 1_000_000 + 2_000); // 5 m em 2 s
    expect(deveGravar(a, pertoDemais)).toBe(false);
  });

  it('parado (abaixo de 1 km/h) grava só a cada 60 s', () => {
    expect(deveGravar(a, ponto(-15, -59, 1_000_000 + 30_000, { velocidade_ms: 0 }))).toBe(false);
    expect(deveGravar(a, ponto(-15, -59, 1_000_000 + 60_000, { velocidade_ms: 0 }))).toBe(true);
  });
});

describe('lotes', () => {
  it('divide em lotes de até 200 (o servidor aceita 1 a 200 por envio)', () => {
    expect(LOTE_MAX_PONTOS).toBe(200);
    const lista = Array.from({ length: 450 }, (_, i) => i);
    const lotes = dividirEmLotes(lista);
    expect(lotes.map((l) => l.length)).toEqual([200, 200, 50]);
    expect(lotes.flat()).toEqual(lista);
    expect(dividirEmLotes([])).toEqual([]);
  });
});

describe('distância acumulada e formato', () => {
  it('soma os trechos entre pontos consecutivos', () => {
    const pontos = [ponto(-15, -59, 0), ponto(deslocar(-15, 100), -59, 1), ponto(deslocar(-15, 300), -59, 2)];
    expect(distanciaAcumulada(pontos)).toBeCloseTo(300, 0);
    expect(distanciaAcumulada([])).toBe(0);
  });

  it('abaixo de 1 km mostra metros; a partir de 1 km, vírgula e 1 casa', () => {
    expect(formatarDistancia(850)).toBe('850 m');
    expect(formatarDistancia(0)).toBe('0 m');
    expect(formatarDistancia(1200)).toBe('1,2 km');
    expect(formatarDistancia(1000)).toBe('1,0 km');
    expect(formatarDistancia(999.4)).toBe('999 m');
    expect(formatarDistancia(999.6)).toBe('1,0 km');
  });

  it('o ponto do servidor leva seq, precisão/velocidade (ou null) e capturado_em em ISO', () => {
    const p = paraPontoDoServidor({ lat: -15, lng: -59, precisao_m: 4, velocidade_ms: null, em: Date.UTC(2026, 10, 26, 12, 0, 0) }, 7);
    expect(p).toEqual({ seq: 7, lat: -15, lng: -59, precisao_m: 4, velocidade_ms: null, capturado_em: '2026-11-26T12:00:00.000Z' });
  });
});
