/**
 * Porta nativa de Usuario — administração de contas (P6.0, D-PROD-34).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'Usuario';
const CAMINHO = '/usuarios';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const CAMPOS_CRIACAO = Object.freeze(['nome', 'login', 'senha']);
const CAMPOS_ATUALIZACAO = Object.freeze(['nome', 'ativo', 'nova_senha']);

const corpoDe = (dados, campos) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(dados, campo)) saida[campo] = dados[campo];
  }
  return saida;
};

export const listUsuariosNativos = async () => {
  const resposta = await nativeRequest(CAMINHO, { method: 'GET' }, ctx('listUsuarios'));
  return Array.isArray(resposta) ? resposta : [];
};

export const createUsuarioNativo = async (dados) => {
  const corpo = corpoDe(dados, CAMPOS_CRIACAO);
  return nativeRequest(CAMINHO, { method: 'POST', body: corpo }, ctx('createUsuario'));
};

export const updateUsuarioNativo = async (id, dados) => {
  const corpo = corpoDe(dados, CAMPOS_ATUALIZACAO);
  return nativeRequest(`${CAMINHO}/${id}`, { method: 'PATCH', body: corpo }, ctx('updateUsuario'));
};

/** Compatibilidade com telas que ainda usam `email` (Permissao Base44). */
export const comoUsuarioLegado = (usuario) => ({
  id: usuario.id,
  email: usuario.login,
  login: usuario.login,
  nome: usuario.nome,
  full_name: usuario.nome,
  ativo: usuario.ativo !== false,
});
