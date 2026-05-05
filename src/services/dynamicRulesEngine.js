function compare(value, operator, expected) {
  if (operator === "equals") return value === expected;
  if (operator === "not_equals") return value !== expected;
  if (operator === "gt") return Number(value) > Number(expected);
  if (operator === "gte") return Number(value) >= Number(expected);
  if (operator === "lt") return Number(value) < Number(expected);
  if (operator === "lte") return Number(value) <= Number(expected);
  if (operator === "contains") return String(value || "").includes(String(expected || ""));
  if (operator === "is_empty") return value === undefined || value === null || value === "";
  if (operator === "is_not_empty") return value !== undefined && value !== null && value !== "";
  return true;
}

export function evaluateCondition(condition, formData) {
  if (!condition?.field) return true;
  return compare(formData[condition.field], condition.operator || "equals", condition.value);
}

export function evaluateRuleGroup(ruleGroup, formData) {
  if (!ruleGroup?.conditions?.length) return true;
  const results = ruleGroup.conditions.map((condition) => evaluateCondition(condition, formData));
  return ruleGroup.logic === "or" ? results.some(Boolean) : results.every(Boolean);
}

export function applyFieldRules(field, formData) {
  const rules = field.rules || {};
  const hidden = rules.visibility ? !evaluateRuleGroup(rules.visibility, formData) : false;
  const required = rules.required ? evaluateRuleGroup(rules.required, formData) : field.required;

  return {
    ...field,
    hidden,
    required,
  };
}

export function applyFormRules(config, formData) {
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => applyFieldRules(field, formData)).filter((field) => !field.hidden),
    })),
  };
}