/**
 * D-PROD-289 — o app fica conectado até a pessoa sair, e abre sem internet.
 *
 * Cadeia real `nativeSessionApi → nativeHttpClient`, com `fetch` substituído.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const CHAVE = 'maike_native_access_token';

const carregar = async () => {
  const storage = await import('@/lib/auth/nativeTokenStorage');
  const sessao = await import('@/apis/session/nativeSessionApi');
  const offline = await import('@/lib/auth/sessaoOfflineLocal');
  const tenant = await import('@/lib/offline/offlineTenant');
  return { ...sessao, ...storage, ...offline, ...tenant };
};

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** JWT sintético só com `exp` (o aparelho lê a validade; quem decide é o servidor). */
const jwtQueVence = (msDaquiAPouco) => `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor((Date.now() + msDaquiAPouco) / 1000) })}.assinatura`;

const LOGIN = (token) => ({ token, usuario: { id: 'usr_1', login: 'joao', nome: 'João' }, cliente_id: 'cli_1' });
const CONTEXTO_OK = { cliente_id: 'cli_1', usuario_id: 'usr_1', login: 'joao' };
const DIA = 24 * 3600 * 1000;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Entra (com ou sem "Manter conectado") e depois derruba a rede. */
const entrarEDerrubarARede = async ({ lembrar, token = jwtQueVence(30 * DIA) }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(respostaJson(200, LOGIN(token))).mockResolvedValueOnce(respostaJson(200, CONTEXTO_OK))
  );
  const m = await carregar();
  await m.login({ login: 'joao', senha: 's3nh4', lembrar });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  return m;
};

describe('D-PROD-289 — abrir sem internet', () => {
  it('SO-01 sessão lembrada, sem rede: abre com o último contexto confirmado e marca offline', async () => {
    const { restaurarSessao } = await entrarEDerrubarARede({ lembrar: true });
    const veredito = await restaurarSessao();
    expect(veredito).toEqual({ autenticado: true, offline: true, contexto: CONTEXTO_OK });
    expect(window.localStorage.getItem(CHAVE)).not.toBeNull();
  });

  it('SO-02 sessão só da aba (sem lembrar): continua fail-closed, sem contexto guardado', async () => {
    const { restaurarSessao, lerSessaoOffline } = await entrarEDerrubarARede({ lembrar: false });
    expect(lerSessaoOffline()).toBeNull();
    await expect(restaurarSessao()).rejects.toMatchObject({ code: 'API_PROVIDER_UNAVAILABLE' });
  });

  it('SO-03 token vencido pelo relógio do aparelho: não abre sem internet', async () => {
    const { restaurarSessao } = await entrarEDerrubarARede({ lembrar: true, token: jwtQueVence(-60_000) });
    await expect(restaurarSessao()).rejects.toMatchObject({ code: 'API_PROVIDER_UNAVAILABLE' });
  });

  it('SO-04 contexto guardado de outro tenant que o dono do offline: não abre', async () => {
    const { restaurarSessao, setOfflineTenant } = await entrarEDerrubarARede({ lembrar: true });
    setOfflineTenant('cli_outro');
    await expect(restaurarSessao()).rejects.toMatchObject({ code: 'API_PROVIDER_UNAVAILABLE' });
  });

  it('SO-05 o servidor recusou o token (401): sai, apaga token e contexto guardado', async () => {
    const { restaurarSessao, lerSessaoOffline } = await entrarEDerrubarARede({ lembrar: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaJson(401, { code: 'TENANT_CONTEXT_REQUIRED' }))
    );
    expect(await restaurarSessao()).toEqual({ autenticado: false, contexto: null });
    expect(window.localStorage.getItem(CHAVE)).toBeNull();
    expect(lerSessaoOffline()).toBeNull();
  });

  it('SO-06 sair apaga o contexto guardado: sem internet não reabre', async () => {
    const { restaurarSessao, logout, lerSessaoOffline } = await entrarEDerrubarARede({ lembrar: true });
    logout();
    expect(lerSessaoOffline()).toBeNull();
    expect(await restaurarSessao()).toEqual({ autenticado: false, contexto: null });
  });

  it('SO-07 o contexto guardado nunca contém o token', async () => {
    const token = jwtQueVence(30 * DIA);
    await entrarEDerrubarARede({ lembrar: true, token });
    const bruto = Object.keys(window.localStorage)
      .filter((k) => k !== CHAVE)
      .map((k) => window.localStorage.getItem(k))
      .join('|');
    expect(bruto).not.toContain(token);
  });
});

describe('D-PROD-289 — renovação', () => {
  it('SR-01 sessão lembrada: POST /auth/renovar autenticado, só com lembrar; troca o token no aparelho', async () => {
    const antigo = jwtQueVence(2 * DIA);
    const novo = jwtQueVence(30 * DIA);
    const { renovar } = await entrarEDerrubarARede({ lembrar: true, token: antigo });
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(200, { token: novo }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await renovar()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/api/native/auth/renovar`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization ?? init.headers.authorization).toBe(`Bearer ${antigo}`);
    expect(JSON.parse(init.body)).toEqual({ lembrar: true });
    expect(window.localStorage.getItem(CHAVE)).toBe(novo);
    expect(window.sessionStorage.getItem(CHAVE)).toBeNull();
  });

  it('SR-02 sessão só da aba: não renova nem chama o servidor', async () => {
    const { renovar } = await entrarEDerrubarARede({ lembrar: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await renovar()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SR-03 falha de rede ou recusa na renovação não derruba a sessão guardada', async () => {
    const token = jwtQueVence(30 * DIA);
    const { renovar } = await entrarEDerrubarARede({ lembrar: true, token });
    expect(await renovar()).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaJson(401, { code: 'TENANT_CONTEXT_REQUIRED' }))
    );
    expect(await renovar()).toBe(false);
    expect(window.localStorage.getItem(CHAVE)).toBe(token);
  });
});

describe('D-PROD-289 — validade local do token', () => {
  it('SV-01 lê o exp do token guardado; token ilegível = null', async () => {
    const { setNativeToken, validadeLocalDoToken } = await carregar();
    const token = jwtQueVence(DIA);
    setNativeToken(token, { lembrar: true });
    const exp = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp;
    expect(validadeLocalDoToken()).toBe(exp * 1000);
    setNativeToken('sem.formato', { lembrar: true });
    expect(validadeLocalDoToken()).toBeNull();
  });
});
