export const ENTIDADES_RELACIONAIS = [
  { value: "Fornecedor", label: "Fornecedor / Cliente", fields: ["nome", "razao_social", "email", "telefone", "cidade"] },
  { value: "Produto", label: "Produto", fields: ["nome_produto", "codigo_interno", "categoria", "marca"] },
  { value: "CategoriaManejo", label: "Categoria de Manejo", fields: ["nome", "categoria_oficial", "sexo", "raca"] },
  { value: "Setor", label: "Setor", fields: ["nome", "numero_setor"] },
  { value: "AreaPastagem", label: "Área / Piquete", fields: ["nome", "numero_area", "setor_nome"] },
  { value: "CentroCusto", label: "Centro de Custo", fields: ["nome", "tipo", "centro_custo_pai_nome"] },
  { value: "LocalEstoque", label: "Local de Estoque", fields: ["nome", "numero_local", "descricao"] }
];

export const CAMPOS_FIXOS_LOTE = [
  { value: "quantidade_cabecas", label: "Quantidade de Cabeças", tipo: "number" },
  { value: "quantidade_entrada", label: "Quantidade de Entrada", tipo: "number" },
  { value: "peso_medio_kg", label: "Peso Médio Atual", tipo: "number" },
  { value: "peso_entrada_kg", label: "Peso de Entrada", tipo: "number" },
  { value: "idade_media_meses", label: "Idade Média", tipo: "number" },
  { value: "valor_total_compra", label: "Valor Total Compra", tipo: "number" },
  { value: "valor_por_cabeca", label: "Valor por Cabeça", tipo: "number" },
  { value: "valor_frete", label: "Valor Frete", tipo: "number" },
  { value: "nome", label: "Nome do Lote", tipo: "text" },
  { value: "categoria", label: "Categoria Atual", tipo: "text" },
  { value: "sexo", label: "Sexo", tipo: "select" },
  { value: "data_entrada", label: "Data de Entrada", tipo: "date" },
  { value: "fornecedor_nome", label: "Fornecedor", tipo: "text" }
];

export const AGREGACOES_POR_TIPO = {
  number: [
    { value: "sum", label: "Soma" },
    { value: "avg", label: "Média" },
    { value: "min", label: "Menor valor" },
    { value: "max", label: "Maior valor" }
  ],
  calculado: [
    { value: "sum", label: "Soma" },
    { value: "avg", label: "Média" },
    { value: "min", label: "Menor valor" },
    { value: "max", label: "Maior valor" }
  ],
  select: [{ value: "count", label: "Contagem" }],
  relation: [{ value: "count", label: "Contagem" }],
  text: [],
  textarea: [],
  date: []
};

export const OPERACOES_CALCULO = [
  { value: "+", label: "+ Somar" },
  { value: "-", label: "- Subtrair" },
  { value: "*", label: "× Multiplicar" },
  { value: "/", label: "÷ Dividir" }
];

export const montarFormulaVisual = (items = []) => {
  return items
    .filter((item) => item.field)
    .map((item, index) => `${index > 0 ? `${item.operator || "+"} ` : ""}${item.field}`)
    .join(" ");
};

export const montarCamposDisponiveis = (campos = [], editingId = null) => {
  const custom = campos
    .filter((campo) => campo.id !== editingId && ["number", "calculado"].includes(campo.tipo))
    .map((campo) => ({ value: campo.field_name, label: campo.label, tipo: campo.tipo }));
  return [...CAMPOS_FIXOS_LOTE.filter((campo) => campo.tipo === "number"), ...custom];
};