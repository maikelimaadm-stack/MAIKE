/**
 * Serviço de numeração.
 *
 * Regras do contrato materializadas aqui:
 *
 *   estratégia          sequência atômica no banco, em transação
 *   proibido            MAX + 1 e COUNT(*) + 1
 *   reuso após exclusão não
 *   escopos             `tenant` e `empresa`
 *   escopo por entidade decidido por capacidade em P4–P6, NÃO aqui
 *
 * ### Por que `escopo_id` nunca é nulo
 *
 * A chave única é `[cliente_id, entidade, escopo_tipo, escopo_id]`. No
 * PostgreSQL, `NULL` nunca é igual a `NULL` num índice unique — com
 * `escopo_id` nulo no escopo `tenant`, duas linhas de sequência para a mesma
 * entidade coexistiriam e distribuiriam números **em paralelo**. O unique não
 * barraria nada, e o sintoma só apareceria sob concorrência, que é justamente
 * quando a numeração precisa funcionar.
 *
 * A P3 escolhe a sentinela não nula: no escopo `tenant`, `escopo_id` recebe o
 * próprio `cliente_id`. Assim a unicidade inteira fica expressável no schema
 * Prisma, sem índice parcial em SQL solto como fonte paralela de verdade.
 */

import { sequenceConflict, sequenceScopeInvalid } from '../../shared/errors/AppError.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { getPrismaClient } from '../../database/prismaClient.js';
import { garantirLinhaDaSequencia, reservarProximoValor } from './entidadeCodigoRepository.js';

/** Escopos suportados pela fundação. Vem de `numbering.scopeTypes`. */
export const ESCOPO_TENANT = 'tenant';
export const ESCOPO_EMPRESA = 'empresa';
export const ESCOPOS_SUPORTADOS = Object.freeze([ESCOPO_TENANT, ESCOPO_EMPRESA]);

/**
 * Resolve a sentinela de `escopo_id`.
 *
 * `tenant`  → o próprio `cliente_id`
 * `empresa` → o id da empresa, que a capacidade precisa fornecer
 *
 * @param {{clienteId: string, escopoTipo: string, escopoId?: string|null}} entrada
 * @returns {string}
 */
export const resolverEscopoId = ({ clienteId, escopoTipo, escopoId }) => {
  if (!ESCOPOS_SUPORTADOS.includes(escopoTipo)) {
    throw sequenceScopeInvalid(`escopo_tipo não suportado: ${escopoTipo}`, {
      suportados: ESCOPOS_SUPORTADOS,
    });
  }

  if (escopoTipo === ESCOPO_TENANT) {
    // A capacidade não escolhe o escopo_id do tenant — ele é derivado.
    return clienteId;
  }

  const informado = typeof escopoId === 'string' ? escopoId.trim() : '';
  if (!informado) {
    throw sequenceScopeInvalid('escopo "empresa" exige escopo_id não vazio');
  }
  return informado;
};

/**
 * Reserva o próximo número dentro de uma transação já aberta.
 *
 * Recebe `tx` de propósito: a numeração precisa participar da MESMA transação
 * da escrita que a consome. Reservar num commit e gravar noutro deixa buraco na
 * sequência quando a segunda falha.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{clienteId: string, entidade: string, escopoTipo?: string, escopoId?: string|null}} pedido
 * @returns {Promise<number>}
 */
export const reservarNumero = async (tx, pedido) => {
  const escopoTipo = pedido.escopoTipo || ESCOPO_TENANT;
  const entidade = String(pedido.entidade || '').trim();

  if (!entidade) {
    throw sequenceScopeInvalid('entidade da sequência é obrigatória');
  }

  const chave = {
    clienteId: pedido.clienteId,
    entidade,
    escopoTipo,
    escopoId: resolverEscopoId({
      clienteId: pedido.clienteId,
      escopoTipo,
      escopoId: pedido.escopoId,
    }),
  };

  await garantirLinhaDaSequencia(tx, chave);
  const atribuido = await reservarProximoValor(tx, chave);

  if (atribuido === null) {
    throw sequenceConflict('não foi possível reservar o número da sequência');
  }

  return atribuido;
};

/**
 * Reserva num transação própria. Usado quando não há operação composta em volta.
 *
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{entidade: string, escopoTipo?: string, escopoId?: string|null}} pedido
 */
export const reservarNumeroIsolado = async (contexto, pedido) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  return prisma.$transaction((tx) =>
    reservarNumero(tx, { ...pedido, clienteId: auth.clienteId })
  );
};
