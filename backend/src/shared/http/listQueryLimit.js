/**
 * Contrato de `limit` em listagens GET tenant-scoped (hotfix pós-PR #103).
 *
 * O frontend envia `?limit=N` em ports de documentos JSON; o backend precisa
 * declarar o parâmetro (AJV `removeAdditional: false`) e aplicar `take` no SQL,
 * não buscar tudo e fatiar depois.
 */

/** Alinhado a `movimentacaoPecuariaNativePort` / `lotesApi` (até 5000). */
export const LIMITE_LISTAGEM_MAXIMO = 5000;

export const PROPRIEDADE_LIMIT_LISTAGEM = Object.freeze({
  type: 'integer',
  minimum: 1,
  maximum: LIMITE_LISTAGEM_MAXIMO,
});

/**
 * @param {Record<string, unknown>} [filtros]
 * @returns {{ take?: number }}
 */
export const opcoesTakeDeFiltros = (filtros = {}) => {
  const bruto = filtros.limit;
  const limite = typeof bruto === 'number' ? bruto : Number(bruto);
  if (!Number.isInteger(limite) || limite < 1) return {};
  return { take: Math.min(limite, LIMITE_LISTAGEM_MAXIMO) };
};

/**
 * Propriedades comuns de listagem por empresa + limit opcional.
 * @param {Record<string, Record<string, unknown>>} [extras]
 */
export const querystringListagemEmpresa = (extras = {}) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
    limit: PROPRIEDADE_LIMIT_LISTAGEM,
    ...extras,
  },
});
