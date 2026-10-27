/**
 * Diagnóstico sanitizado de falhas AJV/Fastify — sem vazar body, valor ou SQL.
 */

const RAZOES_PERMITIDAS = Object.freeze([
  'required',
  'type',
  'enum',
  'format',
  'range',
  'unknown_field',
  'invalid_query',
  'min_length',
  'max_length',
  'pattern',
  'other',
]);

/** @param {string} nome */
const campoPermitido = (nome) => /^[a-z][a-z0-9_]{0,63}$/.test(nome);

/**
 * @param {string} instancePath ex.: `/limit`, `/querystring/limit`
 * @returns {string|null}
 */
const campoDeInstancePath = (instancePath) => {
  if (typeof instancePath !== 'string' || !instancePath) return null;
  const partes = instancePath.split('/').filter(Boolean);
  const ultimo = partes[partes.length - 1];
  if (!ultimo || ultimo === 'querystring' || ultimo === 'body' || ultimo === 'params') return null;
  return campoPermitido(ultimo) ? ultimo : null;
};

/**
 * @param {{ keyword?: string; params?: Record<string, unknown> }} item
 * @returns {'required'|'type'|'enum'|'format'|'range'|'unknown_field'|'invalid_query'|'min_length'|'max_length'|'pattern'|'other'}
 */
const razaoDeItem = (item) => {
  const keyword = item?.keyword;
  const params = /** @type {Record<string, unknown>} */ (item?.params ?? {});
  if (keyword === 'additionalProperties' && typeof params.additionalProperty === 'string') {
    return 'unknown_field';
  }
  if (keyword === 'required') return 'required';
  if (keyword === 'enum') return 'enum';
  if (keyword === 'format') return 'format';
  if (keyword === 'minimum' || keyword === 'maximum' || keyword === 'exclusiveMinimum' || keyword === 'exclusiveMaximum') {
    return 'range';
  }
  if (keyword === 'minLength') return 'min_length';
  if (keyword === 'maxLength') return 'max_length';
  if (keyword === 'pattern') return 'pattern';
  if (keyword === 'type') return 'type';
  return 'other';
};

/**
 * @param {unknown} erroFastify
 * @returns {{ field: string, reason: string } | null}
 */
export const extrairDiagnosticoValidacao = (erroFastify) => {
  const lista = /** @type {Array<{ instancePath?: string; keyword?: string; params?: Record<string, unknown> }> | undefined} */ (
    /** @type {{ validation?: unknown }} */ (erroFastify)?.validation
  );
  if (!Array.isArray(lista) || lista.length === 0) return null;

  const item = /** @type {{ instancePath?: string; keyword?: string; params?: Record<string, unknown> }} */ (
    lista[0]
  );
  const params = /** @type {Record<string, unknown>} */ (item?.params ?? {});

  let field =
    typeof params.additionalProperty === 'string' && campoPermitido(params.additionalProperty)
      ? params.additionalProperty
      : campoDeInstancePath(item?.instancePath ?? '');

  if (!field && typeof params.missingProperty === 'string' && campoPermitido(params.missingProperty)) {
    field = params.missingProperty;
  }

  const reason = razaoDeItem(item);
  if (!RAZOES_PERMITIDAS.includes(reason)) return null;
  if (!field) {
    if (reason === 'unknown_field' || reason === 'invalid_query') {
      return { field: 'query', reason };
    }
    return null;
  }
  return { field, reason };
};
