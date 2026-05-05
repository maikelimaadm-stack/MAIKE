import { z } from "zod";

const FIXED_LOTE_FIELDS = {
  codigo: "numero_lote",
  nome: "nome",
  identificador: "identificador_nome",
  sigla: "identificador_sigla",
  cor: "identificador_cor",
  cabecas: "quantidade_entrada",
  categoria: "categoria_entrada",
  categoria_manejo: "categoria_manejo_entrada_nome",
  sexo: "sexo",
  peso: "peso_entrada_kg",
  setor: "setor_nome",
  area: "area_entrada_nome",
  sistema_produtivo: "sistema_produtivo",
  motivo: "motivo_entrada",
  data: "data_entrada",
  status: "status",
  valor: "valor_total_compra",
  fornecedor: "fornecedor_nome",
  observacoes: "observacoes"
};

const getRawValue = (registro, campo) => {
  if (!registro || !campo) return "";
  if (campo.customField || campo.origem === "customizado" || String(campo.id || "").startsWith("custom:")) {
    const key = campo.customField || campo.field_name || String(campo.id).replace("custom:", "");
    return registro.campos_personalizados?.[key] ?? "";
  }

  const fieldName = campo.field_name || FIXED_LOTE_FIELDS[campo.id] || campo.id;
  if (campo.id === "cabecas") return registro.quantidade_entrada ?? registro.quantidade_cabecas ?? "";
  if (campo.id === "categoria") return registro.categoria_entrada || registro.categoria || "";
  if (campo.id === "categoria_manejo") return registro.categoria_manejo_entrada_nome || registro.categoria_manejo_nome || "";
  if (campo.id === "peso") return registro.peso_entrada_kg ?? registro.peso_medio_kg ?? "";
  if (campo.id === "motivo") return registro.motivo_entrada || registro.origem || "";
  return registro[fieldName] ?? "";
};

const formatDate = (value) => {
  if (!value) return "-";
  const [ano, mes, dia] = String(value).split("T")[0].split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "-";
};

const formatValue = (value, campo, relatedOptions = {}) => {
  if (value === undefined || value === null || value === "") return "-";

  if (campo?.options_source) {
    const option = (relatedOptions[campo.options_source] || []).find((item) => String(item.value) === String(value));
    if (option) return option.label;
  }

  if (campo?.tipo === "select") {
    const option = (campo.options || []).find((item) => String(item.value || item.label) === String(value));
    if (option) return option.label || option.value;
  }

  if (campo?.tipo === "date" || campo?.id === "data") return formatDate(value);
  if (campo?.id === "valor") return `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  if (campo?.id === "peso") return `${value} kg`;
  return value;
};

export const campoEngine = {
  normalize(campo) {
    return {
      ...campo,
      visivel_form: campo.visivel_form ?? campo.metadata?.visivel_formulario ?? true,
      visivel_tabela: campo.visivel_tabela ?? campo.metadata?.visivel_tabela ?? false,
      visivel_relatorio: campo.visivel_relatorio ?? campo.metadata?.visivel_relatorio ?? false,
      filtravel: campo.filtravel ?? campo.filtravel ?? true
    };
  },

  getValorCampo(registro, campo, relatedOptions = {}) {
    return formatValue(getRawValue(registro, campo), campo, relatedOptions);
  },

  getValorBruto(registro, campo) {
    return getRawValue(registro, campo);
  },

  getOptionsCampo(campo, relatedOptions = {}) {
    if (campo.options_source) return relatedOptions[campo.options_source] || [];
    return (campo.options || []).map((option) => ({
      value: option.value || option.label,
      label: option.label || option.value
    }));
  },

  buildValidationSchema(campos) {
    const shape = {};
    campos.filter((campo) => campo.obrigatorio).forEach((campo) => {
      shape[campo.field_name] = z.union([z.string().min(1), z.number(), z.boolean()]);
    });
    return z.object(shape);
  },

  calcularAgregacoes(registros, colunas, relatedOptions = {}) {
    const result = {};
    colunas.filter((campo) => campo.agregacao).forEach((campo) => {
      const valores = registros.map((registro) => Number(getRawValue(registro, campo))).filter((value) => !Number.isNaN(value));
      if (valores.length === 0) return;
      if (campo.agregacao === "sum") result[campo.id] = valores.reduce((acc, value) => acc + value, 0);
      if (campo.agregacao === "avg") result[campo.id] = valores.reduce((acc, value) => acc + value, 0) / valores.length;
      if (campo.agregacao === "min") result[campo.id] = Math.min(...valores);
      if (campo.agregacao === "max") result[campo.id] = Math.max(...valores);
    });
    return result;
  }
};

export default campoEngine;