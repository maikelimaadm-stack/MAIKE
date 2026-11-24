/**
 * D-PROD-294 — leituras guardadas para usar sem internet.
 *
 * Cadeia real `nativeHttpClient → respostasOffline (IndexedDB)`, com `fetch`
 * substituído e IndexedDB em memória (fake-indexeddb).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

const ctx = { operation: 'teste', resource: 'Teste' };

let online = true;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  // Banco limpo a cada caso.
  indexedDB.deleteDatabase('maike_respostas_offline');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const carregar = async ({ tenant = 'cli_1' } = {}) => {
  const storage = await import('@/lib/auth/nativeTokenStorage');
  const tenantMod = await import('@/lib/offline/offlineTenant');
  const http = await import('@/apis/_core/nativeHttpClient');
  const respostas = await import('@/lib/offline/respostasOffline');
  storage.setNativeToken('jwt.sintetico', { lembrar: true });
  if (tenant) tenantMod.setOfflineTenant(tenant);
  return { ...http, ...respostas, ...tenantMod };
};

describe('D-PROD-294 — leitura sem internet', () => {
  it('DO-01 leitura que deu certo fica guardada e volta quando a rede cai', async () => {
    const { nativeRequest } = await carregar();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(200, [{ id: 'a1', nome: 'Pasto 1' }])));
    expect(await nativeRequest('/areas-pastagem', { autenticado: true }, ctx)).toEqual([{ id: 'a1', nome: 'Pasto 1' }]);
    await new Promise((r) => setTimeout(r, 50));

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await nativeRequest('/areas-pastagem', { autenticado: true }, ctx)).toEqual([{ id: 'a1', nome: 'Pasto 1' }]);
  });

  it('DO-02 aparelho sem sinal: lê o guardado sem nem chamar a rede', async () => {
    const { nativeRequest, guardarResposta } = await carregar();
    await guardarResposta('cli_1', '/setores', [{ id: 's1' }]);
    online = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await nativeRequest('/setores', { autenticado: true }, ctx)).toEqual([{ id: 's1' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('DO-03 sem nada guardado, a falha de rede continua sendo indisponibilidade', async () => {
    const { nativeRequest } = await carregar();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(nativeRequest('/nada-guardado', { autenticado: true }, ctx)).rejects.toMatchObject({ code: 'API_PROVIDER_UNAVAILABLE' });
  });

  it('DO-04 gravação (POST) nunca usa o guardado', async () => {
    const { nativeRequest, guardarResposta } = await carregar();
    await guardarResposta('cli_1', '/setores', [{ id: 's1' }]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(nativeRequest('/setores', { method: 'POST', body: { nome: 'x' }, autenticado: true }, ctx)).rejects.toMatchObject({
      code: 'API_PROVIDER_UNAVAILABLE',
    });
  });

  it('DO-05 /auth/* nunca é guardado nem lido do guardado (a sessão é do servidor)', async () => {
    const { nativeRequest, lerResposta } = await carregar();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(200, { cliente_id: 'cli_1', usuario_id: 'u1' })));
    await nativeRequest('/auth/contexto', { autenticado: true }, ctx);
    await new Promise((r) => setTimeout(r, 50));
    expect(await lerResposta('cli_1', '/auth/contexto')).toBeUndefined();
  });

  it('DO-06 separado por fazenda: o guardado de outro tenant não aparece', async () => {
    const { nativeRequest, guardarResposta } = await carregar({ tenant: 'cli_2' });
    await guardarResposta('cli_1', '/setores', [{ id: 'da-outra-fazenda' }]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(nativeRequest('/setores', { autenticado: true }, ctx)).rejects.toMatchObject({ code: 'API_PROVIDER_UNAVAILABLE' });
  });

  it('DO-07 erro do servidor (4xx) não é mascarado pelo guardado', async () => {
    const { nativeRequest, guardarResposta } = await carregar();
    await guardarResposta('cli_1', '/setores', [{ id: 's1' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(403, { code: 'FORBIDDEN' })));
    await expect(nativeRequest('/setores', { autenticado: true }, ctx)).rejects.not.toMatchObject({ code: 'API_PROVIDER_UNAVAILABLE' });
  });

  it('DO-09 internet fraca: com cópia guardada não espera 20 s — em ~6 s abre com a cópia', async () => {
    const { nativeRequest, guardarResposta } = await carregar({ tenant: 'cli_do09' });
    await guardarResposta('cli_do09', '/culturas', [{ id: 'c1' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }))
    );
    const inicio = Date.now();
    expect(await nativeRequest('/culturas', { autenticado: true }, ctx)).toEqual([{ id: 'c1' }]);
    const levou = Date.now() - inicio;
    expect(levou).toBeGreaterThanOrEqual(5500);
    expect(levou).toBeLessThan(9000);
  }, 15000);

  it('DO-08 sair da conta apaga as leituras guardadas do tenant', async () => {
    const { guardarResposta, lerResposta, listarCaminhosGuardados } = await carregar();
    await guardarResposta('cli_1', '/setores', [{ id: 's1' }]);
    await guardarResposta('cli_1', '/marcas', [{ id: 'm1' }]);
    const { sairDaSessaoNativa } = await import('@/services/sessionService');
    sairDaSessaoNativa();
    await new Promise((r) => setTimeout(r, 100));
    expect(await listarCaminhosGuardados('cli_1')).toEqual([]);
    expect(await lerResposta('cli_1', '/setores')).toBeUndefined();
  });
});

describe('D-PROD-294 — baixar dados', () => {
  it('DB-01 baixa as leituras registradas pelas portas e refaz as já guardadas', async () => {
    const { guardarResposta } = await carregar();
    await guardarResposta('cli_1', '/setores', [{ id: 'velho' }]);
    await guardarResposta('cli_1', '/culturas?empresa_id=emp', [{ id: 'velho' }]);
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(200, [{ id: 'novo' }]));
    vi.stubGlobal('fetch', fetchMock);

    const { baixarLeiturasDasTelas } = await import('@/apis/offline');
    const { leiturasOfflineRegistradas } = await import('@/lib/offline/leiturasOffline');
    // Sem empresa: só as leituras sem `{empresa}` + as guardadas.
    const r = await baixarLeiturasDasTelas(null);
    expect(r.falhas).toBe(0);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain(`${API}/api/native/culturas?empresa_id=emp`);
    expect(urls).toContain(`${API}/api/native/setores`);
    expect(r.total).toBe(new Set([...leiturasOfflineRegistradas(null), '/setores', '/culturas?empresa_id=emp']).size);
  });

  it('DB-01b sem permissão (403) não conta como falha; rede caída conta e não usa o guardado velho', async () => {
    // Fazenda própria: o IndexedDB em memória é compartilhado entre os casos.
    const { guardarResposta } = await carregar({ tenant: 'cli_db01b' });
    await guardarResposta('cli_db01b', '/setores', [{ id: 'velho' }]);
    const { baixarLeiturasDasTelas } = await import('@/apis/offline');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(403, { code: 'FORBIDDEN' })));
    expect((await baixarLeiturasDasTelas('emp')).falhas).toBe(0);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect((await baixarLeiturasDasTelas('emp')).falhas).toBeGreaterThan(0);
  });

  it('DB-03 cada tela do sistema tem a sua leitura registrada pela porta do módulo (com a empresa)', async () => {
    await import('@/apis/culturas');
    await import('@/apis/setores');
    await import('@/apis/estoque-consulta');
    const { leiturasOfflineRegistradas } = await import('@/lib/offline/leiturasOffline');
    const lista = leiturasOfflineRegistradas('emp-1');
    expect(lista).toContain('/culturas?empresa_id=emp-1');
    expect(lista).toContain('/setores/page?empresa_id=emp-1&limit=100');
    expect(lista).toContain('/estoque/saldo?empresa_id=emp-1&limit=100');
    expect(lista.some((c) => c.includes('{empresa}'))).toBe(false);
  });

  it('DB-02 sem internet não baixa nada nem marca data', async () => {
    await carregar();
    online = false;
    const { baixarDadosParaOffline, ultimaBaixaDosDados } = await import('@/services/dadosOfflineService');
    expect(await baixarDadosParaOffline({ empresaId: 'emp_1' })).toEqual({ ok: false, falhas: 0, em: null });
    expect(ultimaBaixaDosDados()).toBeNull();
  });
});
