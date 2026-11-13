/**
 * Porta nativa de CategoriaManejo (P5.4).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'CategoriaManejo';
const CAMINHO = '/categorias-manejo';
export const ENTIDADE_OFFLINE = 'CategoriaManejo';

const ctx = (operation) => ({ operation, resource: RESOURCE });

/**
 * Campos que o cadastro grava. Raça, categoria oficial (texto), ganho de peso
 * anual e os doze GMDs mensais saíram do cadastro: mesmo que um corpo antigo
 * (fila offline gravada antes desta versão) ainda os traga, eles não são
 * enviados.
 */
export const CAMPOS_GRAVAVEIS = Object.freeze([
  'empresa_id',
  'nome',
  'sigla',
  'especie',
  'sexo',
  'idade_minima_meses',
  'idade_maxima_meses',
  'catalogo_categoria_visual_id',
  'ativo',
]);

/** @param {Record<string, unknown>} dados */
export const corpoDeEnvio = (dados) =>
  Object.fromEntries(
    CAMPOS_GRAVAVEIS.filter((campo) => Object.prototype.hasOwnProperty.call(dados ?? {}, campo)).map(
      (campo) => [campo, /** @type {Record<string, unknown>} */ (dados)[campo]]
    )
  );

const queryDeFiltro = (criterio) => {
  if (!criterio || typeof criterio !== 'object') return '';
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(criterio)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(chave, String(valor));
  }
  const texto = params.toString();
  return texto ? `?${texto}` : '';
};

const operacoesNativas = Object.freeze({
  list: (ordenacao) => {
    void ordenacao;
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('listCategoriaManejo'));
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: corpoDeEnvio(dados), autenticado: true }, ctx('createCategoriaManejo')),
  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados), autenticado: true },
      ctx('updateCategoriaManejo')
    ),
  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteCategoriaManejo')
    ),
});

export const categoriaManejoPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
    })
  : operacoesNativas;
