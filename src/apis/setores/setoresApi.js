/**
 * API do módulo Setores (P1.3 · nativo desde a P4.1, D-PROD-25).
 *
 * A leitura, a criação e a atualização passaram a falar com o backend próprio,
 * por `setorNativePort`. A Base44 deixou de participar do dado de Setor.
 *
 * O que **continua** na Base44, e por quê:
 *
 *   `sincronizarReferenciasSetor` propaga o nome do setor para os campos
 *   denormalizados de `AreaPastagem`, `LancamentoTarefa`, `MovimentacaoMapa` e
 *   `MovimentacaoPecuaria`. As quatro ainda são entidades da Base44. Migrar a
 *   function junto exigiria migrar os quatro destinos na mesma PR — e é
 *   exatamente isso que a P4.2 vai fazer, uma capacidade por vez. Enquanto os
 *   destinos vivem lá, a propagação vive lá: alternativa seria parar de
 *   propagar, e aí renomear um setor deixaria o nome antigo em toda a
 *   geografia, calado.
 *
 * O que **deixou de existir**: `deleteSetor`. Não há rota de exclusão no
 * backend nativo, e a guarda de vínculo depende de quatro entidades que ainda
 * não são nativas. A recusa é decidida no service, com código próprio, sem
 * requisição — ver `src/services/setorService.js`.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { referenciasProvider } from '../_providers/base44Provider.js';
import { setorPort } from './setorNativePort.js';

const RESOURCE = 'Setor';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {any} registros @returns {any[]} */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listSetores = async () =>
  comoLista(await runProviderCall(() => setorPort.list(), ctx('listSetores')));

export const createSetor = async (dados) => {
  const contexto = ctx('createSetor');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => setorPort.create(dados), contexto);
};

export const updateSetor = async (id, dados) => {
  const contexto = ctx('updateSetor');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => setorPort.update(id, dados), contexto);
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
