/**
 * Administração de contas nativas (P6.0, D-PROD-34).
 *
 * Regras de produto que não cabem na porta HTTP: bloqueio de auto-desativação
 * na UI usa login/email; o backend recusa com USUARIO_SELF_DEACTIVATE.
 */

import { listUsuarios, listUsuariosPage, createUsuario, updateUsuario } from '@/apis/usuarios';
import { ApiError, API_ERROR_CODES, isApiError } from '@/apis/_core/ApiError';

/**
 * S04-P1-R1: campos de conta que a TELA pode guardar (ficha, cache, export).
 * Allowlist explícita — credencial nunca entra (`senha`, `senha_atual`,
 * `nova_senha`, `senha_hash` e afins), nem vinda do formulário nem do servidor.
 */
export const CAMPOS_PUBLICOS_CONTA = Object.freeze([
  'id',
  'nome',
  'full_name',
  'login',
  'email',
  'ativo',
  'papel_tenant',
  'administrador_fazenda',
  'created_date',
  'updated_date',
  'createdAt',
  'updatedAt',
]);

/** Copia só os campos públicos de uma conta. */
export const contaPublica = (conta) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  if (!conta || typeof conta !== 'object') return saida;
  for (const campo of CAMPOS_PUBLICOS_CONTA) {
    if (Object.prototype.hasOwnProperty.call(conta, campo)) saida[campo] = conta[campo];
  }
  return saida;
};

/**
 * Ficha depois de um PATCH bem-sucedido: base atual + campos públicos que o
 * formulário mudou + resposta do servidor — tudo pela allowlist.
 */
export const contaPublicaAposAtualizar = (base, id, dados, resposta) => ({
  ...contaPublica(base),
  ...contaPublica(dados),
  ...contaPublica(resposta),
  id,
});

/**
 * É a troca da PRÓPRIA senha? Decide pelo ID autenticado do AuthContext
 * (`user.id`, vindo de `/auth/contexto`), nunca pelo login digitado nem pelo
 * `currentUser` assíncrono. Sem ID autenticado, não infere nada (false).
 */
export const ehContaPropria = (usuarioAutenticadoId, contaId) =>
  typeof usuarioAutenticadoId === 'string' && usuarioAutenticadoId !== '' && usuarioAutenticadoId === contaId;

export const ehTrocaDaPropriaSenha = (usuarioAutenticadoId, contaId, dados) =>
  ehContaPropria(usuarioAutenticadoId, contaId) && Boolean(dados) && Object.prototype.hasOwnProperty.call(dados, 'nova_senha');

/** Campos de credencial que podem estar num payload de conta. */
const CAMPOS_CREDENCIAL = Object.freeze(['senha', 'senha_atual', 'nova_senha', 'senha_hash', 'password']);

/**
 * Apaga as credenciais de um payload JÁ usado (as `variables` que o React
 * Query guarda no MutationCache). Muta no lugar, de propósito: é o mesmo
 * objeto que ficaria retido. Não promete apagar a memória física do JS.
 */
export const descartarCredenciais = (dados) => {
  if (!dados || typeof dados !== 'object') return;
  for (const campo of CAMPOS_CREDENCIAL) {
    if (Object.prototype.hasOwnProperty.call(dados, campo)) delete dados[campo];
  }
};

/**
 * Falha cujo resultado no servidor é desconhecido — não prova que a senha NÃO
 * mudou. Usado SÓ na troca da própria senha (tela Usuários); não altera a
 * semântica global de `retryable` nem a de outras operações.
 *  - rede, tempo esgotado, 502/503/504 → `PROVIDER_UNAVAILABLE` (retryable);
 *  - HTTP 500 (`INTERNAL_ERROR`) e código desconhecido → `OPERATION_FAILED`
 *    (S04-P1-R2): o servidor pode ter falhado DEPOIS de gravar;
 *  - erro que não é `ApiError`.
 * Rejeições contratuais (`INVALID_ARGUMENT`, `USUARIO_SENHA_ATUAL_INVALIDA`,
 * `CONCURRENCY_CONFLICT`, ...) continuam sendo rejeição: nada foi gravado.
 */
export const resultadoIncerto = (erro) =>
  !isApiError(erro) || erro.retryable === true || erro.code === API_ERROR_CODES.OPERATION_FAILED;

export const listarContasAcesso = () => listUsuarios();

/**
 * Página keyset de contas (SCALE-01). Busca `q` e filtro `ativo` são do servidor.
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean }} [opts]
 */
export const listarContasAcessoPagina = (opts = {}) =>
  listUsuariosPage({
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    ativo: opts.ativo,
  });

export const criarContaAcesso = (dados) => createUsuario(dados);

export const atualizarContaAcesso = (id, dados) => updateUsuario(id, dados);

/**
 * @param {{ id?: string, email?: string, login?: string } | null | undefined} usuarioAtual
 * @param {{ id?: string, login?: string, email?: string, ativo?: boolean }} conta
 * @param {Record<string, unknown>} patch
 */
export const validarPatchContaAcesso = (usuarioAtual, conta, patch) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'ativo') && patch.ativo === false) {
    // S04-P1-R1: com ID autenticado, a identidade é o ID; login só como reserva.
    if (usuarioAtual?.id && conta?.id) {
      if (usuarioAtual.id === conta.id) throw new ApiError(API_ERROR_CODES.USUARIO_SELF_DEACTIVATE);
      return;
    }
    const loginAtual = (usuarioAtual?.login || usuarioAtual?.email || '').trim();
    const loginConta = (conta?.login || conta?.email || '').trim();
    if (loginAtual && loginConta && loginAtual === loginConta) {
      throw new ApiError(API_ERROR_CODES.USUARIO_SELF_DEACTIVATE);
    }
  }
};
