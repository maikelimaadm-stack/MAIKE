import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

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

/**
 * ENV1–ENV8, ENV11, ENV12 — o contrato de variável de build do Vite.
 *
 * A regressão da P1.2 não foi um valor errado: foi a **forma de ler**. O Vite
 * substitui textualmente cada `import.meta.env.VITE_ALGO` que enxerga no código;
 * leitura por chave computada não é substituída, e o bundle de produção fica sem
 * as variáveis mesmo com tudo configurado na plataforma.
 *
 * Teste unitário não pega isso — em Vitest o objeto existe e a leitura dinâmica
 * funciona. Por isso a garantia aqui é sobre o **texto do código de produção**,
 * e a prova de ponta a ponta é a ENV9 (build real com marcador sintético).
 */
describe('ENV — variáveis de build com referência estática', () => {
  const fonteConfig = () => readFileSync('src/config/runtimeConfig.js', 'utf8');
  /** Sem comentários: o texto explicativo cita as formas proibidas de propósito. */
  const codigoConfig = () =>
    fonteConfig()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('ENV1 — o código de produção não acessa import.meta.env dinamicamente', () => {
    const codigo = codigoConfig();
    expect(codigo).not.toMatch(/import\.meta\.env\s*\?\?\s*\[/);
    expect(codigo).not.toMatch(/import\.meta\.env\s*\?\.\s*\[/);
    expect(codigo).not.toMatch(/import\.meta\.env\s*\[/);
    expect(codigo).not.toMatch(/Reflect\.get\s*\(\s*import\.meta\.env/);
    expect(codigo).not.toMatch(/Object\.(entries|keys|values)\s*\(\s*import\.meta\.env/);
    expect(codigo).not.toMatch(/new Proxy\s*\(\s*import\.meta\.env/);
    expect(codigo).not.toMatch(/['"`]VITE_['"`]\s*\+/);
  });

  it.each([
    ['ENV2', 'VITE_GOOGLE_MAPS_API_KEY'],
    ['ENV3', 'VITE_BASE44_APP_ID'],
    ['ENV4', 'VITE_BASE44_BACKEND_URL'],
  ])('%s — %s aparece como referência estática literal', (_id, variavel) => {
    expect(codigoConfig()).toContain(`import.meta.env.${variavel}`);
  });

  it('nenhuma outra fonte de src/ lê import.meta.env por conta própria', async () => {
    const { globSync } = await import('node:fs');
    const arquivos = globSync('src/**/*.{js,jsx}');
    // Sem isto o teste passaria vazio se o glob mudasse de comportamento.
    expect(arquivos.length).toBeGreaterThan(100);
    const infratores = arquivos.filter(
      (rel) => rel !== 'src/config/runtimeConfig.js' && /import\.meta\.env/.test(readFileSync(rel, 'utf8'))
    );
    expect(infratores).toEqual([]);
  });

  it('ENV5 — chave ausente devolve null', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    const { getGoogleMapsApiKey, isGoogleMapsConfigured } = await carregarConfig();
    expect(getGoogleMapsApiKey()).toBeNull();
    expect(isGoogleMapsConfigured()).toBe(false);
  });

  it('ENV6 — espaços em volta são normalizados', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '   chave-sintetica-de-teste   ');
    const { getGoogleMapsApiKey } = await carregarConfig();
    const valor = getGoogleMapsApiKey();
    expect(valor).toBe('chave-sintetica-de-teste');
    expect(valor).toBe(valor.trim());
  });

  it('ENV6b — valor só com espaço conta como ausente', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '     ');
    const { isGoogleMapsConfigured } = await carregarConfig();
    expect(isGoogleMapsConfigured()).toBe(false);
  });

  it('ENV11 — os parâmetros da Base44 continuam resolvendo pelo ambiente', async () => {
    vi.stubEnv('VITE_BASE44_APP_ID', 'app-do-ambiente');
    vi.stubEnv('VITE_BASE44_BACKEND_URL', 'https://exemplo.invalido/api');
    const { getDataProviderConfig } = await carregarConfig();
    const config = getDataProviderConfig();
    expect(config.appId).toBe('app-do-ambiente');
    expect(config.serverUrl).toBe('https://exemplo.invalido/api');
  });

  it('ENV12 — nenhum valor de env aparece em describeRuntimeConfig', async () => {
    const chave = 'chave-sintetica-de-teste';
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', chave);
    vi.stubEnv('VITE_BASE44_APP_ID', 'app-secreto');
    vi.stubEnv('VITE_BASE44_BACKEND_URL', 'https://exemplo.invalido/api');

    const { describeRuntimeConfig } = await carregarConfig();
    const serializado = JSON.stringify(describeRuntimeConfig());

    expect(serializado).not.toContain(chave);
    expect(serializado).not.toContain('app-secreto');
    expect(serializado).not.toContain('exemplo.invalido');
    expect(Object.values(describeRuntimeConfig()).every((v) => typeof v === 'boolean')).toBe(true);
  });
});

describe('ENV7/ENV8 — mensagem pública de configuração ausente', () => {
  it('ENV7 — orienta desenvolvimento e produção, não só .env.local', async () => {
    const { GOOGLE_MAPS_MISSING_KEY_MESSAGE } = await import('@/lib/googleMaps');
    expect(GOOGLE_MAPS_MISSING_KEY_MESSAGE).toContain('VITE_GOOGLE_MAPS_API_KEY');
    // A versão anterior citava só `.env.local`, o que manda o operador de
    // produção para um arquivo que não existe no deploy.
    expect(GOOGLE_MAPS_MISSING_KEY_MESSAGE).toMatch(/nova versão|build|constru/i);
    expect(GOOGLE_MAPS_MISSING_KEY_MESSAGE).not.toMatch(/^Google Maps não configurado: defina .* no arquivo \.env\.local \(ver \.env\.example\)\.$/);
  });

  it('ENV8 — a mensagem não contém valor de chave nem dado interno', async () => {
    const { GOOGLE_MAPS_MISSING_KEY_MESSAGE, MAPS_ERROR_CODES, GoogleMapsError } =
      await import('@/lib/googleMaps');
    const erro = new GoogleMapsError(MAPS_ERROR_CODES.CONFIG_MISSING);
    for (const texto of [GOOGLE_MAPS_MISSING_KEY_MESSAGE, erro.message]) {
      expect(texto).not.toMatch(/AIza/);
      expect(texto).not.toMatch(/Bearer|token|senha|password/i);
      expect(texto).not.toMatch(/https?:\/\//);
      expect(texto).not.toMatch(/railway|vercel/i);
    }
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
