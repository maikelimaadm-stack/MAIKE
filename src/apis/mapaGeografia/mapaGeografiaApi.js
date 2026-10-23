/**
 * API da geografia do mapa (P4.3, D-PROD-32).
 *
 * Dono único de ConfiguracaoIcone, PontoReferencia e LinhaGeografica no
 * frontend. `@/apis/mapa` reexporta daqui.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import {
  configuracaoIconePort,
  pontoReferenciaPort,
  linhaGeograficaPort,
} from './mapaGeografiaNativePort.js';

const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

/** @param {unknown} registros @returns {any[]} */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);

const ctx = (operation, resource) => ({ operation, resource });

export const listIcones = async () =>
  comoLista(
    await runProviderCall(() => configuracaoIconePort.list(), ctx('listIcones', 'ConfiguracaoIcone'))
  );

export const createIcone = async (dados) => {
  const contexto = ctx('createIcone', 'ConfiguracaoIcone');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => configuracaoIconePort.create(dados), contexto);
};

export const updateIcone = async (id, dados) => {
  const contexto = ctx('updateIcone', 'ConfiguracaoIcone');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => configuracaoIconePort.update(id, dados), {
    ...contexto,
    details: { id },
  });
};

export const listPontos = async () =>
  comoLista(
    await runProviderCall(() => pontoReferenciaPort.list(), ctx('listPontos', 'PontoReferencia'))
  );

export const createPonto = async (dados) => {
  const contexto = ctx('createPonto', 'PontoReferencia');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => pontoReferenciaPort.create(dados), contexto);
};

export const updatePonto = async (id, dados) => {
  const contexto = ctx('updatePonto', 'PontoReferencia');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => pontoReferenciaPort.update(id, dados), { ...contexto, details: { id } });
};

export const deletePonto = async (id) => {
  const contexto = ctx('deletePonto', 'PontoReferencia');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => pontoReferenciaPort.delete(id), { ...contexto, details: { id } });
};

export const listLinhas = async () =>
  comoLista(
    await runProviderCall(() => linhaGeograficaPort.list(), ctx('listLinhas', 'LinhaGeografica'))
  );

export const createLinha = async (dados) => {
  const contexto = ctx('createLinha', 'LinhaGeografica');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => linhaGeograficaPort.create(dados), contexto);
};

export const updateLinha = async (id, dados) => {
  const contexto = ctx('updateLinha', 'LinhaGeografica');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => linhaGeograficaPort.update(id, dados), { ...contexto, details: { id } });
};
