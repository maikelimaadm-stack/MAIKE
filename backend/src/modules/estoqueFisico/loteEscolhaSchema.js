/**
 * D-PROD-281 — esquema HTTP da escolha de lotes numa linha de saída de produto que controla lote:
 * `lotes: [{ estoque_lote_nota_id, quantidade }]`, opcional (sem a lista, o servidor aplica o FEFO). A quantidade é
 * TEXTO decimal, na unidade de ESTOQUE do produto (kg ou L), e a soma tem de ser a quantidade de estoque da linha
 * (o motor confere). Formato fechado (`additionalProperties: false`), como as linhas que o usam.
 */
export const LOTES_ESCOLHIDOS = Object.freeze({
  type: ['array', 'null'],
  minItems: 1,
  maxItems: 50,
  items: {
    type: 'object',
    required: ['estoque_lote_nota_id', 'quantidade'],
    additionalProperties: false,
    properties: {
      estoque_lote_nota_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' },
      quantidade: { type: 'string', pattern: '^\\d{1,10}(\\.\\d{1,4})?$' },
    },
  },
});

/** Lote do fabricante e validade de uma linha de ENTRADA (obrigatórios conforme o produto; o motor decide). */
export const LOTE_FABRICANTE = Object.freeze({ type: ['string', 'null'], maxLength: 64 });
export const DATA_VALIDADE = Object.freeze({ type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
