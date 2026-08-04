import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';

import {
  loadGoogleMaps,
  isGoogleMapsConfigured,
  isGoogleMapsReady,
  isExpectedScriptSrc,
  GoogleMapsError,
  MAPS_ERROR_CODES,
  GOOGLE_MAPS_SCRIPT_ID,
  GOOGLE_MAPS_LIBRARIES,
  GOOGLE_MAPS_REQUIRED_LIBRARIES,
  GOOGLE_MAPS_SCRIPT_ORIGIN,
  __resetGoogleMapsLoaderForTests,
} from '@/lib/googleMaps';

const CHAVE = 'chave-de-teste-nao-real';

/** SDK completo: as três capacidades que o produto exige. */
const instalarSdk = () => {
  window.google = { maps: { Map: function Map() {}, geometry: {} } };
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
   * O contrato do produto é `Map` + `geometry` (P1.2-R1, D-PROD-19). Evento
   * `load` e `dataset.loaded` são pistas; nenhum dos dois é prova.
   *
   * `drawing` saiu do contrato porque o Google removeu o `DrawingManager` na
   * versão 3.65 — exigir a library tornava o readiness insatisfazível.
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

  it('MAP5. só google.maps.geometry não basta', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    vi.useFakeTimers();

    const promise = loadGoogleMaps({ timeoutMs: 1000, pollIntervalMs: 20 });
    instalarSdkParcial({ geometry: {} });
    scriptAtual().dispatchEvent(new Event('load'));
    const assercao = expect(promise).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SDK_INCOMPLETE,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await assercao;
  });

  /**
   * MAP6 — o teste que teria pego a regressão em produção.
   *
   * Antes da P1.2-R1 este caso era o inverso: `Map + geometry` sem `drawing`
   * **reprovava**. Como o Google não entrega mais `drawing`, aquele contrato
   * significava que nenhuma carga real podia terminar bem.
   */
  it('MAP6. Map + geometry basta, mesmo sem drawing', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);

    const promise = loadGoogleMaps({ timeoutMs: 2000, pollIntervalMs: 10 });
    instalarSdkParcial({ Map: function Map() {}, geometry: {} });
    scriptAtual().dispatchEvent(new Event('load'));

    await expect(promise).resolves.toBeUndefined();
    expect(window.google.maps.drawing).toBeUndefined();
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
    instalarSdkParcial({ Map: function Map() {} });
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
    const semGeometry = `${GOOGLE_MAPS_SCRIPT_ORIGIN}?key=x&libraries=places`;
    expect(isExpectedScriptSrc(semGeometry)).toBe(false);
    expect(isExpectedScriptSrc(`${GOOGLE_MAPS_SCRIPT_ORIGIN}?key=x`)).toBe(false);
    injetarScript({ src: semGeometry });

    await expect(loadGoogleMaps({ timeoutMs: 200 })).rejects.toMatchObject({
      code: MAPS_ERROR_CODES.SCRIPT_FAILED,
    });
  });

  /**
   * MAP1/MAP2 — o formato da URL é contrato, não detalhe: é o que o Google
   * recebe. `drawing` na URL faria o SDK carregar uma library que não existe
   * mais.
   */
  it('MAP1/MAP2. a URL pede geometry e não pede drawing', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', CHAVE);
    loadGoogleMaps({ timeoutMs: 200 }).catch(() => {});
    const src = scriptAtual().src;

    expect(src).toContain('libraries=geometry');
    expect(src).not.toContain('drawing');
    expect(GOOGLE_MAPS_LIBRARIES).toBe('geometry');
    expect(isExpectedScriptSrc(`${GOOGLE_MAPS_SCRIPT_ORIGIN}?key=x&libraries=geometry`)).toBe(true);
    // Uma URL que ainda peça drawing continua aceita: o que importa é conter as
    // exigidas. O produto simplesmente não gera mais essa URL.
    expect(isExpectedScriptSrc(`${GOOGLE_MAPS_SCRIPT_ORIGIN}?key=x&libraries=drawing,geometry`)).toBe(true);
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

/**
 * MAP13/MAP16 — a Drawing Library saiu do produto inteiro, não só do loader.
 *
 * O Google removeu o `DrawingManager` do Maps JavaScript API na versão 3.65
 * (junho de 2026). Tirar `drawing` do contrato do loader não basta: se algum
 * componente ainda chamasse `new google.maps.drawing.DrawingManager(...)`, o
 * produto quebraria em runtime com a library ausente, em vez de falhar na
 * carga. Estes testes varrem `src/` inteiro.
 */
/**
 * Varredura de `src/` sem depender de `fs.globSync`.
 *
 * `globSync` só existe a partir do Node 22. O `.nvmrc` do projeto fixa 20.19.0,
 * então usá-lo passava na máquina de quem tem Node novo e reprovava na CI —
 * foi exatamente o que aconteceu no run 30849901416. `readdirSync` com
 * `recursive: true` existe desde o Node 18.17 e cobre os dois.
 */
const fontesDeSrc = () =>
  readdirSync('src', { recursive: true })
    .map((rel) => `src/${String(rel).split(sep).join('/')}`)
    .filter((rel) => /\.(js|jsx)$/.test(rel));

describe('MAP13/MAP16 — nenhuma dependência da Drawing Library', () => {
  const fontes = () => fontesDeSrc().map((rel) => [rel, readFileSync(rel, 'utf8')]);

  /** Sem comentários: `googleMaps.js` explica por que `drawing` saiu. */
  const semComentarios = (fonte) =>
    fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('MAP13 — zero uso executável de google.maps.drawing ou DrawingManager', () => {
    const arquivos = fontes();
    expect(arquivos.length).toBeGreaterThan(100);

    const infratores = arquivos
      .filter(([, fonte]) => /google\.maps\.drawing|DrawingManager|maps\.drawing\.OverlayType/.test(semComentarios(fonte)))
      .map(([rel]) => rel);

    expect(infratores).toEqual([]);
  });

  it('MAP13b — nenhuma URL do produto pede a library drawing', () => {
    const infratores = fontes()
      .filter(([, fonte]) => /libraries=[^'"`\s]*drawing|drawing,geometry|geometry,drawing/.test(semComentarios(fonte)))
      .map(([rel]) => rel);

    expect(infratores).toEqual([]);
    expect(GOOGLE_MAPS_LIBRARIES).not.toContain('drawing');
  });

  /**
   * MAP16 — o desenho manual é o que substitui o `DrawingManager`, e sempre foi:
   * o produto nunca dependeu dele. Se estas primitivas sumissem de
   * `MapaDesenho`, a remoção teria custado funcionalidade.
   */
  it('MAP16 — ponto, linha e polígono continuam desenhados à mão', () => {
    const desenho = semComentarios(readFileSync('src/components/mapa/MapaDesenho.jsx', 'utf8'));

    expect(desenho).toContain('new google.maps.Marker');    // ponto
    expect(desenho).toContain('new google.maps.Polyline');  // linha
    expect(desenho).toContain('new google.maps.Polygon');   // polígono
    // O ciclo manual: ouvir o mapa, acumular vértices, fechar no duplo clique.
    expect(desenho).toContain("google.maps.event.addListener(mapInstanceRef.current, 'dblclick'");
    expect(desenho).toContain("google.maps.event.addListener(mapInstanceRef.current, 'mousemove'");
  });

  it('MAP15 — geometry continua sendo usada de verdade, por isso permanece exigida', () => {
    const usos = fontes().filter(([, fonte]) => /google\.maps\.geometry\./.test(semComentarios(fonte)));
    // Área, comprimento, distância e contenção de ponto em polígono.
    expect(usos.length).toBeGreaterThanOrEqual(5);
    expect(GOOGLE_MAPS_REQUIRED_LIBRARIES).toContain('geometry');
  });
});
