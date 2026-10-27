/**
 * Deep links SPA vs API same-origin (R4 — namespace `/api/native`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPageUrl } from '../../src/utils/index.ts';
import { buildNativeApiRewrites } from '../../scripts/vercel/nativeApiRewriteRules.mjs';
import { NATIVE_API_PATH_PREFIX } from '../../config/nativeApiPath.js';
import { resolveRewrite } from '../../scripts/vercel/vercelAcceptMatch.mjs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const rewrites = buildNativeApiRewrites();

const CHROME_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

/** Páginas cujo pathname coincidia com prefixo REST antes do R4. */
const PAGINAS_COLISAO_HISTORICA = [
  'Bebedouros',
  'Marcas',
  'Usuarios',
  'Produtos',
  'Categorias',
];

/** Todas as páginas permitidas (16). */
const TODAS_PAGINAS_SPA = [
  'Bebedouros',
  'CadastroLotes',
  'CadastroSetores',
  'Categorias',
  'CategoriasManejo',
  'ConfiguracoesGerais',
  'Empresa',
  'GruposAtividades',
  'LocaisEstoque',
  'MapaCadastro',
  'MapaGeral',
  'Marcas',
  'Produtos',
  'TiposTarefa',
  'UnidadesMedida',
  'Usuarios',
];

describe('VERCEL-SPA — vercel.json sincronizado', () => {
  it('vercel.json está sincronizado com o gerador SSOT', () => {
    expect(vercel.rewrites).toEqual(rewrites);
  });

  it('não há rewrite de API no path SPA colidente (sem /api/native)', () => {
    for (const nome of PAGINAS_COLISAO_HISTORICA) {
      const path = createPageUrl(nome);
      const apiRewrite = rewrites.find(
        (r) => r.source === path && r.destination === '/api/fastify',
      );
      expect(apiRewrite, `API rewrite ainda presente em ${path}`).toBeFalsy();
    }
  });
});

describe('VERCEL-SPA — documento vs JSON', () => {
  it('/produtos documento → index.html', () => {
    const html = resolveRewrite(rewrites, {
      pathname: '/produtos',
      headers: { accept: CHROME_ACCEPT },
    });
    expect(html?.destination).toBe('/index.html');
  });

  it('/produtos JSON no path legado não roteia para Fastify', () => {
    const json = resolveRewrite(rewrites, {
      pathname: '/produtos',
      headers: { accept: 'application/json' },
    });
    expect(json?.destination).not.toBe('/api/fastify');
  });

  it(`${NATIVE_API_PATH_PREFIX}/produtos JSON → API`, () => {
    const json = resolveRewrite(rewrites, {
      pathname: `${NATIVE_API_PATH_PREFIX}/produtos`,
      headers: { accept: 'application/json' },
    });
    expect(json?.destination).toBe('/api/fastify');
  });

  it('alias PascalCase /Produtos → index.html', () => {
    const hit = resolveRewrite(rewrites, {
      pathname: '/Produtos',
      headers: { accept: CHROME_ACCEPT },
    });
    expect(hit?.destination).toBe('/index.html');
  });

  it('trailing slash /marcas/ → index.html', () => {
    const hit = resolveRewrite(rewrites, {
      pathname: '/marcas/',
      headers: { accept: CHROME_ACCEPT },
    });
    expect(hit?.destination).toBe('/index.html');
  });

  it('asset inexistente não recebe rewrite SPA conhecido', () => {
    const hit = resolveRewrite(rewrites, {
      pathname: '/assets/nao-existe-12345.js',
      headers: { accept: CHROME_ACCEPT },
    });
    expect(hit).toBeNull();
  });
});

describe('VERCEL-SPA — matriz das 16 páginas', () => {
  it('cada página permitida tem rewrite SPA para index.html', () => {
    for (const nome of TODAS_PAGINAS_SPA) {
      const path = createPageUrl(nome);
      const spa = rewrites.find((r) => r.source === path && r.destination === '/index.html');
      expect(spa, `SPA rewrite ausente para ${path}`).toBeTruthy();
      const pascal = rewrites.find(
        (r) => r.source === `/${nome}` && r.destination === '/index.html',
      );
      expect(pascal, `SPA rewrite PascalCase ausente para /${nome}`).toBeTruthy();
    }
  });
});

describe('MAP-LOOP — init do Google Maps não depende do objeto renderer', () => {
  const fonte = readFileSync('src/pages/MapaGeral.jsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('teardownMapInstance usa dependência estável (clearAll)', () => {
    expect(fonte).toMatch(/teardownMapInstance = useCallback\([\s\S]*?\[renderer\.clearAll\]/);
    expect(fonte).not.toMatch(/teardownMapInstance = useCallback\([\s\S]*?\[renderer\]\s*\)/);
  });
});

describe('MAP-LOOP — AppRouteContent sem mapa persistente duplicado', () => {
  const fonte = readFileSync('src/components/navigation/AppRouteContent.jsx', 'utf8');

  it('Outlet único; Mapa Geral não é montado em paralelo no shell', () => {
    expect(fonte).toContain('<Outlet />');
    expect(fonte).not.toContain('MapaGeral');
    expect(fonte).not.toContain('data-persistent-map');
  });
});
