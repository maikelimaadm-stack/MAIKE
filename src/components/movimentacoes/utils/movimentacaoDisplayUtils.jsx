export function parseDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
  }
  const dateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (dateTime) {
    const [, year, month, day] = dateTime;
    return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDatePtBr(value) {
  const parsed = parseDateOnly(value);
  if (!parsed) return "-";
  return parsed.toLocaleDateString("pt-BR");
}

export function getMovementGroupNumber(item) {
  if (!item) return "-";
  return item.numero_movimentacao || item.numero_registro || "-";
}

export function getMovementDisplayNumber(item, modoVisualizacao = "principais") {
  const groupNumber = getMovementGroupNumber(item);
  const seq = item?.numero_movimentacao_seq;
  if (modoVisualizacao === "movimentacoes") {
    return seq ? `${groupNumber}-${seq}` : groupNumber;
  }
  return groupNumber;
}

export function compareDisplayNumbers(a, b, modoVisualizacao = "principais") {
  const aGroup = Number(String(getMovementGroupNumber(a)).split("-")[0]) || 0;
  const bGroup = Number(String(getMovementGroupNumber(b)).split("-")[0]) || 0;
  if (aGroup !== bGroup) return aGroup - bGroup;

  const aSeq = modoVisualizacao === "movimentacoes" ? (Number(a?.numero_movimentacao_seq) || 0) : 0;
  const bSeq = modoVisualizacao === "movimentacoes" ? (Number(b?.numero_movimentacao_seq) || 0) : 0;
  if (aSeq !== bSeq) return aSeq - bSeq;

  return 0;
}

export function getMovementSortValue(item, key) {
  if (key === "data") {
    return parseDateOnly(item?.data_movimentacao)?.getTime() || 0;
  }
  if (key === "numero") {
    const numero = String(getMovementGroupNumber(item)).split("-")[0];
    return Number(numero) || 0;
  }
  if (key === "created") {
    return parseDateOnly(item?.created_date)?.getTime() || 0;
  }
  return 0;
}

export function compareByCreation(a, b) {
  const aCreated = parseDateOnly(a?.created_date)?.getTime() || 0;
  const bCreated = parseDateOnly(b?.created_date)?.getTime() || 0;
  if (aCreated !== bCreated) return bCreated - aCreated;
  return String(b?.id || "").localeCompare(String(a?.id || ""), "pt-BR", { numeric: true, sensitivity: "base" });
}