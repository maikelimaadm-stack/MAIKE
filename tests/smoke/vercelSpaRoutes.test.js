/**
 * Deep links SPA vs API same-origin (FIX-LOTES-URL-R2 / FIX-MAP-LOOP-SPA-ROUTES).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPageUrl } from '../../src/utils/index.ts';
import {
  buildNativeApiRewrites,
  VERCEL_SPA_DOCUMENT_ACCEPT_GUARD,
} from '../../scripts/vercel/nativeApiRewriteRules.mjs';
import {
  acceptHeaderIsSpaDocument,
  resolveRewrite,
  headerValueMatchesPattern,
  VERCEL_ACCEPT_TEXT_HTML_HEADER_VALUE,
} from '../../scripts/vercel/vercelAcceptMatch.mjs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const rewrites = buildNativeApiRewrites();

/** Páginas cujo pathname pode coincidir com prefixo REST. */
const PAGINAS_SPA = [
  'Bebedouros',
  'Marcas',
  'Usuarios',
  'Produtos',
  'Categorias',
  'UnidadesMedida',
  'LocaisEstoque',
  'TiposTarefa',
  'GruposAtividades',
  'CadastroLotes',
  'CadastroSetores',
  'CategoriasManejo',
  'Empresa',
  'MapaGeral',
];

const CHROME_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

describe('VERCEL-SPA — vercel.json sincronizado', () => {
  it('vercel.json está sincronizado com o gerador SSOT', () => {
    expect(vercel.rewrites).toEqual(rewrites);
  });
});

describe('VERCEL-SPA — Accept composto vs API', () => {
  it('acceptHeaderIsSpaDocument reconhece text/html isolado e composto', () => {
    expect(acceptHeaderIsSpaDocument('text/html')).toBe(true);
    expect(acceptHeaderIsSpaDocument(CHROME_ACCEPT)).toBe(true);
    expect(acceptHeaderIsSpaDocument('text/html;q=0.9, application/json')).toBe(true);
    expect(acceptHeaderIsSpaDocument('application/json')).toBe(false);
    expect(acceptHeaderIsSpaDocument('*/*')).toBe(false);
    expect(acceptHeaderIsSpaDocument(undefined)).toBe(false);
  });

  it('padrão do guard casa Accept composto (regex Vercel)', () => {
    expect(headerValueMatchesPattern(VERCEL_ACCEPT_TEXT_HTML_HEADER_VALUE, 'text/html')).toBe(true);
    expect(headerValueMatchesPattern(VERCEL_ACCEPT_TEXT_HTML_HEADER_VALUE, CHROME_ACCEPT)).toBe(true);
    expect(headerValueMatchesPattern(VERCEL_ACCEPT_TEXT_HTML_HEADER_VALUE, 'application/json')).toBe(false);
  });

  it('/produtos documento → index.html; JSON → API', () => {
    const html = resolveRewrite(rewrites, {
      pathname: '/produtos',
      headers: { accept: CHROME_ACCEPT },
    });
    expect(html?.destination).toBe('/index.html');

    const json = resolveRewrite(rewrites, {
      pathname: '/produtos',
      headers: { accept: 'application/json' },
    });
    expect(json?.destination).toBe('/api/fastify');
  });

  it('/cadastrolotes documento → index.html (sem colisão REST)', () => {
    const hit = resolveRewrite(rewrites, {
      pathname: '/cadastrolotes',
      headers: { accept: 'text/html' },
    });
    expect(hit?.destination).toBe('/index.html');
  });

  it('alias PascalCase /Produtos → index.html', () => {
    const hit = resolveRewrite(rewrites, {
      pathname: '/Produtos',
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

describe('VERCEL-SPA — rotas REST colidentes', () => {
  it('rotas REST colidentes exigem guard missing text/html no Accept', () => {
    const pathsSpa = new Set(PAGINAS_SPA.map((nome) => createPageUrl(nome)));
    for (const pathname of pathsSpa) {
      const rewriteApi = rewrites.find(
        (r) => r.source === pathname && r.destination === '/api/fastify',
      );
      if (!rewriteApi) continue;
      expect(rewriteApi.missing).toEqual(VERCEL_SPA_DOCUMENT_ACCEPT_GUARD.missing);
    }
  });

  it('cada página permitida tem rewrite SPA para index.html', () => {
    for (const nome of PAGINAS_SPA) {
      const path = createPageUrl(nome);
      const spa = rewrites.find((r) => r.source === path && r.destination === '/index.html');
      expect(spa, `SPA rewrite ausente para ${path}`).toBeTruthy();
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
