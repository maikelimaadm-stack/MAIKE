/**
 * Serviço de auditoria.
 *
 * O contrato é curto e cada linha dele tem consequência aqui:
 *
 *   ator vem da sessão, nunca do body/query/params/headers
 *   sem senha, credencial, segredo ou conteúdo binário no payload
 *   auditoria não altera o resultado funcional silenciosamente
 *   falha crítica de auditoria é observável
 *
 * A última é a mais fácil de errar. Um `catch {}` em volta da escrita de
 * auditoria transforma perda de rastro em silêncio — o pior dos dois mundos,
 * porque nem o log existe nem alguém sabe que ele não existe. Aqui a falha
 * vira `AUDIT_WRITE_FAILED` e sobe.
 */

import { auditWriteFailed } from '../../shared/errors/AppError.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { inserirAuditLog, listarAuditLogs } from './auditRepository.js';

/**
 * Chaves cujo valor nunca é persistido, em qualquer profundidade.
 * A comparação é sobre o nome normalizado do campo, não sobre o valor: tentar
 * reconhecer "isto parece uma senha" é heurística, e heurística falha calada.
 */
const CHAVES_PROIBIDAS = [
  'senha',
  'password',
  'passwd',
  'senha_hash',
  'hash',
  'credencial',
  'credential',
  'segredo',
  'secret',
  'token',
  'authorization',
  'cookie',
  'api_key',
  'apikey',
];

const MARCADOR = '[removido]';
const PROFUNDIDADE_MAXIMA = 8;

const ehChaveProibida = (chave) => {
  const normalizada = String(chave).toLowerCase().replace(/[\s-]/g, '_');
  return CHAVES_PROIBIDAS.some(
    (proibida) => normalizada === proibida || normalizada.endsWith(`_${proibida}`)
  );
};

/** Binário não entra no PostgreSQL nem no payload de auditoria. */
const ehConteudoBinario = (valor) =>
  valor instanceof Uint8Array ||
  valor instanceof ArrayBuffer ||
  (typeof Buffer !== 'undefined' && Buffer.isBuffer(valor));

/**
 * Remove segredo e binário de um payload, preservando a forma.
 *
 * Exportada porque é regra de contrato e precisa de teste próprio — não é
 * detalhe interno.
 *
 * @param {unknown} valor
 * @param {number} [profundidade]
 * @returns {unknown}
 */
export const sanitizarPayload = (valor, profundidade = 0) => {
  if (valor === null || valor === undefined) return valor ?? null;
  if (profundidade > PROFUNDIDADE_MAXIMA) return MARCADOR;
  if (ehConteudoBinario(valor)) return MARCADOR;

  if (Array.isArray(valor)) {
    return valor.map((item) => sanitizarPayload(item, profundidade + 1));
  }

  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') {
    /** @type {Record<string, unknown>} */
    const saida = {};
    for (const [chave, conteudo] of Object.entries(valor)) {
      saida[chave] = ehChaveProibida(chave)
        ? MARCADOR
        : sanitizarPayload(conteudo, profundidade + 1);
    }
    return saida;
  }

  return valor;
};

/**
 * Registra um evento de auditoria.
 *
 * O ator NÃO é parâmetro livre: ele vem de `contexto.auth`. Não existe forma de
 * passar `usuario_id` por fora — é por isso que a assinatura não aceita.
 *
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{acao: string, entidade: string, entidadeId?: string|null,
 *          dadosAnteriores?: unknown, dadosNovos?: unknown}} evento
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const registrarEvento = async (contexto, evento, tx) => {
  const auth = exigirAuthContext(contexto?.auth);

  const registro = {
    cliente_id: auth.clienteId,
    usuario_id: auth.usuarioId,
    acao: String(evento.acao),
    entidade: String(evento.entidade),
    entidade_id: evento.entidadeId ? String(evento.entidadeId) : null,
    dados_anteriores:
      evento.dadosAnteriores === undefined ? null : sanitizarPayload(evento.dadosAnteriores),
    dados_novos: evento.dadosNovos === undefined ? null : sanitizarPayload(evento.dadosNovos),
    request_id: contexto.requestId,
  };

  try {
    return await inserirAuditLog(registro, tx);
  } catch (erro) {
    // Observável, nunca silenciosa.
    throw auditWriteFailed('falha ao registrar auditoria', { cause: erro });
  }
};

/**
 * Evento de sistema — sem ator humano.
 *
 * `usuario_id` fica nulo, e o contrato admite isso **somente** aqui. O
 * `cliente_id` continua obrigatório: log sem tenant não é auditável.
 *
 * @param {{requestId: string}} contexto
 * @param {string} clienteId
 * @param {{acao: string, entidade: string, entidadeId?: string|null, dadosNovos?: unknown}} evento
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const registrarEventoDeSistema = async (contexto, clienteId, evento, tx) => {
  if (!clienteId) {
    throw auditWriteFailed('evento de sistema exige cliente_id');
  }

  const registro = {
    cliente_id: clienteId,
    usuario_id: null,
    acao: String(evento.acao),
    entidade: String(evento.entidade),
    entidade_id: evento.entidadeId ? String(evento.entidadeId) : null,
    dados_anteriores: null,
    dados_novos: evento.dadosNovos === undefined ? null : sanitizarPayload(evento.dadosNovos),
    request_id: contexto.requestId,
  };

  try {
    return await inserirAuditLog(registro, tx);
  } catch (erro) {
    throw auditWriteFailed('falha ao registrar auditoria de sistema', { cause: erro });
  }
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{entidade?: string, entidadeId?: string, limite?: number}} [filtro]
 */
export const listarEventos = async (contexto, filtro) => {
  const auth = exigirAuthContext(contexto?.auth);
  return listarAuditLogs(auth.clienteId, filtro);
};
