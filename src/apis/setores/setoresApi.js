/**
 * API do módulo Setores (P1.3, D-PROD-18).
 *
 * O CRUD do cadastro vive aqui. A leitura que o mapa faz de setores continua em
 * `src/apis/mapa/` — são consumos distintos do mesmo agregado, e unificar
 * obrigaria o mapa a depender de um módulo de cadastro que ele não usa.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { setoresProvider, referenciasProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Setor';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {any} registros @returns {any[]} */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listSetores = async (ordenacao) =>
  comoLista(await runProviderCall(() => setoresProvider.list(ordenacao), ctx('listSetores')));

export const createSetor = async (dados) => {
  const contexto = ctx('createSetor');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => setoresProvider.create(dados), contexto);
};

export const updateSetor = async (id, dados) => {
  const contexto = ctx('updateSetor');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => setoresProvider.update(id, dados), contexto);
};

export const deleteSetor = async (id) => {
  const contexto = ctx('deleteSetor');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => setoresProvider.delete(id), contexto);
};

/** Capacidade explícita: o nome da function é literal no provider. */
export const sincronizarReferenciasSetor = async ({ registro, registroAnterior }) => {
  const contexto = ctx('sincronizarReferenciasSetor');
  assertArgument(isObjeto(registro), 'registro', contexto);
  return runProviderCall(
    () => referenciasProvider.sincronizar({
      event: { type: 'update', entity_name: 'Setor' },
      data: registro,
      old_data: registroAnterior,
      changed_fields: ['nome'],
    }),
    contexto
  );
};
