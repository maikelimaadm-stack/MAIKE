/**
 * API do módulo Áreas de Pastagem (P4.2, D-PROD-30).
 *
 * Implementação interna: quem está fora do módulo importa `@/apis/areas`.
 *
 * Este módulo nasce pelo mesmo motivo que fez `listSetores` mudar de dono na
 * P4.1. Antes desta missão havia **duas** leituras do mesmo agregado —
 * `mapaProvider.listAreas` e `suplementacaoProvider.listAreas` —, aceitáveis
 * enquanto as duas batiam na mesma entidade da Base44. Com a persistência
 * nativa elas deixariam de ser equivalentes: duas portas, dois caches offline
 * com a mesma chave, e nenhuma garantia de que o mapa e a suplementação
 * enxergassem a mesma lista.
 *
 * Um agregado, um dono. O mapa e a suplementação reexportam daqui.
 *
 * Camada de adaptação de dados, e só isso: não importa React, não conhece
 * cache nem `localStorage`, não aceita `entityName`, devolve dados e nunca
 * objeto do provider.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { areaPastagemPort, filtrarEmMemoria } from './areaPastagemNativePort.js';

const RESOURCE = 'AreaPastagem';

const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

/**
 * A porta devolve `undefined` quando não há registro; a fronteira nunca.
 *
 * @param {unknown} registros
 * @returns {any[]}
 */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);

const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listAreas = async () =>
  comoLista(await runProviderCall(() => areaPastagemPort.list(), ctx('listAreas')));

/**
 * Recorte por igualdade sobre a lista carregada.
 *
 * O filtro é em memória de propósito — ver `areaPastagemNativePort.js`. Uma
 * segunda forma de rede para o mesmo agregado criaria um segundo cache offline
 * da mesma coisa, e os dois divergiriam na primeira invalidação parcial.
 */
export const filterAreas = async (criterio) => {
  const contexto = ctx('filterAreas');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const registros = comoLista(await runProviderCall(() => areaPastagemPort.list(), contexto));
  return filtrarEmMemoria(registros, criterio);
};

export const createArea = async (dados) => {
  const contexto = ctx('createArea');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => areaPastagemPort.create(dados), contexto);
};

export const updateArea = async (id, dados) => {
  const contexto = ctx('updateArea');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => areaPastagemPort.update(id, dados), { ...contexto, details: { id } });
};
