import { base44 } from "@/api/base44Client";

export const LAYOUT_SCOPE_PRIORITY = ["usuario", "empresa", "sistema"];

function normalizeField(field) {
  return {
    id: field.field_id,
    name: field.field_name,
    label: field.label,
    type: field.tipo,
    colSpan: field.col_span || 12,
    required: Boolean(field.obrigatorio),
    placeholder: field.placeholder,
    uppercase: Boolean(field.uppercase),
    readOnly: Boolean(field.read_only),
    step: field.step,
    rows: field.rows,
    options: field.options || [],
    optionsSource: field.options_source,
    source: field.origem || "fixo",
    rules: field.regras || {},
    metadata: field.metadata || {},
  };
}

function normalizeColumn(column) {
  return {
    id: column.column_id,
    label: column.label,
    default: column.visivel !== false,
    sortable: column.ordenavel !== false,
    filterable: column.filtravel !== false,
    accessor: column.field_name,
    source: column.origem || "fixo",
    align: column.alinhamento === "right" ? "right" : column.alinhamento === "center" ? "center" : "left",
    format: column.formato,
    strong: Boolean(column.destaque),
    truncate: Boolean(column.truncate),
    groupable: Boolean(column.agrupavel),
    rules: column.regras || {},
    metadata: column.metadata || {},
  };
}

export function applyScopePriority(layouts, { userEmail, empresaId }) {
  const activeLayouts = layouts.filter((layout) => layout.ativo !== false);

  return (
    activeLayouts.find((layout) => layout.escopo === "usuario" && layout.user_email === userEmail) ||
    activeLayouts.find((layout) => layout.escopo === "empresa" && layout.empresa_id === empresaId) ||
    activeLayouts.find((layout) => layout.escopo === "sistema") ||
    null
  );
}

export async function loadLayoutFromDatabase({ tela, entityName, empresaId, userEmail }) {
  const [layouts, secoes, campos, colunas] = await Promise.all([
    base44.entities.LayoutConfiguracao.filter({ tela }),
    base44.entities.LayoutSecao.list("ordem"),
    base44.entities.LayoutCampo.filter({ entity_name: entityName }, "ordem"),
    base44.entities.LayoutTabelaColuna.filter({ entity_name: entityName }, "ordem"),
  ]);

  const layout = applyScopePriority(layouts, { userEmail, empresaId });
  if (!layout) return null;

  const layoutSections = secoes
    .filter((section) => section.layout_id === layout.id && section.ativo !== false)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  const layoutFields = campos
    .filter((field) => field.layout_id === layout.id && field.ativo !== false)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  const sections = layoutSections.map((section) => ({
    id: section.section_id,
    title: section.titulo,
    rules: section.regras || {},
    metadata: section.metadata || {},
    fields: layoutFields.filter((field) => field.section_id === section.section_id).map(normalizeField),
  }));

  const tableColumns = colunas
    .filter((column) => column.layout_id === layout.id)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .map(normalizeColumn);

  return {
    layout,
    formConfig: { id: `${tela}-form`, sections },
    tableColumns,
  };
}

export async function saveLayoutVersion({ layoutId, snapshot, motivo = "Alteração de layout" }) {
  const versions = await base44.entities.LayoutVersao.filter({ layout_id: layoutId }, "-versao");
  const nextVersion = versions.length ? Number(versions[0].versao || 0) + 1 : 1;
  return base44.entities.LayoutVersao.create({ layout_id: layoutId, versao: nextVersion, snapshot, motivo, ativo: true });
}