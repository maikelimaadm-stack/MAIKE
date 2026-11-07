/**
 * D-PROD-145 — peças comuns dos cadastros de Gestão P1 (Parceiros, Centros de
 * Custo e Centros de Resultado). Pequenas e explícitas; não é um runtime genérico.
 */

import { AppError } from '../../shared/errors/AppError.js';

/** Caractere de controle (inclui NUL, que o PostgreSQL recusa) ou marcação HTML. */
const CONTROLE = /[\u0000-\u001F\u007F]/;
const HTML = /[<>]/;
const SURROGATE_ISOLADO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });

/**
 * Texto do corpo, higienizado: aparado; vazio → null (quando opcional);
 * caractere de controle, marcação HTML ou texto mal formado → 400.
 * @param {unknown} valor
 * @param {string} campo
 * @param {{ obrigatorio?: boolean, maiusculas?: boolean }} [opcoes]
 * @returns {string|null|undefined} undefined = campo ausente
 */
export const textoDoCorpo = (valor, campo, opcoes = {}) => {
  if (valor === undefined) return undefined;
  if (valor === null) {
    if (opcoes.obrigatorio) throw invalido(`${campo} é obrigatório`, { field: campo });
    return null;
  }
  if (typeof valor !== 'string') throw invalido(`${campo} deve ser texto`, { field: campo });
  if (CONTROLE.test(valor) || SURROGATE_ISOLADO.test(valor) || HTML.test(valor)) {
    throw invalido(`${campo} tem caractere inválido`, { field: campo, reason: 'caractere_invalido' });
  }
  const limpo = valor.trim();
  if (!limpo) {
    if (opcoes.obrigatorio) throw invalido(`${campo} é obrigatório`, { field: campo });
    return null;
  }
  return opcoes.maiusculas ? limpo.toUpperCase() : limpo;
};

/**
 * A empresa informada existe NESTE tenant. O `cliente_id` vem só da sessão; o
 * fallback do navegador (clienteId no lugar da empresa) não é empresa e cai aqui.
 * Mesma resposta para empresa de outro tenant e inexistente.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {unknown} empresaId
 */
export const exigirEmpresaDoTenant = async (tx, clienteId, empresaId) => {
  if (typeof empresaId !== 'string' || !empresaId.trim()) throw invalido('empresa_id é obrigatório', { field: 'empresa_id' });
  const empresa = await tx.empresa.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id: empresaId } },
    select: { id: true },
  });
  if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada neste tenant', { details: { field: 'empresa_id' } });
  return empresa.id;
};

/**
 * Serializa escritas de um escopo (tenant + empresa + assunto) até o fim da
 * transação: evita ciclo por dois movimentos simultâneos na mesma árvore e
 * duplicata de documento em corrida. Chave nunca contém PII em claro no log
 * (o PostgreSQL só guarda o hash).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} chave
 */
export const travarEscopo = async (tx, chave) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))`;
};

/** @param {unknown} d */
export const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

/** Unique do banco (corrida perdida) → conflito estável, nunca 500. */
export const ehViolacaoDeUnique = (erro) => erro?.code === 'P2002';
