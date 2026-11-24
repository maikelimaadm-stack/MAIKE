/**
 * D-PROD-288 — leituras guardadas para usar sem internet.
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

describe('D-PROD-288 — leitura sem internet', () => {
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

describe('D-PROD-288 — baixar dados', () => {
  it('DB-01 baixa as leituras de todas as telas (com a empresa) e refaz as já guardadas', async () => {
    const { guardarResposta, listarCaminhosGuardados } = await carregar();
    await guardarResposta('cli_1', '/tela-aberta-antes', [{ id: 'velho' }]);
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(200, [{ id: 'novo' }]));
    vi.stubGlobal('fetch', fetchMock);

    const { baixarLeiturasDasTelas } = await import('@/apis/offline');
    const { LEITURAS_PARA_OFFLINE } = await import('@/config/leiturasParaOffline');
    const r = await baixarLeiturasDasTelas('emp 1');
    expect(r.falhas).toBe(0);
    expect(r.total).toBe(LEITURAS_PARA_OFFLINE.length + 1);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain(`${API}/api/native/tela-aberta-antes`);
    expect(urls).toContain(`${API}/api/native/culturas?empresa_id=emp%201`);
    expect(urls.some((u) => u.includes('{empresa}'))).toBe(false);
    await new Promise((res) => setTimeout(res, 100));
    expect(await listarCaminhosGuardados('cli_1')).toContain('/culturas?empresa_id=emp%201');
  });

  it('DB-01b sem permissão para uma tela (403) não conta como falha; rede caída conta', async () => {
    await carregar();
    const { baixarLeiturasDasTelas } = await import('@/apis/offline');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(403, { code: 'FORBIDDEN' })));
    expect((await baixarLeiturasDasTelas('emp')).falhas).toBe(0);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect((await baixarLeiturasDasTelas('emp')).falhas).toBeGreaterThan(0);
  });

  it('DB-02 sem internet não baixa nada nem marca data', async () => {
    await carregar();
    online = false;
    const { baixarDadosParaOffline, ultimaBaixaDosDados } = await import('@/services/dadosOfflineService');
    expect(await baixarDadosParaOffline({ empresaId: 'emp_1' })).toEqual({ ok: false, falhas: 0, em: null });
    expect(ultimaBaixaDosDados()).toBeNull();
  });
});
