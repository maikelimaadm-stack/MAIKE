/**
 * Administração de contas nativas (P6.0, D-PROD-34).
 *
 * Regras de produto que não cabem na porta HTTP: bloqueio de auto-desativação
 * na UI usa login/email; o backend recusa com USUARIO_SELF_DEACTIVATE.
 */

import { listUsuarios, createUsuario, updateUsuario } from '@/apis/usuarios';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

export const listarContasAcesso = () => listUsuarios();

export const criarContaAcesso = (dados) => createUsuario(dados);

export const atualizarContaAcesso = (id, dados) => updateUsuario(id, dados);

/**
 * @param {{ email?: string, login?: string } | null | undefined} usuarioAtual
 * @param {{ login?: string, email?: string, ativo?: boolean }} conta
 * @param {Record<string, unknown>} patch
 */
export const validarPatchContaAcesso = (usuarioAtual, conta, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'ativo') && patch.ativo === false) {
    const loginAtual = (usuarioAtual?.login || usuarioAtual?.email || '').trim();
    const loginConta = (conta?.login || conta?.email || '').trim();
    if (loginAtual && loginConta && loginAtual === loginConta) {
      throw new ApiError(API_ERROR_CODES.USUARIO_SELF_DEACTIVATE);
    }
  }
};
