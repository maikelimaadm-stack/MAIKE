/**
 * Sessão RESTRITA da troca obrigatória de senha (MAIKE-SAAS-ADMIN-S04-P2, D-PROD-144).
 *
 * Quem entra com a senha temporária gerada pelo MAIKE Admin (S03) não recebe a
 * sessão normal da fazenda. Recebe um token que serve para UMA coisa:
 * `POST /auth/troca-senha-inicial`. Três barreiras independentes impedem que ele
 * seja confundido com a sessão normal:
 *
 *  1. **Chave própria.** O token é assinado com uma chave derivada de
 *     `AUTH_SECRET` por HMAC com rótulo fixo. `app.autenticar` verifica com o
 *     segredo normal, então a assinatura dele não confere lá, e vice-versa.
 *  2. **Escopo explícito.** O payload carrega `escopo: "troca_senha_inicial"`;
 *     a guarda normal recusa qualquer token com `escopo`, e esta só aceita este.
 *  3. **Estado relido do banco.** A cada uso, a conta precisa estar ativa, com a
 *     troca ainda pendente, no mesmo cliente ativo e nas mesmas épocas do S04-P1.
 *     Concluir a troca incrementa a época da conta, e o token morre.
 *
 * Validade curta (`TTL_TROCA_SENHA_SEGUNDOS`): sem renovação; expirou, entra de
 * novo com a senha temporária.
 */

import { createHmac } from 'node:crypto';

import { env } from '../../config/env.js';
import { tenantContextRequired } from '../errors/AppError.js';
import { lerEpocasDaSessao } from './authContext.js';

export const ESCOPO_TROCA_SENHA_INICIAL = 'troca_senha_inicial';

/** 10 minutos: o bastante para escolher uma senha, curto para um token vazado. */
export const TTL_TROCA_SENHA_SEGUNDOS = 600;

const ROTULO_CHAVE = 'maike:s04-p2:troca-senha-inicial:v1';

/** Chave HS256 só deste escopo. Nunca sai do servidor. */
export const chaveTrocaSenhaInicial = () => {
  if (!env.authSecret) throw new Error('AUTH_SECRET ausente');
  return createHmac('sha256', env.authSecret).update(ROTULO_CHAVE).digest();
};

/**
 * @param {{clienteId: string, usuarioId: string, login: string, clienteSessaoEpoca: number, usuarioSessaoEpoca: number}} identidade
 */
export const montarPayloadTrocaSenha = ({ clienteId, usuarioId, login, clienteSessaoEpoca, usuarioSessaoEpoca }) => ({
  escopo: ESCOPO_TROCA_SENHA_INICIAL,
  cliente_id: clienteId,
  usuario_id: usuarioId,
  login,
  cliente_sessao_epoca: clienteSessaoEpoca,
  usuario_sessao_epoca: usuarioSessaoEpoca,
});

/**
 * Lê o payload já verificado do token restrito. Qualquer desvio = 401.
 *
 * @param {Record<string, unknown> | null | undefined} payload
 * @returns {{clienteId: string, usuarioId: string, login: string, epocas: {cliente: number, usuario: number}}}
 */
export const lerSessaoTrocaSenha = (payload) => {
  if (payload?.escopo !== ESCOPO_TROCA_SENHA_INICIAL) {
    throw tenantContextRequired('etapa de troca de senha inválida');
  }
  const clienteId = typeof payload.cliente_id === 'string' ? payload.cliente_id.trim() : '';
  const usuarioId = typeof payload.usuario_id === 'string' ? payload.usuario_id.trim() : '';
  const login = typeof payload.login === 'string' ? payload.login.trim() : '';
  if (!clienteId || !usuarioId) throw tenantContextRequired('etapa de troca de senha inválida');
  return { clienteId, usuarioId, login, epocas: lerEpocasDaSessao(payload) };
};

/**
 * Filtro Prisma "a troca obrigatória NÃO está pendente" (NULL conta como
 * concluída: contas anteriores ao S04-P2). Usado pela guarda normal.
 */
export const filtroSemTrocaPendente = () => ({ OR: [{ troca_senha_pendente: null }, { troca_senha_pendente: false }] });
