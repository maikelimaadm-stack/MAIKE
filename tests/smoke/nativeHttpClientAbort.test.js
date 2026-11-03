/**
 * PR181-R2 (D-PROD-113) — `nativeRequest` com AbortSignal externo opcional:
 * o abort chega DE FATO ao transporte (fetch e leitura do corpo), listeners e
 * timers são limpos, e quem não passa signal mantém o contrato anterior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const CTX = { operation: 'teste', resource: 'Teste' };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** fetch falso que só termina quando o signal DO TRANSPORTE é abortado. */
const fetchQueEspera = () => {
  const chamadas = [];
  const fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
    chamadas.push(init.signal);
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  return { fetch, chamadas };
};
/** fetch falso que entrega os cabeçalhos e trava a leitura do corpo até o abort. */
const fetchCorpoTravado = () => {
  const sinais = [];
  const fetch = vi.fn(async (url, init) => {
    sinais.push(init.signal);
    return {
      ok: true,
      status: 200,
      text: () => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    };
  });
  return { fetch, sinais };
};
const autenticar = async () => {
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('token-de-teste');
};

describe('nativeRequest — AbortSignal externo (PR181-R2)', () => {
  it('H1: abort externo com o fetch em voo aborta o transporte e rejeita como indisponibilidade', async () => {
    const t = fetchQueEspera();
    vi.stubGlobal('fetch', t.fetch);
    await autenticar();
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const ac = new AbortController();
    const p = nativeRequest('/x', { autenticado: true, signal: ac.signal }, CTX);
    const falha = p.catch((e) => e);
    await Promise.resolve();
    ac.abort();
    const erro = await falha;
    expect(t.chamadas[0].aborted).toBe(true);
    expect(erro).toBeInstanceOf(Error);
  });

  it('H2: cabeçalhos chegaram e o corpo travou → abort externo interrompe a LEITURA do corpo', async () => {
    const t = fetchCorpoTravado();
    vi.stubGlobal('fetch', t.fetch);
    await autenticar();
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const ac = new AbortController();
    const falha = nativeRequest('/x', { autenticado: true, signal: ac.signal }, CTX).catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    const erro = await falha;
    expect(t.sinais[0].aborted).toBe(true);
    expect(erro).toBeInstanceOf(Error);
  });

  it('H3: signal já abortado não dispara fetch nenhum', async () => {
    const t = fetchQueEspera();
    vi.stubGlobal('fetch', t.fetch);
    await autenticar();
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const ac = new AbortController();
    ac.abort();
    await expect(nativeRequest('/x', { autenticado: true, signal: ac.signal }, CTX)).rejects.toBeInstanceOf(Error);
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('H4: o listener do signal externo sai ao terminar (sucesso e erro de corpo); abort tardio não afeta nada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"a":1}' })));
    await autenticar();
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const ac = new AbortController();
    const add = vi.spyOn(ac.signal, 'addEventListener');
    const rem = vi.spyOn(ac.signal, 'removeEventListener');
    expect(await nativeRequest('/x', { autenticado: true, signal: ac.signal }, CTX)).toEqual({ a: 1 });
    expect(add).toHaveBeenCalledTimes(1);
    expect(rem).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    ac.abort(); // tardio: nada a fazer, nada lançado
  });

  it('H5: sem signal o contrato não muda — POST com timeoutMs de 60 s não é abortado antes do prazo; GET padrão aborta aos 20 s', async () => {
    vi.useFakeTimers();
    const t = fetchQueEspera();
    vi.stubGlobal('fetch', t.fetch);
    await autenticar();
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const post = nativeRequest('/importar', { method: 'POST', body: { a: 1 }, autenticado: true, timeoutMs: 60_000 }, CTX).catch((e) => e);
    const get = nativeRequest('/y', { autenticado: true }, CTX).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(t.chamadas[1].aborted).toBe(true);
    expect(t.chamadas[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(t.chamadas[0].aborted).toBe(true);
    await post;
    await get;
  });
});

describe('limitador da elegibilidade + nativeRequest real (PR181-R2)', () => {
  it('H6: corpo travado depois dos cabeçalhos → o prazo de 30 s aborta a LEITURA no transporte e a consulta falha fechada; a vaga volta', async () => {
    vi.useFakeTimers();
    const t = fetchCorpoTravado();
    vi.stubGlobal('fetch', t.fetch);
    await autenticar();
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const { comLimiteDeConsultas, LIMITE_CONSULTA_MS, __estadoLimiteConsultas } = await import('@/components/lotes/ExcluirMovimentacao');
    const falha = comLimiteDeConsultas((sinal) => nativeRequest('/movimentacoes-mapa/x/elegibilidade-exclusao', { autenticado: true, signal: sinal }, CTX)).catch((e) => e);
    await vi.advanceTimersByTimeAsync(25_000); // passou o timeout de 20 s do fetch, mas ele já foi limpo nos cabeçalhos
    expect(t.sinais[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(LIMITE_CONSULTA_MS);
    expect(t.sinais[0].aborted).toBe(true);
    expect(await falha).toBeInstanceOf(Error);
    expect(__estadoLimiteConsultas()).toEqual({ ativos: 0, espera: 0 });
  });
});
