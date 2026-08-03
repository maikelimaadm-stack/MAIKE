import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A configuração do provider é resolvida uma única vez, no carregamento do
 * módulo — como o `app-params.js` fazia. Por isso cada cenário precisa preparar
 * `window` **antes** de importar, com `vi.resetModules()`.
 */
const carregarConfig = async () => {
  vi.resetModules();
  return import('@/config/runtimeConfig');
};

const prepararUrl = (search) => {
  window.history.replaceState({}, '', `/pagina${search}`);
};

beforeEach(() => {
  window.localStorage.clear();
  prepararUrl('');
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('runtimeConfig — provider', () => {
  it('lê o app id do ambiente quando não há parâmetro na URL', async () => {
    vi.stubEnv('VITE_BASE44_APP_ID', 'app-do-ambiente');
    const { getDataProviderConfig } = await carregarConfig();
    expect(getDataProviderConfig().appId).toBe('app-do-ambiente');
  });

  it('R1 — a query string vence ambiente e storage', async () => {
    window.localStorage.setItem('base44_app_id', 'app-do-storage');
    vi.stubEnv('VITE_BASE44_APP_ID', 'app-do-ambiente');
    prepararUrl('?app_id=app-da-url');
    const { getDataProviderConfig } = await carregarConfig();
    expect(getDataProviderConfig().appId).toBe('app-da-url');
  });

  it('R2 — env/default vence o storage quando os dois existem', async () => {
    // Precedência real, herdada do legado: URL > env/default > localStorage.
    window.localStorage.setItem('base44_app_id', 'app-do-storage');
    vi.stubEnv('VITE_BASE44_APP_ID', 'app-do-ambiente');
    prepararUrl('');
    const { getDataProviderConfig } = await carregarConfig();
    expect(getDataProviderConfig().appId).toBe('app-do-ambiente');
  });

  it('R3 — o storage é usado quando URL e env/default faltam', async () => {
    window.localStorage.setItem('base44_functions_version', 'v7-do-storage');
    prepararUrl('');
    const { getDataProviderConfig } = await carregarConfig();
    expect(getDataProviderConfig().functionsVersion).toBe('v7-do-storage');
  });

  it('persiste o valor resolvido para a próxima carga', async () => {
    prepararUrl('?server_url=https://exemplo.invalido');
    const primeira = await carregarConfig();
    expect(primeira.getDataProviderConfig().serverUrl).toBe('https://exemplo.invalido');

    // Sem a query string, o valor persistido continua valendo.
    prepararUrl('');
    const segunda = await carregarConfig();
    expect(segunda.getDataProviderConfig().serverUrl).toBe('https://exemplo.invalido');
  });

  it('remove o access_token da URL e o mantém fora do histórico', async () => {
    const token = 'token-sintetico-de-teste';
    prepararUrl(`?access_token=${token}&outro=fica`);

    const { getDataProviderConfig } = await carregarConfig();

    expect(getDataProviderConfig().token).toBe(token);
    expect(window.location.search).not.toContain('access_token');
    expect(window.location.search).toContain('outro=fica');
  });

  it('não quebra quando localStorage lança', async () => {
    const original = window.localStorage.getItem;
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('modo privado');
    });
    const { getDataProviderConfig } = await carregarConfig();
    expect(() => getDataProviderConfig()).not.toThrow();
    window.localStorage.getItem = original;
    vi.restoreAllMocks();
  });

  it('devolve o mesmo objeto congelado em chamadas repetidas', async () => {
    const { getDataProviderConfig } = await carregarConfig();
    expect(getDataProviderConfig()).toBe(getDataProviderConfig());
    expect(Object.isFrozen(getDataProviderConfig())).toBe(true);
  });
});

describe('runtimeConfig — Google Maps', () => {
  it('lê a chave do ambiente', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'chave-de-teste');
    const { getGoogleMapsApiKey, isGoogleMapsConfigured } = await carregarConfig();
    expect(getGoogleMapsApiKey()).toBe('chave-de-teste');
    expect(isGoogleMapsConfigured()).toBe(true);
  });

  it('chave ausente devolve null, não string vazia', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    const { getGoogleMapsApiKey, isGoogleMapsConfigured } = await carregarConfig();
    expect(getGoogleMapsApiKey()).toBeNull();
    expect(isGoogleMapsConfigured()).toBe(false);
  });
});

describe('runtimeConfig — segurança', () => {
  it('describeRuntimeConfig só revela presença, nunca valores', async () => {
    const token = 'token-sintetico-de-teste';
    const chave = 'chave-sintetica-de-teste';
    vi.stubEnv('VITE_BASE44_APP_ID', 'app-secreto');
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', chave);
    prepararUrl(`?access_token=${token}`);

    const { describeRuntimeConfig } = await carregarConfig();
    const descricao = describeRuntimeConfig();
    const serializado = JSON.stringify(descricao);

    expect(descricao.hasToken).toBe(true);
    expect(descricao.hasGoogleMapsApiKey).toBe(true);
    expect(serializado).not.toContain(token);
    expect(serializado).not.toContain(chave);
    expect(serializado).not.toContain('app-secreto');
  });

  it('o módulo não escreve nada em console ao resolver a configuração', async () => {
    const chamadas = [];
    const espioes = ['log', 'info', 'warn', 'error', 'debug'].map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation((...args) => chamadas.push(args.join(' ')))
    );

    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'chave-sintetica-de-teste');
    prepararUrl('?access_token=token-sintetico-de-teste');
    await carregarConfig();

    expect(chamadas).toEqual([]);
    espioes.forEach((e) => e.mockRestore());
  });
});
