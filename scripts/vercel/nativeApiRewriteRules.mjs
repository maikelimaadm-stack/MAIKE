/**
 * Regras de rewrite Vercel: API nativa same-origin (D-PROD-36) sem roubar
 * navegação GET do SPA (deep links como /bebedouros).
 *
 * GET com `Accept` contendo `text/html` fica no SPA (Vite). Demais pedidos
 * no mesmo path vão para `/api/fastify` (fetch com `Accept: application/json`,
 * métodos mutáveis, OPTIONS, etc.).
 */

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

/** Navegação de documento no browser inclui text/html no Accept. */
export const VERCEL_SPA_DOCUMENT_ACCEPT_GUARD = {
  missing: [{ type: 'header', key: 'accept', value: 'text/html' }],
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

/** @returns {VercelRewrite[]} */
export const buildNativeApiRewrites = () => [
  ...REWRITES_INCONDICIONAIS,
  ...PREFIXOS_API.flatMap(rewritesParaPrefixo),
];
