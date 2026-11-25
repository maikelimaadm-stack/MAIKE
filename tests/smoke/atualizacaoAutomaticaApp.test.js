/**
 * D-PROD-294 — atualização automática do app (sem baixar APK de novo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const plugin = {
  download: vi.fn(async ({ version }) => ({ id: `id-${version}` })),
  next: vi.fn(async () => ({})),
  notifyAppReady: vi.fn(async () => ({})),
  set: vi.fn(async () => ({})),
};
const app = { getInfo: vi.fn(async () => ({ build: '4' })), addListener: vi.fn(async () => ({})) };
vi.mock('@capgo/capacitor-updater', () => ({ CapacitorUpdater: plugin }));
vi.mock('@capacitor/app', () => ({ App: app }));

const ORIGEM = 'https://servidor.exemplo.invalido';
const respostas = (ultima, local = { versao: 'v1' }) =>
  vi.fn(async (url) => {
    if (url === '/app-versao.json') return { ok: true, json: async () => local };
    if (url === `${ORIGEM}/app-atualizacao/ultima.json`) return { ok: true, json: async () => ultima };
    return { ok: false };
  });

const carregar = async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', ORIGEM);
  /** @type {any} */ (window).Capacitor = { isNativePlatform: () => true };
  return import('@/lib/app/atualizacaoAutomatica');
};

beforeEach(() => {
  vi.clearAllMocks();
  app.getInfo.mockResolvedValue({ build: '4' });
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  /** @type {any} */ (window).Capacitor = undefined;
});

describe('D-PROD-294 — atualização automática', () => {
  it('AT-01 versão nova: baixa do servidor (com sha256) e deixa para a próxima abertura', async () => {
    vi.stubGlobal('fetch', respostas({ versao: 'v2', url: '/app-atualizacao/v2.zip', checksum: 'abc', nativoMinimo: 4 }));
    const { conferirAtualizacao } = await carregar();
    expect(await conferirAtualizacao()).toBe('baixada');
    expect(plugin.download).toHaveBeenCalledWith({ url: `${ORIGEM}/app-atualizacao/v2.zip`, version: 'v2', checksum: 'abc' });
    expect(plugin.next).toHaveBeenCalledWith({ id: 'id-v2' });
  });

  it('AT-02 mesma versão: não baixa nada', async () => {
    vi.stubGlobal('fetch', respostas({ versao: 'v1', url: '/app-atualizacao/v1.zip', nativoMinimo: 4 }));
    const { conferirAtualizacao } = await carregar();
    expect(await conferirAtualizacao()).toBe('atual');
    expect(plugin.download).not.toHaveBeenCalled();
  });

  it('AT-03 pacote pede APK mais novo (mudança nativa): não aplica', async () => {
    vi.stubGlobal('fetch', respostas({ versao: 'v2', url: '/app-atualizacao/v2.zip', nativoMinimo: 5 }));
    const { conferirAtualizacao } = await carregar();
    expect(await conferirAtualizacao()).toBe('nativo-antigo');
    expect(plugin.download).not.toHaveBeenCalled();
  });

  it('AT-04 sem internet ou servidor fora: não quebra e não baixa', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    vi.stubGlobal('fetch', vi.fn());
    let m = await carregar();
    expect(await m.conferirAtualizacao()).toBe('sem-internet');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    m = await carregar();
    expect(await m.conferirAtualizacao()).toBe('falhou');
    expect(plugin.download).not.toHaveBeenCalled();
  });

  it('AT-05 ao iniciar avisa o plugin que o pacote abriu (senão ele volta ao anterior)', async () => {
    vi.stubGlobal('fetch', respostas({ versao: 'v1', url: '/x.zip', nativoMinimo: 1 }));
    const { iniciarAtualizacaoAutomatica } = await carregar();
    iniciarAtualizacaoAutomatica();
    expect(plugin.notifyAppReady).toHaveBeenCalledTimes(1);
    expect(app.addListener).toHaveBeenCalledWith('resume', expect.any(Function));
  });

  it('AT-06 fora do app (site): não faz nada', async () => {
    const m = await carregar();
    /** @type {any} */ (window).Capacitor = { isNativePlatform: () => false };
    m.iniciarAtualizacaoAutomatica();
    expect(await m.conferirAtualizacao()).toBe('atual');
    expect(plugin.notifyAppReady).not.toHaveBeenCalled();
  });
});

describe('D-PROD-304 — a pessoa fica sabendo da atualização', () => {
  it('AV-01 versão baixada: avisa (com o id) e guarda; conferir de novo não baixa outra vez, só lembra', async () => {
    vi.stubGlobal('fetch', respostas({ versao: 'v2', url: '/app-atualizacao/v2.zip', checksum: 'abc', nativoMinimo: 4 }));
    const m = await carregar();
    const avisos = [];
    const ouvir = (e) => avisos.push(e.detail);
    window.addEventListener(m.EVENTO_VERSAO_BAIXADA, ouvir);
    expect(await m.conferirAtualizacao()).toBe('baixada');
    expect(await m.conferirAtualizacao()).toBe('baixada');
    window.removeEventListener(m.EVENTO_VERSAO_BAIXADA, ouvir);
    expect(plugin.download).toHaveBeenCalledTimes(1);
    expect(avisos).toEqual([{ versao: 'v2', id: 'id-v2' }, { versao: 'v2', id: 'id-v2' }]);
    expect(m.versaoBaixadaEsperando()).toEqual({ versao: 'v2', id: 'id-v2' });
  });

  it('AV-02 "atualizar agora" troca para a versão baixada na hora', async () => {
    vi.stubGlobal('fetch', respostas({ versao: 'v2', url: '/app-atualizacao/v2.zip', nativoMinimo: 4 }));
    const m = await carregar();
    expect(await m.aplicarVersaoBaixada()).toBe(false); // nada baixado ainda
    await m.conferirAtualizacao();
    expect(await m.aplicarVersaoBaixada()).toBe(true);
    expect(plugin.set).toHaveBeenCalledWith({ id: 'id-v2' });
  });

  it('AV-03 abriu com pacote novo: avisa "App atualizado" uma vez e esquece a versão baixada', async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem('maike_app_versao_em_uso', 'v1');
      window.localStorage.setItem('maike_app_versao_baixada', JSON.stringify({ versao: 'v2', id: 'id-v2' }));
      vi.stubGlobal('fetch', respostas({ versao: 'v2', url: '/x.zip', nativoMinimo: 1 }, { versao: 'v2' }));
      const m = await carregar();
      const avisos = [];
      window.addEventListener(m.EVENTO_APP_ATUALIZADO, (e) => avisos.push(e.detail));
      m.iniciarAtualizacaoAutomatica();
      await vi.advanceTimersByTimeAsync(3000);
      expect(avisos).toEqual([{ versao: 'v2' }]);
      expect(window.localStorage.getItem('maike_app_versao_em_uso')).toBe('v2');
      expect(m.versaoBaixadaEsperando()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AV-04 versão do app para o menu: a do APK e a do pacote', async () => {
    app.getInfo.mockResolvedValue({ build: '5', version: '1.0.4' });
    vi.stubGlobal('fetch', respostas({ versao: 'v1', url: '/x.zip', nativoMinimo: 1 }, { versao: 'abc123def456' }));
    const m = await carregar();
    expect(await m.versaoDoApp()).toEqual({ apk: '1.0.4', pacote: 'abc123def456' });
  });
});
