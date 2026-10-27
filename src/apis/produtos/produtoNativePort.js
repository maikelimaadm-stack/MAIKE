/**
 * Porta nativa de Produto (P5.2, D-PROD-48).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

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
  'estoque_atual',
  'estoque_minimo',
  'local_estoque',
  'tipo_consumo',
  'percentual_consumo_pv',
  'consumo_minimo_pv',
  'consumo_maximo_pv',
  'unidade_principal_estoque',
  'peso_por_saco_kg',
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

export const operacoesNativas = Object.freeze({
  list: (ordenacao) => {
    void ordenacao;
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('listProdutos'));
  },

  filter: (criterio) =>
    nativeRequest(`${CAMINHO}${queryDeFiltro(criterio)}`, { autenticado: true }, ctx('filterProdutos')),

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
