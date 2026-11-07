/**
 * Conclusão da troca obrigatória de senha no primeiro acesso
 * (MAIKE-SAAS-ADMIN-S04-P2, D-PROD-144).
 *
 * Contrato:
 *  - quem chama já verificou o token RESTRITO (`shared/auth/trocaSenhaInicial.js`);
 *    a identidade vem dele, nunca do corpo;
 *  - a conta é relida: ativa, troca pendente, cliente ativo e as mesmas épocas
 *    do S04-P1 que o token carrega. Senão 401, sem dizer o motivo;
 *  - a senha temporária é conferida no servidor (403 se errada). Errar não
 *    bloqueia a conta nem consome o token: a pessoa tenta de novo;
 *  - a escrita é UMA transação: `senha_hash` nova + `troca_senha_pendente =
 *    false` (CAS na linha lida) + época da conta +1 + auditoria. Qualquer falha
 *    desfaz tudo. Em corrida, só uma conclusão grava; a outra recebe 409;
 *  - não emite sessão. Depois da troca, o token restrito morre (época nova) e a
 *    pessoa entra de novo, pelo login normal, com a senha nova.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { AppError, tenantContextRequired } from '../../shared/errors/AppError.js';
import { filtroEpoca, revogarSessoesUsuario } from '../../shared/auth/sessaoEpoca.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { gerarSenhaHash, senhaConfereComHash } from './authService.js';

const etapaInvalida = () => tenantContextRequired('etapa de troca de senha expirada ou inválida');

/** Mesmo mínimo da troca de senha comum (`usuarioRoutes`, `nova_senha`). */
export const SENHA_MINIMA = 8;

/**
 * @param {{clienteId: string, usuarioId: string, epocas: {cliente: number, usuario: number}}} sessao
 */
const ondeContaPendente = ({ clienteId, usuarioId, epocas }) => ({
  id: usuarioId,
  cliente_id: clienteId,
  ativo: true,
  troca_senha_pendente: true,
  ...filtroEpoca(epocas.usuario),
  cliente: { ativo: true, ...filtroEpoca(epocas.cliente) },
});

/**
 * A conta do token restrito ainda pode concluir a troca? (usado pela rota a
 * cada requisição, antes de qualquer validação do corpo).
 *
 * @param {{clienteId: string, usuarioId: string, epocas: {cliente: number, usuario: number}}} sessao
 */
export const exigirContaComTrocaPendente = async (sessao) => {
  const conta = await getPrismaClient().usuario.findFirst({
    where: ondeContaPendente(sessao),
    select: { id: true, login: true, senha_hash: true },
  });
  if (!conta) throw etapaInvalida();
  return conta;
};

/**
 * @param {{clienteId: string, usuarioId: string, login: string, epocas: {cliente: number, usuario: number}}} sessao
 * @param {{senha_atual?: unknown, nova_senha?: unknown}} entrada
 * @param {{requestId: string}} ctx
 */
export const concluirTrocaSenhaInicial = async (sessao, entrada, ctx) => {
  const conta = await exigirContaComTrocaPendente(sessao);

  const atual = typeof entrada?.senha_atual === 'string' ? entrada.senha_atual : '';
  const nova = typeof entrada?.nova_senha === 'string' ? entrada.nova_senha : '';

  if (!(await senhaConfereComHash(atual, conta.senha_hash))) {
    throw new AppError('USUARIO_SENHA_ATUAL_INVALIDA', 'senha temporária incorreta');
  }
  if (nova.length < SENHA_MINIMA) {
    throw new AppError('REQUEST_VALIDATION_FAILED', `a nova senha precisa ter pelo menos ${SENHA_MINIMA} caracteres`, {
      details: { field: 'nova_senha' },
    });
  }
  if (nova === atual) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'a nova senha precisa ser diferente da senha temporária', {
      details: { field: 'nova_senha' },
    });
  }
  if (nova.trim().toLowerCase() === String(conta.login).toLowerCase()) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'a nova senha não pode ser igual ao usuário', {
      details: { field: 'nova_senha' },
    });
  }

  const novoHash = await gerarSenhaHash(nova);

  await getPrismaClient().$transaction(async (tx) => {
    // CAS: só grava se a linha ainda é a que foi lida (troca pendente, mesmo
    // hash, mesmas épocas). Em READ COMMITTED o Postgres espera o lock da linha
    // e reavalia o WHERE na versão nova: quem perde a corrida recebe count 0.
    const r = await tx.usuario.updateMany({
      where: { ...ondeContaPendente(sessao), senha_hash: conta.senha_hash },
      data: { senha_hash: novoHash, troca_senha_pendente: false },
    });
    if (r.count !== 1) {
      throw new AppError('CONCURRENCY_CONFLICT', 'a senha temporária já foi trocada; entre com a nova senha');
    }
    // S04-P1: época nova derruba o próprio token restrito e qualquer outro.
    await revogarSessoesUsuario(tx, sessao.clienteId, sessao.usuarioId);
    await registrarEvento(
      { auth: { clienteId: sessao.clienteId, usuarioId: sessao.usuarioId, login: sessao.login }, requestId: ctx.requestId },
      {
        acao: 'update',
        entidade: 'Usuario',
        entidadeId: sessao.usuarioId,
        dadosAnteriores: { troca_senha_pendente: true },
        dadosNovos: { troca_senha_pendente: false, sessoes_revogadas: true, origem: 'troca_senha_inicial' },
      },
      tx
    );
  });

  return { senha_alterada: true, novo_login_obrigatorio: true };
};
