const emptyToNull = (value) => value === "" || value === undefined ? null : value;

export const fieldRegistry = {
  text: {
    parser: (value) => String(value ?? ""),
    formatter: (value) => value == null || value === "" ? "" : String(value),
    validate: (campo, value) => campo.required && !String(value ?? "").trim() ? "Campo obrigatório" : null,
  },
  textarea: {
    parser: (value) => String(value ?? ""),
    formatter: (value) => value == null || value === "" ? "" : String(value),
    validate: (campo, value) => campo.required && !String(value ?? "").trim() ? "Campo obrigatório" : null,
  },
  number: {
    parser: (value) => {
      const normalized = emptyToNull(value);
      if (normalized === null) return null;
      const numberValue = Number(String(normalized).replace(",", "."));
      return Number.isFinite(numberValue) ? numberValue : null;
    },
    formatter: (value) => value == null || value === "" ? "" : String(value),
    validate: (campo, value) => {
      if (campo.required && (value === null || value === undefined || value === "")) return "Campo obrigatório";
      if (value !== null && value !== undefined && value !== "" && !Number.isFinite(Number(value))) return "Valor numérico inválido";
      return null;
    },
  },
  date: {
    parser: (value) => emptyToNull(value),
    formatter: (value) => value ? String(value).split("T")[0] : "",
    validate: (campo, value) => campo.required && !value ? "Campo obrigatório" : null,
  },
  select: {
    parser: (value) => emptyToNull(value),
    formatter: (value) => value == null || value === "" ? "" : String(value),
    validate: (campo, value) => campo.required && !value ? "Campo obrigatório" : null,
  },
  boolean: {
    parser: (value) => Boolean(value),
    formatter: (value) => value ? "Sim" : "Não",
    validate: () => null,
  },
  calculado: {
    parser: (value) => value,
    formatter: (value) => value == null || value === "" ? "" : String(value),
    validate: () => null,
    readOnly: true,
  },
};