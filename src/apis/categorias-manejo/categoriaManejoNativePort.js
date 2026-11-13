/**
 * Porta nativa de CategoriaManejo (P5.4).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import { faixaIdadeDaLista } from '@/domain/lotes/categoriaOficialDerivada';
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

const CHAVES_IDADE = Object.freeze(['idade_minima_meses', 'idade_maxima_meses']);

/**
 * Corpo do PATCH. Uma edição gravada na fila offline pela versão anterior
 * sempre trazia o par de idades (inclusive nulo/nulo ou par livre, como 0/12),
 * que o servidor agora recusa (faixa fora da lista fixa, D-PROD-185) — e um
 * item recusado trava a fila inteira. Se o par enviado não é uma faixa da
 * lista, as duas idades saem do corpo: o resto da edição é aplicado e a faixa
 * gravada fica como está. O formulário atual só manda idade quando a faixa
 * escolhida mudou, e sempre uma faixa da lista.
 * @param {Record<string, unknown>} dados
 */
export const corpoDeEdicao = (dados) => {
  const corpo = corpoDeEnvio(dados);
  const temIdade = CHAVES_IDADE.some((c) => Object.prototype.hasOwnProperty.call(corpo, c));
  if (temIdade && !faixaIdadeDaLista(corpo.idade_minima_meses, corpo.idade_maxima_meses)) {
    for (const c of CHAVES_IDADE) delete corpo[c];
  }
  return corpo;
};

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
      { method: 'PATCH', body: corpoDeEdicao(dados), autenticado: true },
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
