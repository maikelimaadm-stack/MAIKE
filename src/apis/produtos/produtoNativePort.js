/**
 * Porta nativa de Produto (P5.2, D-PROD-48).
 *
 * D-PROD-161 (Estoque P0): o saldo de estoque não está na allowlist de envio. É
 * cache do motor físico (Entradas/Movimentações): POST e PATCH nunca o levam,
 * nem quando um chamador antigo ainda o manda (a allowlist o descarta).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'Produto';
const CAMINHO = '/produtos';

export const ENTIDADE_OFFLINE = 'Produto';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const CAMPOS_DE_CRIACAO = Object.freeze([
  'empresa_id',
  'nome_produto',
  'tipo_uso',
  'codigo_interno',
  'codigo_barras',
  'categoria',
  'marca',
  'descricao',
  'unidade_medida',
  'preco_custo',
  'preco_venda',
  'estoque_minimo',
  'local_estoque',
  'tipo_consumo',
  'percentual_consumo_pv',
  'consumo_minimo_pv',
  'consumo_maximo_pv',
  'unidade_principal_estoque',
  'peso_por_saco_kg',
  // D-PROD-274: a carência da bula, em dias (0..365; vazio limpa).
  'carencia_dias',
  // Diário da máquina (Fase 3): quantidade por implemento cheio (texto decimal) e a unidade (L|KG). Só vai quando preenchida.
  'quantidade_padrao',
  'quantidade_padrao_unidade',
  // D-PROD-282: controle de lote e de validade.
  'controla_lote',
  'controla_validade',
  // D-PROD-288: unidades de conversão (dentro do POST/PATCH do produto).
  'unidades_conversao',
  'observacoes',
  'ativo',
]);

const CAMPOS_DE_ATUALIZACAO = Object.freeze(
  CAMPOS_DE_CRIACAO.filter((campo) => campo !== 'empresa_id')
);

const valorDeEnvio = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/** @param {Record<string, unknown>} dados @param {readonly string[]} permitidos */
export const corpoDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = valorDeEnvio(/** @type {Record<string, unknown>} */ (dados)[campo]);
    if (valor !== undefined) corpo[campo] = valor;
  }
  return corpo;
};

const queryDeFiltro = (criterio) => {
  if (!criterio || typeof criterio !== 'object') return '';
  const params = new URLSearchParams();
  if (criterio.empresa_id) params.set('empresa_id', String(criterio.empresa_id));
  if (criterio.ativo !== undefined) params.set('ativo', String(Boolean(criterio.ativo)));
  const texto = params.toString();
  return texto ? `?${texto}` : '';
};

/**
 * Querystring da listagem paginada (tenant só no JWT).
 * @param {Record<string, unknown>} [filtros]
 */
export const montarCaminhoListagemPagina = (filtros = {}) => {
  const params = new URLSearchParams();
  if (typeof filtros.empresa_id === 'string' && filtros.empresa_id.trim()) {
    params.set('empresa_id', filtros.empresa_id.trim());
  }
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  if (typeof filtros.q === 'string' && filtros.q.trim()) params.set('q', filtros.q.trim());
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const qs = params.toString();
  return qs ? `${CAMINHO}/page?${qs}` : `${CAMINHO}/page`;
};

export const operacoesNativas = Object.freeze({
  list: (ordenacao) => {
    void ordenacao;
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('listProdutos'));
  },

  filter: (criterio) =>
    nativeRequest(`${CAMINHO}${queryDeFiltro(criterio)}`, { autenticado: true }, ctx('filterProdutos')),

  /** Página keyset — fora do cache offline (página ≠ lista completa). */
  listPage: (filtros = {}) =>
    nativeRequest(montarCaminhoListagemPagina(filtros), { autenticado: true }, ctx('listProdutosPage')),

  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createProduto')
    ),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO), autenticado: true },
      ctx('updateProduto')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteProduto')
    ),
});

export const produtoPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});

// D-PROD-294: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/produtos',
  '/produtos/page?empresa_id={empresa}&limit=100',
]);
