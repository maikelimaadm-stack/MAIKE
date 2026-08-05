/**
 * Guarda de exclusão compartilhada (P1.3).
 *
 * A P1.2 extraiu a tabela de regras para `@/domain/deleteRules` — pura e
 * provider-agnostic. O que faltava era o outro lado: **carregar** os registros
 * dependentes. Cada service estava prestes a repetir o mesmo laço, e o legado
 * resolvia isso passando o SDK inteiro (`ensureDeleteAllowed(base44, ...)`),
 * que é justamente o que a fronteira existe para impedir.
 *
 * Aqui o chamador declara um mapa de carregadores **explícitos** por entidade.
 * Dependência declarada na tabela sem carregador correspondente é erro de
 * programação e falha — não vira liberação silenciosa, que seria o pior
 * resultado possível numa guarda de exclusão.
 */

import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { evaluateDeleteBlock, dependenciesOf } from '@/domain/deleteRules';

/**
 * Executa a guarda e lança quando houver vínculo.
 *
 * @param {object} p
 * @param {string} p.entityName entidade sendo excluída
 * @param {string} p.id
 * @param {object|null} p.currentRecord registro alvo, quando já carregado
 * @param {Record<string, () => Promise<any[]>>} p.carregadores por entidade dependente
 * @param {string} p.blockedCode código de {@link API_ERROR_CODES} para o bloqueio
 * @param {string} p.operation nome da operação, para o contexto do erro
 * @returns {Promise<void>}
 */
export const assertExclusaoPermitida = async ({
  entityName,
  id,
  currentRecord = null,
  carregadores,
  blockedCode,
  operation,
}) => {
  const contexto = { operation, resource: entityName };
  const dependencias = dependenciesOf(entityName);
  if (!dependencias.length) return;

  const entidades = [...new Set(dependencias.map((dependencia) => dependencia.entity))];

  const carregadas = await Promise.all(
    entidades.map(async (entidade) => {
      const carregador = carregadores?.[entidade];
      if (typeof carregador !== 'function') {
        throw new ApiError(API_ERROR_CODES.OPERATION_FAILED, {
          ...contexto,
          details: { dependenciaSemCarregador: entidade },
        });
      }
      return [entidade, await carregador()];
    })
  );

  const veredito = evaluateDeleteBlock({
    entityName,
    id,
    currentRecord,
    recordsByEntity: Object.fromEntries(carregadas),
  });

  if (veredito.blocked) {
    // `label` e `linkedCount` são contexto seguro: rótulo do produto e contagem.
    // A mensagem crua do provider nunca chega aqui.
    throw new ApiError(blockedCode, {
      ...contexto,
      details: { recurso: entityName, vinculo: veredito.label ?? null, quantidade: veredito.linkedCount ?? null },
    });
  }
};
