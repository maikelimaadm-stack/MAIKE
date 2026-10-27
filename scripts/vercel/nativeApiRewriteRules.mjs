/**
 * Regras de rewrite Vercel: API nativa same-origin (D-PROD-36) + deep links SPA.
 *
 * GET com `Accept` contendo `text/html` fica no SPA (Vite). Demais pedidos
 * no mesmo path vão para `/api/fastify` (fetch com `Accept: application/json`,
 * métodos mutáveis, OPTIONS, etc.).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VERCEL_ACCEPT_TEXT_HTML_MISSING_CONDITION,
} from './vercelAcceptMatch.mjs';

/** @typedef {{ source: string, destination: string, has?: object[], missing?: object[] }} VercelRewrite */

/** Rotas que nunca colidem com páginas do `pages.config.js`. */
const REWRITES_INCONDICIONAIS = [
  { source: '/auth/:path*', destination: '/api/fastify' },
  { source: '/health', destination: '/api/fastify' },
  { source: '/arquivos/upload', destination: '/api/fastify' },
  { source: '/referencias/sincronizar', destination: '/api/fastify' },
];

/** Prefixos REST expostos pelo Fastify (mesmo path no cliente nativo). */
const PREFIXOS_API = [
  '/setores',
  '/areas-pastagem',
  '/configuracao-icones',
  '/pontos-referencia',
  '/linhas-geograficas',
  '/usuarios',
  '/marcas',
  '/unidades-medida',
  '/grupos-atividade',
  '/tipos-tarefa',
  '/lotes',
  '/categorias',
  '/locais-estoque',
  '/produtos',
  '/lancamentos-tarefa',
  '/historicos-lancamento-tarefa',
  '/empresas',
  '/permissoes',
  '/fornecedores',
  '/categorias-manejo',
  '/bebedouros',
  '/pontos-suplementacao',
  '/estoque-lotes-nota',
  '/movimentacoes-estoque',
  '/movimentacoes-mapa',
  '/movimentacoes-pecuaria',
  '/suplementacao-eventos',
  '/suplementacao-lotes',
  '/aplicacoes-medicamento',
  '/eventos-sanitarios',
  '/manejos-tecnico-rebanho',
  '/bebedouros-historico',
  '/bebedouros-sanidade',
  '/bebedouros-alertas',
  '/registros-anexo',
];

/**
 * Guard: regra de API só aplica quando Accept **não** contém text/html (inclui Accept composto).
 * `missing` = condição ausente → rewrite quando nenhuma condição `missing` está presente no request.
 */
export const VERCEL_SPA_DOCUMENT_ACCEPT_GUARD = {
  missing: [VERCEL_ACCEPT_TEXT_HTML_MISSING_CONDITION],
};

/**
 * @param {string} prefixo
 * @returns {VercelRewrite[]}
 */
const rewritesParaPrefixo = (prefixo) => {
  const destino = '/api/fastify';
  return [
    { source: prefixo, destination: destino, ...VERCEL_SPA_DOCUMENT_ACCEPT_GUARD },
    { source: `${prefixo}/:path*`, destination: destino, ...VERCEL_SPA_DOCUMENT_ACCEPT_GUARD },
  ];
};

/** @param {string} pageName */
const pagePathFromName = (pageName) => `/${pageName.toLowerCase()}`;

/** Paths de páginas SPA (SSOT: config/mapa-manejo-scope.json). */
const buildSpaPageRewrites = () => {
  const scopePath = join(process.cwd(), 'config/mapa-manejo-scope.json');
  const scope = JSON.parse(readFileSync(scopePath, 'utf8'));
  /** @type {string[]} */
  const paths = [];
  for (const pageName of scope.allowedPages) {
    paths.push(pagePathFromName(pageName));
    paths.push(`/${pageName}`);
  }
  const unique = [...new Set(paths)].sort((a, b) => b.length - a.length);
  return unique.map((source) => ({
    source,
    destination: '/index.html',
  }));
};

/** @returns {VercelRewrite[]} */
export const buildNativeApiRewrites = () => [
  ...REWRITES_INCONDICIONAIS,
  ...PREFIXOS_API.flatMap(rewritesParaPrefixo),
  ...buildSpaPageRewrites(),
];
