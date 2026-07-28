import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  loadGoogleMaps,
  isGoogleMapsConfigured,
  isGoogleMapsReady,
  isExpectedScriptSrc,
  GoogleMapsError,
  MAPS_ERROR_CODES,
  GOOGLE_MAPS_SCRIPT_ID,
  GOOGLE_MAPS_LIBRARIES,
  GOOGLE_MAPS_SCRIPT_ORIGIN,
  __resetGoogleMapsLoaderForTests,
} from '@/lib/googleMaps';

const CHAVE = 'chave-de-teste-nao-real';

/** SDK completo: as três capacidades que o produto exige. */
const instalarSdk = () => {
  window.google = { maps: { Map: function Map() {}, geometry: {}, drawing: {} } };
};

/** SDK parcial, para provar que "carregou" não é "está pronto". */
const instalarSdkParcial = (partes) => {
  window.google = { maps: { ...partes } };
};

const scriptAtual = () => document.getElementById(GOOGLE_MAPS_SCRIPT_ID);

const URL_VALIDA = `${GOOGLE_MAPS_SCRIPT_ORIGIN}?key=x&libraries=${GOOGLE_MAPS_LIBRARIES}`;

/** Injeta um script pré-existente, como se outra carga já tivesse acontecido. */
const injetarScript = ({ src = URL_VALIDA, dataset = {} } = {}) => {
  const el = document.createElement('script');
  el.id = GOOGLE_MAPS_SCRIPT_ID;
  el.src = src;
  Object.assign(el.dataset, dataset);
  document.head.appendChild(el);
  return el;
};

beforeEach(() => {
  __resetGoogleMapsLoaderForTests();
  delete window.google;
  delete window.gm_authFailure;
  scriptAtual()?.remove();
});

afterEach(() => {
  vi.useRealTimers();
  __resetGoogleMapsLoaderForTests();
  delete window.google;
  delete window.gm_authFailure;
  scriptAtual()?.remove();
});

describe('loadGoogleMaps — configuração e ambiente', () => {
  it('rejeita com MAPS_CONFIG_MISSING quando não há chave', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    expect(isGoogleMapsConfigured()).toBe(false);

    await expect(loadGoogleMaps()).rejects.toMatchObject({
      name: 'GoogleMapsError',
      code: MAPS_ERROR_CODES.CONFIG_MISSING,
    });
    expect(scriptAtual()).toBeNull();
  });

  it('rejeita com MAPS_ENV_UNAVAILABLE sem DOM', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    const documentoOriginal = globalThis.document;

    vi.stubGlobal('document', undefined);
    try {
      await expect(loadGoogleMaps()).rejects.toMatchObject({
        code: MAPS_ERROR_CODES.ENV_UNAVAILABLE,
      });
    } finally {
      vi.stubGlobal('document', documentoOriginal);
    }
  });

  it('injeta o script uma única vez, com as libraries exigidas', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const promise = loadGoogleMaps();
    const script = scriptAtual();
    expect(script).not.toBeNull();
    expect(script.src).toContain(`libraries=${encodeURIComponent(GOOGLE_MAPS_LIBRARIES)}`);
    expect(isExpectedScriptSrc(script.src)).toBe(true);

    instalarSdk();
    script.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBeUndefined();
    expect(document.querySelectorAll('script[src*="maps.googleapis.com"]')).toHaveLength(1);
  });

  it('resolve imediatamente quando o SDK já está pronto', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    instalarSdk();
    expect(isGoogleMapsReady()).toBe(true);

    await expect(loadGoogleMaps()).resolves.toBeUndefined();
    expect(scriptAtual()).toBeNull(); // não injetou nada
  });
});

describe('loadGoogleMaps — capacidade comprovada', () => {
  /**
   * O contrato do produto é `Map` + `geometry` + `drawing`. Evento `load` e
   * `dataset.loaded` são pistas; nenhum dos dois é prova.
   */

  it('1. load sem SDK nenhum rejeita com MAPS_SDK_INCOMPLETE', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();

    const promise = loadGoogleMaps({ timeoutMs: 1000, pollIntervalMs: 20 });
    const assercao = expect(promise).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SDK_INCOMPLETE,
    });
    scriptAtual().dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(1500);
    await assercao;
  });

  it('2. dataset.loaded sem SDK não basta', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();
    injetarScript({ dataset: { loaded: 'true' } });

    const promise = loadGoogleMaps({ timeoutMs: 1000, pollIntervalMs: 20 });
    const assercao = expect(promise).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SDK_INCOMPLETE,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await assercao;
  });

  it('3. dataset.loaded com SDK completo passa', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    injetarScript({ dataset: { loaded: 'true' } });
    instalarSdk();

    await expect(loadGoogleMaps({ timeoutMs: 200, pollIntervalMs: 5 })).resolves.toBeUndefined();
  });

  it('4. só google.maps.Map não basta', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();

    const promise = loadGoogleMaps({ timeoutMs: 1000, pollIntervalMs: 20 });
    instalarSdkParcial({ Map: function Map() {} });
    scriptAtual().dispatchEvent(new Event('load'));
    const assercao = expect(promise).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SDK_INCOMPLETE,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await assercao;
  });

  it('5. Map + geometry sem drawing não basta', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();

    const promise = loadGoogleMaps({ timeoutMs: 1000, pollIntervalMs: 20 });
    instalarSdkParcial({ Map: function Map() {}, geometry: {} });
    scriptAtual().dispatchEvent(new Event('load'));
    const assercao = expect(promise).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SDK_INCOMPLETE,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await assercao;
  });

  it('6. SDK que completa pouco depois do load é aceito', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const promise = loadGoogleMaps({ timeoutMs: 3000, pollIntervalMs: 10 });
    scriptAtual().dispatchEvent(new Event('load'));

    // Namespaces chegam depois do evento: o loader precisa esperar, não desistir.
    instalarSdkParcial({ Map: function Map() {} });
    await new Promise((r) => setTimeout(r, 40));
    instalarSdk();

    await expect(promise).resolves.toBeUndefined();
  });

  it('7. incompleto até o timeout rejeita e remove o script', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();

    const promise = loadGoogleMaps({ timeoutMs: 800, pollIntervalMs: 20 });
    instalarSdkParcial({ Map: function Map() {}, drawing: {} });
    scriptAtual().dispatchEvent(new Event('load'));
    const assercao = expect(promise).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SDK_INCOMPLETE,
    });
    await vi.advanceTimersByTimeAsync(1200);
    await assercao;
    expect(scriptAtual()).toBeNull();
  });

  it('8. sucesso falso não fica em cache e 9. a retentativa funciona', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();

    const primeira = loadGoogleMaps({ timeoutMs: 500, pollIntervalMs: 20 });
    const falha = expect(primeira).rejects.toMatchObject({ code: MAPS_ERROR_CODES.SDK_INCOMPLETE });
    scriptAtual().dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(800);
    await falha;

    vi.useRealTimers();

    // Nada de promise resolvida guardada: a segunda chamada é uma nova carga.
    const segunda = loadGoogleMaps({ timeoutMs: 2000, pollIntervalMs: 10 });
    expect(segunda).not.toBe(primeira);
    expect(scriptAtual()).not.toBeNull();

    instalarSdk();
    scriptAtual().dispatchEvent(new Event('load'));
    await expect(segunda).resolves.toBeUndefined();
  });

  it('10. gm_authFailure derruba a carga e restaura o handler anterior', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    const anterior = vi.fn();
    window.gm_authFailure = anterior;

    const promise = loadGoogleMaps({ timeoutMs: 2000, pollIntervalMs: 10 });
    const assercao = expect(promise).rejects.toMatchObject({ code: MAPS_ERROR_CODES.SCRIPT_FAILED });
    window.gm_authFailure();
    await assercao;

    expect(anterior).toHaveBeenCalledTimes(1);
    expect(window.gm_authFailure).toBe(anterior);
    expect(scriptAtual()).toBeNull();
  });

  it('11. script com o ID certo e URL inesperada é inválido', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    // Sem SDK pronto: o loader precisa julgar o script, e o ID sozinho não vale.
    injetarScript({ src: 'https://exemplo.invalido/maps.js', dataset: { loaded: 'true' } });

    await expect(loadGoogleMaps({ timeoutMs: 200 })).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SCRIPT_FAILED,
    });
    expect(scriptAtual()).toBeNull();
  });

  it('11b. script sem as libraries exigidas é inválido', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    expect(isExpectedScriptSrc(`${GOOGLE_MAPS_SCRIPT_ORIGIN}?key=x&libraries=geometry`)).toBe(false);
    injetarScript({ src: `${GOOGLE_MAPS_SCRIPT_ORIGIN}?key=x&libraries=geometry` });

    await expect(loadGoogleMaps({ timeoutMs: 200 })).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SCRIPT_FAILED,
    });
  });

  it('12. chamadas simultâneas compartilham a mesma promise e um só script', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const a = loadGoogleMaps({ pollIntervalMs: 10 });
    const b = loadGoogleMaps({ pollIntervalMs: 10 });
    expect(a).toBe(b);

    instalarSdk();
    scriptAtual().dispatchEvent(new Event('load'));

    await Promise.all([a, b]);
    expect(document.querySelectorAll('script[src*="maps.googleapis.com"]')).toHaveLength(1);
  });

  it('13. a chave nunca aparece em log nem em mensagem de erro', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();
    const logs = [];
    const spyLog = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a) => logs.push(a.join(' ')));

    const promise = loadGoogleMaps({ timeoutMs: 400, pollIntervalMs: 20 });
    scriptAtual().dispatchEvent(new Event('load'));
    const capturado = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(700);
    const erro = await capturado;

    expect(erro.code).toBe(MAPS_ERROR_CODES.SDK_INCOMPLETE);
    expect(erro.message).not.toContain(CHAVE);
    expect(String(erro.cause?.message || '')).not.toContain(CHAVE);
    expect(logs.join('\n')).not.toContain(CHAVE);

    spyLog.mockRestore();
    spyWarn.mockRestore();
  });
});

describe('loadGoogleMaps — falhas de rede', () => {
  it('erro do script rejeita, limpa o estado e permite nova tentativa', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const primeira = loadGoogleMaps({ pollIntervalMs: 10 });
    scriptAtual().dispatchEvent(new Event('error'));
    await expect(primeira).rejects.toMatchObject({ code: MAPS_ERROR_CODES.SCRIPT_FAILED });
    expect(scriptAtual()).toBeNull();

    const segunda = loadGoogleMaps({ pollIntervalMs: 10 });
    expect(segunda).not.toBe(primeira);

    instalarSdk();
    scriptAtual().dispatchEvent(new Event('load'));
    await expect(segunda).resolves.toBeUndefined();
  });

  it('script que nunca responde rejeita com MAPS_SCRIPT_TIMEOUT', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();

    const promise = loadGoogleMaps({ timeoutMs: 1000 });
    const assercao = expect(promise).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SCRIPT_TIMEOUT,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await assercao;
  });

  it('a mensagem de configuração ausente não contém chave', () => {
    const erro = new GoogleMapsError(MAPS_ERROR_CODES.CONFIG_MISSING);
    expect(erro.message).toContain('VITE_GOOGLE_MAPS_API_KEY');
    expect(erro.message).not.toMatch(/AIza/);
  });
});
