/** API de administração de usuários nativos (P6.0). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';
import {
  listUsuariosNativos,
  listUsuariosPaginaNativo,
  createUsuarioNativo,
  updateUsuarioNativo,
  comoUsuarioLegado,
} from './usuarioNativePort.js';

const RESOURCE = 'Usuarios';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listUsuarios = async () => {
  const lista = await runProviderCall(() => listUsuariosNativos(), ctx('listUsuarios'));
  return (Array.isArray(lista) ? lista : []).map(comoUsuarioLegado);
};

/** Página keyset do motor Base1 (SCALE-01); itens no formato legado da tela. */
export const listUsuariosPage = async (filtros = {}) => {
  const bruto = await runProviderCall(() => listUsuariosPaginaNativo(filtros), ctx('listUsuariosPage'));
  const pagina = normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
  return { ...pagina, items: pagina.items.map(comoUsuarioLegado) };
};

export const createUsuario = async (dados) => {
  const contexto = ctx('createUsuario');
  assertArgument(isObjeto(dados), 'dados', contexto);
  const criado = await runProviderCall(() => createUsuarioNativo(dados), contexto);
  return comoUsuarioLegado(criado);
};

export const updateUsuario = async (id, dados) => {
  const contexto = ctx('updateUsuario');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  const atualizado = await runProviderCall(() => updateUsuarioNativo(id, dados), {
    ...contexto,
    details: { id },
  });
  return comoUsuarioLegado(atualizado);
};
