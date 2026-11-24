/**
 * D-PROD-294 — satélite do app (MapTiler): cache das imagens já vistas,
 * mostradas sem internet. Cache Storage em memória.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const criarCaches = () => {
  const lojas = new Map();
  return {
    open: async (nome) => {
      if (!lojas.has(nome)) lojas.set(nome, new Map());
      const m = lojas.get(nome);
      return {
        match: async (k) => m.get(typeof k === 'string' ? k : k.url) ?? undefined,
        put: async (k, r) => { m.set(k, r); },
        delete: async (k) => m.delete(typeof k === 'string' ? k : k.url),
        keys: async () => [...m.keys()].map((url) => ({ url })),
      };
    },
  };
};

let online = true;
beforeEach(() => {
  vi.resetModules();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  vi.stubGlobal('caches', criarCaches());
});
afterEach(() => vi.unstubAllGlobals());

const URL_TILE = 'maike-sat://api.maptiler.com/tiles/satellite-v2/15/1/2.jpg?key=CHAVE';
const resposta = (bytes) => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array(bytes).buffer });

describe('D-PROD-294 — satélite em cache no app', () => {
  it('SG-01 imagem vista com internet aparece depois sem internet (sem ir à rede)', async () => {
    const { carregarTileSatelite } = await import('@/lib/maplibre/sateliteGuardado');
    const fetchImpl = vi.fn(async () => resposta([1, 2, 3]));
    const r1 = await carregarTileSatelite({ url: URL_TILE }, undefined, { fetchImpl });
    expect(new Uint8Array(r1.data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledWith('https://api.maptiler.com/tiles/satellite-v2/15/1/2.jpg?key=CHAVE', expect.anything());
    await new Promise((r) => setTimeout(r, 10));
    online = false;
    const semRede = vi.fn();
    const r2 = await carregarTileSatelite({ url: URL_TILE }, undefined, { fetchImpl: semRede });
    expect(new Uint8Array(r2.data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(semRede).not.toHaveBeenCalled();
  });

  it('SG-02 a chave da API não vira chave do cache', async () => {
    const { chaveDoTile } = await import('@/lib/maplibre/sateliteGuardado');
    expect(chaveDoTile(URL_TILE)).toBe('https://api.maptiler.com/tiles/satellite-v2/15/1/2.jpg');
  });

  it('SG-03 sem internet e nunca vista: falha (o mapa segue com o fundo)', async () => {
    const { carregarTileSatelite } = await import('@/lib/maplibre/sateliteGuardado');
    online = false;
    await expect(carregarTileSatelite({ url: URL_TILE }, undefined, { fetchImpl: vi.fn() })).rejects.toThrow(/Sem internet/);
  });

  it('SG-04 mais de 30 dias: a imagem sai do aparelho e não é mais usada', async () => {
    const { carregarTileSatelite, VALIDADE_MS } = await import('@/lib/maplibre/sateliteGuardado');
    const t0 = 1_000_000;
    await carregarTileSatelite({ url: URL_TILE }, undefined, { fetchImpl: vi.fn(async () => resposta([9])), agora: () => t0 });
    await new Promise((r) => setTimeout(r, 10));
    online = false;
    await expect(
      carregarTileSatelite({ url: URL_TILE }, undefined, { fetchImpl: vi.fn(), agora: () => t0 + VALIDADE_MS + 1 })
    ).rejects.toThrow();
  });

  it('SG-05 rede caiu no meio (com internet ligada): usa a cópia guardada', async () => {
    const { carregarTileSatelite, FRESCO_MS } = await import('@/lib/maplibre/sateliteGuardado');
    const t0 = 5_000_000;
    await carregarTileSatelite({ url: URL_TILE }, undefined, { fetchImpl: vi.fn(async () => resposta([7])), agora: () => t0 });
    await new Promise((r) => setTimeout(r, 10));
    const falha = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const r = await carregarTileSatelite({ url: URL_TILE }, undefined, { fetchImpl: falha, agora: () => t0 + FRESCO_MS + 1 });
    expect(new Uint8Array(r.data)).toEqual(new Uint8Array([7]));
  });
});
