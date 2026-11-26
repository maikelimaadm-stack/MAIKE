/**
 * Porta nativa de SuplementacaoEvento (P5.5).
 *
 * D-PROD-319 (Etapa 5a): o evento criado por aqui (o automático da chegada do gado) tem o id gerado no aparelho
 * (UUID), definitivo; repetir a criação devolve o mesmo evento em vez de gravar outro.
 */
import { registrarListaIncremental, ordemPorCriacao } from '@/lib/offline/sincronizacaoIncremental';
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'SuplementacaoEvento';
const CAMINHO = '/suplementacao-eventos';
export const ENTIDADE_OFFLINE = 'SuplementacaoEvento';

const ctx = (operation) => ({ operation, resource: RESOURCE });

/**
 * Ordem `campo` / `-campo` (estável; nulos por último no decrescente) — a mesma da porta offline.
 * @param {any[]} items @param {unknown} order
 */
const ordenarPor = (items, order) => {
  if (!order || typeof order !== 'string') return items;
  const desc = order.startsWith('-');
  const campo = desc ? order.slice(1) : order;
  return [...items].sort((a, b) => {
    const va = a?.[campo];
    const vb = b?.[campo];
    if (va === vb) return 0;
    if (va === undefined || va === null) return desc ? 1 : -1;
    if (vb === undefined || vb === null) return desc ? -1 : 1;
    return va > vb ? (desc ? -1 : 1) : (desc ? 1 : -1);
  });
};

const operacoesNativas = Object.freeze({
  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? `?limit=${encodeURIComponent(String(limite))}` : '';
    return nativeRequest(`${CAMINHO}${qs}`, { autenticado: true }, ctx('listSuplementacaoEvento'));
  },

  // D-PROD-268: o limite vale DEPOIS do filtro e da ordem (como na porta offline). Antes, o
  // `limit` ia ao GET do tenant inteiro e o filtro do cocho rodava só sobre os N mais novos da
  // conta: o "último lançamento do cocho" podia sair vazio (e o `evento_anterior_id` errado).
  filter: async (criterio, ordenacao, limite) => {
    const lista = await operacoesNativas.list(undefined, undefined);
    const arr = (Array.isArray(lista) ? lista : []).filter((item) =>
      Object.entries(criterio || {}).every(([campo, valor]) => item?.[campo] === valor)
    );
    const ordenados = ordenarPor(arr, ordenacao);
    return typeof limite === 'number' && limite > 0 ? ordenados.slice(0, limite) : ordenados;
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createSuplementacaoEvento')),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updateSuplementacaoEvento')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteSuplementacaoEvento')
    ),

});

const portaBase = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
      tenantScoped: true,
      idDoAparelho: true,
    })
  : operacoesNativas;

/**
 * D-PROD-268 — documento CANCELADO (`situacao: 'cancelado'`) não aparece em leitura nenhuma: o
 * servidor já o omite no GET; aqui é o reforço para a cópia offline antiga do aparelho.
 * @param {unknown} lista
 */
const semCancelados = (lista) => (Array.isArray(lista) ? lista.filter((item) => item?.situacao !== 'cancelado') : lista);

export const suplementacaoEventoPort = Object.freeze({
  ...portaBase,
  list: async (/** @type {any[]} */ ...args) => semCancelados(await /** @type {any} */ (portaBase).list(...args)),
  // O limite vale depois de tirar os cancelados (senão um cancelado da cópia antiga ocupava a vaga).
  filter: async (/** @type {any} */ criterio, /** @type {any} */ ordenacao, /** @type {any} */ limite) => {
    const lista = semCancelados(await /** @type {any} */ (portaBase).filter(criterio, ordenacao));
    return Array.isArray(lista) && typeof limite === 'number' && limite > 0 ? lista.slice(0, limite) : lista;
  },
});

// D-PROD-294: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/suplementacao-eventos',
]);

// D-PROD-309: a lista inteira (sem filtros) sincroniza só o que mudou desde a última vez
// (`nativeRequest` usa `${CAMINHO}/mudancas` e junta com a cópia do aparelho).
registrarListaIncremental(CAMINHO, { mudancas: `${CAMINHO}/mudancas`, ordem: ordemPorCriacao });
