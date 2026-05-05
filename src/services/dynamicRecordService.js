export const CUSTOM_VALUES_FIELD = "campos_personalizados";

export function getRecordValue(record, field) {
  if (field.source === "customizado") return record?.[CUSTOM_VALUES_FIELD]?.[field.accessor || field.name] ?? "";
  return record?.[field.accessor || field.name] ?? "";
}

export function setRecordValue(record, field, value) {
  if (field.source !== "customizado") return { ...record, [field.name]: value };

  return {
    ...record,
    [CUSTOM_VALUES_FIELD]: {
      ...(record[CUSTOM_VALUES_FIELD] || {}),
      [field.name]: value,
    },
  };
}

export function mergeDynamicValues(payload, dynamicValues = {}) {
  return {
    ...payload,
    [CUSTOM_VALUES_FIELD]: {
      ...(payload[CUSTOM_VALUES_FIELD] || {}),
      ...dynamicValues,
    },
  };
}