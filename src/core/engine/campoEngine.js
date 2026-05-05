import { fieldRegistry } from "@/core/fieldRegistry";

export const normalizeFieldName = (fieldName = "") => {
  return String(fieldName)
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
};

export const getFieldKey = (campo) => normalizeFieldName(campo?.field_name || campo?.name || campo?.id);

export const getValor = (campo, registro = {}) => {
  const fieldName = getFieldKey(campo);
  if (!fieldName) return undefined;
  if ((campo?.origem || campo?.source) === "customizado") return registro.campos_personalizados?.[fieldName];
  if (Object.prototype.hasOwnProperty.call(registro, fieldName)) return registro[fieldName];
  return registro.campos_personalizados?.[fieldName];
};

export const setValor = (campo, registro = {}, valor) => {
  const fieldName = getFieldKey(campo);
  if (!fieldName) return registro;
  const registry = fieldRegistry[campo?.type] || fieldRegistry.text;
  const parsedValue = registry.parser(valor);
  const next = { ...registro };

  if ((campo?.origem || campo?.source) === "customizado") {
    next.campos_personalizados = {
      ...(next.campos_personalizados || {}),
      [fieldName]: parsedValue,
    };
    return next;
  }

  next[fieldName] = parsedValue;
  return next;
};

export const validar = (campo, valor) => {
  const registry = fieldRegistry[campo?.type] || fieldRegistry.text;
  return registry.validate(campo, valor);
};

export const formatar = (campo, valor) => {
  const registry = fieldRegistry[campo?.type] || fieldRegistry.text;
  return registry.formatter(valor);
};

export const calcular = (campo, registro = {}) => {
  const formula = campo?.rules?.formula || campo?.regras?.formula;
  if (!formula) return getValor(campo, registro);

  // Interpretador simples e seguro: permite apenas números, espaços, operadores e nomes de campos.
  const expression = String(formula).replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (token) => {
    const referencedCampo = { field_name: token, origem: Object.prototype.hasOwnProperty.call(registro, token) ? "fixo" : "customizado", type: "number" };
    const value = Number(getValor(referencedCampo, registro) || 0);
    return Number.isFinite(value) ? String(value) : "0";
  });

  if (!/^[0-9+\-*/().\s]+$/.test(expression)) return null;

  const values = [];
  const ops = [];
  const precedence = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const applyOp = () => {
    const op = ops.pop();
    const b = values.pop();
    const a = values.pop();
    if (op === "+") values.push(a + b);
    if (op === "-") values.push(a - b);
    if (op === "*") values.push(a * b);
    if (op === "/") values.push(b === 0 ? 0 : a / b);
  };

  const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/()]/g) || [];
  tokens.forEach((token) => {
    if (/^\d/.test(token)) values.push(Number(token));
    else if (token === "(") ops.push(token);
    else if (token === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") applyOp();
      ops.pop();
    } else {
      while (ops.length && precedence[ops[ops.length - 1]] >= precedence[token]) applyOp();
      ops.push(token);
    }
  });
  while (ops.length) applyOp();
  return values[0] ?? null;
};

export default { getValor, setValor, validar, formatar, calcular, normalizeFieldName, getFieldKey };