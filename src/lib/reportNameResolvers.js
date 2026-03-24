export function normalizeReportName(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

export function buildByIdMap(items = []) {
  return new Map((items || []).filter((item) => item?.id).map((item) => [item.id, item]));
}

export function buildCategoryAliasMap(categorias = []) {
  const aliasMap = new Map();

  (categorias || []).forEach((categoria) => {
    if (categoria?.nome) {
      aliasMap.set(normalizeReportName(categoria.nome), categoria.nome);
    }

    if (categoria?.categoria_oficial) {
      aliasMap.set(
        normalizeReportName(categoria.categoria_oficial),
        categoria.nome || categoria.categoria_oficial,
      );
    }
  });

  return aliasMap;
}

export function resolveCategoryName(value, aliasMap) {
  if (!value) return '';
  return aliasMap?.get(normalizeReportName(value)) || value;
}