/**
 * API do módulo Rebanho — histórico sanitário lido pelo cache do mapa (P1.2).
 *
 * Escopo estreito de propósito: só as três listas que o cache offline do mapa
 * consome hoje. O restante do domínio de rebanho entra quando tiver consumidor
 * migrado (SCL-P11-02).
 */

import { runProviderCall } from '../_core/normalizeApiError.js';
import { rebanhoProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Rebanho';
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const APLICACAO_DEFAULT_ORDER = '-data_aplicacao';
export const EVENTO_DEFAULT_ORDER = '-data_evento';
export const REBANHO_DEFAULT_LIMIT = 500;

export const listAplicacoesMedicamento = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () =>
        rebanhoProvider.listAplicacoesMedicamento(
          opcoes.order ?? APLICACAO_DEFAULT_ORDER,
          opcoes.limit ?? REBANHO_DEFAULT_LIMIT
        ),
      ctx('listAplicacoesMedicamento')
    )
  );

export const listEventosSanitarios = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () =>
        rebanhoProvider.listEventosSanitarios(
          opcoes.order ?? EVENTO_DEFAULT_ORDER,
          opcoes.limit ?? REBANHO_DEFAULT_LIMIT
        ),
      ctx('listEventosSanitarios')
    )
  );

export const listManejosTecnicos = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () =>
        rebanhoProvider.listManejosTecnicos(
          opcoes.order ?? EVENTO_DEFAULT_ORDER,
          opcoes.limit ?? REBANHO_DEFAULT_LIMIT
        ),
      ctx('listManejosTecnicos')
    )
  );
