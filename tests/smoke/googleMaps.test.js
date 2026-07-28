import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  loadGoogleMaps,
  isGoogleMapsConfigured,
  isGoogleMapsReady,
  GoogleMapsError,
  MAPS_ERROR_CODES,
  GOOGLE_MAPS_SCRIPT_ID,
  GOOGLE_MAPS_LIBRARIES,
  __resetGoogleMapsLoaderForTests,
} from '@/lib/googleMaps';

const CHAVE = 'chave-de-teste-nao-real';

/** SDK mínimo com as capacidades que o produto exige. */
const instalarSdk = () => {
  window.google = { maps: { Map: function Map() {}, geometry: {}, drawing: {} } };
};

const scriptAtual = () => document.getElementById(GOOGLE_MAPS_SCRIPT_ID);

beforeEach(() => {
  __resetGoogleMapsLoaderForTests();
  delete window.google;
  scriptAtual()?.remove();
});

afterEach(() => {
  __resetGoogleMapsLoaderForTests();
  delete window.google;
  scriptAtual()?.remove();
});

describe('loadGoogleMaps', () => {
  it('rejeita com MAPS_CONFIG_MISSING quando não há chave', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    expect(isGoogleMapsConfigured()).toBe(false);

    await expect(loadGoogleMaps()).rejects.toMatchObject({
      name: 'GoogleMapsError',
      code: MAPS_ERROR_CODES.CONFIG_MISSING,
    });
    expect(scriptAtual()).toBeNull();
  });

  it('injeta o script uma única vez na primeira carga', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const promise = loadGoogleMaps();
    const script = scriptAtual();
    expect(script).not.toBeNull();
    expect(script.src).toContain(`libraries=${encodeURIComponent(GOOGLE_MAPS_LIBRARIES)}`);

    instalarSdk();
    script.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBeUndefined();
    expect(document.querySelectorAll('script[src*="maps.googleapis.com"]')).toHaveLength(1);
  });

  it('duas chamadas simultâneas compartilham a mesma promise e um só script', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const a = loadGoogleMaps();
    const b = loadGoogleMaps();
    expect(a).toBe(b);

    instalarSdk();
    scriptAtual().dispatchEvent(new Event('load'));

    await Promise.all([a, b]);
    expect(document.querySelectorAll('script[src*="maps.googleapis.com"]')).toHaveLength(1);
  });

  it('resolve imediatamente quando o SDK já está pronto', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    instalarSdk();
    expect(isGoogleMapsReady()).toBe(true);

    await expect(loadGoogleMaps()).resolves.toBeUndefined();
    expect(scriptAtual()).toBeNull(); // não injetou nada
  });

  it('não fica pendurado quando o script já existe e já terminou de carregar', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    // Script de uma carga anterior, já concluída: `load` não dispara de novo.
    const antigo = document.createElement('script');
    antigo.id = GOOGLE_MAPS_SCRIPT_ID;
    antigo.dataset.loaded = 'true';
    document.head.appendChild(antigo);

    await expect(loadGoogleMaps({ timeoutMs: 50 })).resolves.toBeUndefined();
  });

  it('aguarda o mesmo evento quando o script existente ainda está carregando', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const emAndamento = document.createElement('script');
    emAndamento.id = GOOGLE_MAPS_SCRIPT_ID;
    document.head.appendChild(emAndamento);

    const promise = loadGoogleMaps();
    expect(document.querySelectorAll(`#${GOOGLE_MAPS_SCRIPT_ID}`)).toHaveLength(1);

    instalarSdk();
    emAndamento.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBeUndefined();
  });

  it('após falha, limpa o estado e permite nova tentativa', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const primeira = loadGoogleMaps();
    scriptAtual().dispatchEvent(new Event('error'));
    await expect(primeira).rejects.toMatchObject({ code: MAPS_ERROR_CODES.SCRIPT_FAILED });

    // O script quebrado foi removido: nada bloqueia a retentativa.
    expect(scriptAtual()).toBeNull();

    const segunda = loadGoogleMaps();
    expect(segunda).not.toBe(primeira);
    expect(scriptAtual()).not.toBeNull();

    instalarSdk();
    scriptAtual().dispatchEvent(new Event('load'));
    await expect(segunda).resolves.toBeUndefined();
  });

  it('rejeita com MAPS_SCRIPT_TIMEOUT quando o script nunca responde', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();

    const promise = loadGoogleMaps({ timeoutMs: 1000 });
    const assercao = expect(promise).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SCRIPT_TIMEOUT,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await assercao;

    vi.useRealTimers();
  });

  it('nunca registra a chave em log', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    const logs = [];
    const spyLog = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a) => logs.push(a.join(' ')));

    const promise = loadGoogleMaps();
    instalarSdk();
    scriptAtual().dispatchEvent(new Event('load'));
    await promise;

    expect(logs.join('\n')).not.toContain(CHAVE);
    spyLog.mockRestore();
    spyWarn.mockRestore();
  });

  it('a mensagem de erro de configuração não contém chave', () => {
    const erro = new GoogleMapsError(MAPS_ERROR_CODES.CONFIG_MISSING);
    expect(erro.message).toContain('VITE_GOOGLE_MAPS_API_KEY');
    expect(erro.message).not.toMatch(/AIza/);
  });
});

describe('loadGoogleMaps sem DOM', () => {
  it('rejeita com MAPS_ENV_UNAVAILABLE', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    const documentoOriginal = globalThis.document;

    // Simula SSR: sem `document`, o loader não pode injetar script.
    vi.stubGlobal('document', undefined);
    try {
      await expect(loadGoogleMaps()).rejects.toMatchObject({
        code: MAPS_ERROR_CODES.ENV_UNAVAILABLE,
      });
    } finally {
      vi.stubGlobal('document', documentoOriginal);
    }
  });
});
