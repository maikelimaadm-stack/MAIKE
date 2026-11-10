/**
 * Deep links SPA vs API same-origin (R4 — namespace `/api/native`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPageUrl } from '../../src/utils/index.ts';
import { buildNativeApiRewrites } from '../../scripts/vercel/nativeApiRewriteRules.mjs';
import { NATIVE_API_PATH_PREFIX } from '../../config/nativeApiPath.js';
import { normalizarIngressoServerlessVercel } from '../../config/vercelFastifyIngress.js';
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

/**
 * Todas as páginas permitidas (24: +3 de Gestão Rural, D-PROD-146; +1 Naturezas
 * Financeiras, D-PROD-153; +1 Lançamentos Financeiros, D-PROD-155; +5 Patrimônio
 * e Frota, D-PROD-157; +1 Abastecimentos, D-PROD-159; −4 Famílias, Tipos, Perfis
 * de Medição e Combustíveis, D-PROD-161).
 */
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
  'Permissoes',
  'Parceiros',
  'CentrosCusto',
  'CentrosResultado',
  'NaturezasFinanceiras',
  'LancamentosFinanceiros',
  'BensPatrimoniais',
  'Abastecimentos',
];

/** D-PROD-161: páginas removidas — sem rewrite SPA (o deep link cai no 404 da Vercel, não no app). */
const PAGINAS_REMOVIDAS = ['FamiliasPatrimoniais', 'TiposPatrimoniais', 'PerfisMedicao', 'Combustiveis'];

describe('VERCEL-INGRESS — contrato handler ↔ normalizador (PR #107)', () => {
  it('counterexample /api/native/{rota}?__native_route= não vaza metadado', () => {
    expect(
      normalizarIngressoServerlessVercel('/api/native/empresas?__native_route=empresas&limit=200'),
    ).toBe('/empresas?limit=200');
  });
});

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
    expect(json?.destination).toBe('/api/fastify?__native_route=:path*');
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

describe('VERCEL-SPA — matriz das páginas', () => {
  it('a matriz tem as 24 páginas do manifesto, nem mais nem menos', () => {
    const scope = JSON.parse(readFileSync('config/mapa-manejo-scope.json', 'utf8'));
    expect(TODAS_PAGINAS_SPA).toHaveLength(24);
    expect([...TODAS_PAGINAS_SPA].sort()).toEqual([...scope.allowedPages].sort());
    // 2 rewrites da API nativa + 4 por página (minúsculas e PascalCase, com e sem barra final).
    expect(rewrites).toHaveLength(2 + 4 * 24);
  });

  it('as quatro páginas removidas pela D-PROD-161 não têm rewrite (nem no vercel.json)', () => {
    for (const nome of PAGINAS_REMOVIDAS) {
      for (const source of [`/${nome.toLowerCase()}`, `/${nome.toLowerCase()}/`, `/${nome}`, `/${nome}/`]) {
        expect(rewrites.find((r) => r.source === source), source).toBeUndefined();
        expect(vercel.rewrites.find((r) => r.source === source), source).toBeUndefined();
      }
    }
  });

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
