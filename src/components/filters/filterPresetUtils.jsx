export function fieldValueToFilterEntries(field, value = {}, operator = "contains") {
  if (!field || operator === "empty" || operator === "notEmpty") return {};

  if (field.type === "codeName" || field.type === "codeNameDynamic") {
    const prefix = field.type === "codeName" ? "lote" : field.id.replace("_codigo_nome", "");
    return {
      ...(value.codigo ? { [`${prefix}_codigo`]: value.codigo } : {}),
      ...(value.nome || value.value ? { [`${prefix}_nome`]: value.nome || value.value } : {})
    };
  }

  if (operator === "between") {
    return {
      ...(value.min ? { [`${field.id}_min`]: value.min } : {}),
      ...(value.max ? { [`${field.id}_max`]: value.max } : {})
    };
  }

  if (operator === "gte" || operator === "gt") return value.min ? { [`${field.id}_min`]: value.min } : {};
  if (operator === "lte" || operator === "lt") return value.max ? { [`${field.id}_max`]: value.max } : {};

  if (field.type === "number" || field.type === "date") {
    const exactValue = value.exact || value.value;
    return exactValue ? { [`${field.id}_exact`]: exactValue } : {};
  }

  return value.value || value.exact ? { [field.id]: value.value || value.exact } : {};
}

export function buildFiltersFromPreset(config, fields, currentFilters = {}) {
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const operators = config?.operators || {};
  const values = config?.fieldValues || {};
  const next = { esconderAoAtualizar: currentFilters.esconderAoAtualizar, _operators: operators };

  Object.entries(values).forEach(([fieldId, value]) => {
    Object.assign(next, fieldValueToFilterEntries(fieldMap.get(fieldId), value, operators[fieldId]));
  });

  return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && value !== ""));
}