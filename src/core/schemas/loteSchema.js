export const LOTE_LAYOUT_VERSION = 1;

export const loteFieldSchema = [
  {
    id: "geral",
    title: "Dados Gerais",
    fields: [
      { id: "nome", name: "nome", field_name: "nome", label: "Nome do Lote", type: "text", origem: "fixo", required: true, colSpan: 6, visible: { form: true, table: true, report: true }, order: 10, uppercase: true, placeholder: "NOME DO LOTE" },
      { id: "data_entrada", name: "data_entrada", field_name: "data_entrada", label: "Data de Entrada", type: "date", origem: "fixo", required: true, colSpan: 3, visible: { form: true, table: true, report: true }, order: 20 },
      { id: "motivo_entrada", name: "motivo_entrada", field_name: "motivo_entrada", label: "Motivo da Entrada", type: "select", origem: "fixo", required: true, colSpan: 3, visible: { form: true, table: true, report: true }, order: 30, options: ["Compra", "Ajuste", "Inventário", "Outros"].map((value) => ({ value, label: value.toUpperCase() })) },
      { id: "quantidade_cabecas", name: "quantidade_cabecas", field_name: "quantidade_cabecas", label: "Qtd. Cabeças", type: "number", origem: "fixo", required: true, colSpan: 3, visible: { form: true, table: true, report: true }, order: 40 },
      { id: "categoria", name: "categoria", field_name: "categoria", label: "Categoria", type: "text", origem: "fixo", required: true, colSpan: 3, visible: { form: true, table: true, report: true }, order: 50, uppercase: true },
      { id: "sexo", name: "sexo", field_name: "sexo", label: "Sexo", type: "select", origem: "fixo", required: true, colSpan: 3, visible: { form: true, table: true, report: true }, order: 60, options: ["Macho", "Fêmea", "Misto"].map((value) => ({ value, label: value.toUpperCase() })) },
      { id: "peso_medio_kg", name: "peso_medio_kg", field_name: "peso_medio_kg", label: "Peso Médio (kg)", type: "number", origem: "fixo", required: true, colSpan: 3, visible: { form: true, table: true, report: true }, order: 70, step: "0.1" },
      { id: "raca_predominante", name: "raca_predominante", field_name: "raca_predominante", label: "Raça Predominante", type: "text", origem: "fixo", required: true, colSpan: 6, visible: { form: true, table: true, report: true }, order: 80, uppercase: true },
      { id: "idade_media_meses", name: "idade_media_meses", field_name: "idade_media_meses", label: "Idade Média (meses)", type: "number", origem: "fixo", required: true, colSpan: 3, visible: { form: true, table: false, report: true }, order: 90 },
      { id: "sistema_produtivo", name: "sistema_produtivo", field_name: "sistema_produtivo", label: "Sistema Produtivo", type: "text", origem: "fixo", required: true, colSpan: 6, visible: { form: true, table: true, report: true }, order: 100, uppercase: true },
    ],
  },
  {
    id: "personalizados",
    title: "Campos Personalizados",
    fields: [
      { id: "observacao_tecnica", name: "observacao_tecnica", field_name: "observacao_tecnica", label: "Observação Técnica", type: "textarea", origem: "customizado", required: false, colSpan: 12, visible: { form: true, table: true, report: true }, order: 10, uppercase: true, rows: 2 },
    ],
  },
];

export const getLoteFields = (target = "form") => {
  return loteFieldSchema.map((section) => ({
    ...section,
    fields: section.fields
      .filter((field) => field.visible?.[target] !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
  })).filter((section) => section.fields.length > 0);
};

export const getFlatLoteFields = (target = "form") => getLoteFields(target).flatMap((section) => section.fields);