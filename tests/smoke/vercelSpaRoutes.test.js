/**
 * Deep links SPA vs API same-origin (FIX-MAP-LOOP-SPA-ROUTES).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPageUrl } from '../../src/utils/index.ts';
import {
  buildNativeApiRewrites,
  VERCEL_SPA_DOCUMENT_ACCEPT_GUARD,
} from '../../scripts/vercel/nativeApiRewriteRules.mjs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));

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

describe('VERCEL-SPA — deep link não cai na API', () => {
  it('vercel.json está sincronizado com o gerador SSOT', () => {
    expect(vercel.rewrites).toEqual(buildNativeApiRewrites());
  });

  it('rotas REST colidentes exigem guard missing text/html no Accept', () => {
    const pathsSpa = new Set(PAGINAS_SPA.map((nome) => createPageUrl(nome)));
    for (const pathname of pathsSpa) {
      const rewriteExato = vercel.rewrites.find((r) => r.source === pathname);
      if (!rewriteExato) continue;
      expect(rewriteExato.missing).toEqual(VERCEL_SPA_DOCUMENT_ACCEPT_GUARD.missing);
      expect(rewriteExato.destination).toBe('/api/fastify');
    }
  });

  it('/bebedouros documento: simula Accept text/html (não reescreve como API)', () => {
    const regra = vercel.rewrites.find((r) => r.source === '/bebedouros');
    expect(regra).toBeTruthy();
    expect(regra.missing).toEqual([
      { type: 'header', key: 'accept', value: 'text/html' },
    ]);
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
