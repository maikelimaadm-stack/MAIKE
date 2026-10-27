import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';

const carregarConfig = async () => {
  vi.resetModules();
  return import('@/config/runtimeConfig');
};

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
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
 * ENV1–ENV8, ENV11, ENV12 — contrato de variável de build do Vite.
 */
describe('ENV — variáveis de build com referência estática', () => {
  const fonteConfig = () => readFileSync('src/config/runtimeConfig.js', 'utf8');
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
    ['ENV3', 'VITE_MAIKE_API_URL'],
  ])('%s — %s aparece como referência estática literal', (_id, variavel) => {
    expect(codigoConfig()).toContain(`import.meta.env.${variavel}`);
  });

  it('nenhuma outra fonte de src/ lê import.meta.env por conta própria', () => {
    const arquivos = readdirSync('src', { recursive: true })
      .map((rel) => `src/${String(rel).split(sep).join('/')}`)
      .filter((rel) => /\.(js|jsx)$/.test(rel));
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

  it('ENV11 — a URL nativa continua resolvendo pelo ambiente', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', 'https://exemplo.invalido/api');
    const { getNativeApiUrl } = await carregarConfig();
    expect(getNativeApiUrl()).toBe('https://exemplo.invalido/api');
  });

  it('ENV12 — nenhum valor de env aparece em describeRuntimeConfig', async () => {
    const chave = 'chave-sintetica-de-teste';
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', chave);
    vi.stubEnv('VITE_MAIKE_API_URL', 'https://exemplo.invalido/api');

    const { describeRuntimeConfig } = await carregarConfig();
    const serializado = JSON.stringify(describeRuntimeConfig());

    expect(serializado).not.toContain(chave);
    expect(serializado).not.toContain('exemplo.invalido');
    expect(Object.values(describeRuntimeConfig()).every((v) => typeof v === 'boolean')).toBe(true);
  });
});

describe('ENV7/ENV8 — mensagem pública de configuração ausente', () => {
  it('ENV7 — orienta desenvolvimento e produção, não só .env.local', async () => {
    const { GOOGLE_MAPS_MISSING_KEY_MESSAGE } = await import('@/lib/googleMaps');
    expect(GOOGLE_MAPS_MISSING_KEY_MESSAGE).toContain('VITE_GOOGLE_MAPS_API_KEY');
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
    const chave = 'chave-sintetica-de-teste';
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', chave);
    vi.stubEnv('VITE_MAIKE_API_URL', 'https://backend.exemplo.invalido');

    const { describeRuntimeConfig } = await carregarConfig();
    const descricao = describeRuntimeConfig();
    const serializado = JSON.stringify(descricao);

    expect(descricao.hasGoogleMapsApiKey).toBe(true);
    expect(descricao.hasNativeApiUrl).toBe(true);
    expect(serializado).not.toContain(chave);
    expect(serializado).not.toContain('backend.exemplo.invalido');
  });

  it('o módulo não escreve nada em console ao resolver a configuração', async () => {
    const chamadas = [];
    const espioes = ['log', 'info', 'warn', 'error', 'debug'].map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation((...args) => chamadas.push(args.join(' ')))
    );

    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'chave-sintetica-de-teste');
    await carregarConfig();

    expect(chamadas).toEqual([]);
    espioes.forEach((e) => e.mockRestore());
  });
});
