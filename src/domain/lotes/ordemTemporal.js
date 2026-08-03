/**
 * Regras puras da ordem temporal de manejo (P1.2).
 *
 * Extraídas de `src/components/lotes/manejoValidations.jsx`, que acessava o
 * provider de dentro de `src/components`. A regra é a mesma — o que muda é
 * quem carrega os registros: agora o service, por API explícita.
 *
 * Sem React, sem provider, sem `window`, sem storage.
 */

const getDateKey = (value) => {
  const raw = String(value || "");
  if (!raw) return "";
  return raw.includes("T") ? raw.split("T")[0] : raw;
};

const getTimestamp = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const isPosterior = (itemDate, referenceDate) => {
  const itemKey = getDateKey(itemDate);
  const referenceKey = getDateKey(referenceDate);
  if (!itemKey || !referenceKey) return false;
  return itemKey > referenceKey;
};

const isPosteriorOuMesmoDiaMaisNovo = ({ itemDate, itemCreatedDate, referenceDate, referenceCreatedDate }) => {
  const itemTime = getTimestamp(itemDate);
  const referenceTime = getTimestamp(referenceDate);

  if (itemTime > referenceTime) return true;
  if (itemTime < referenceTime) return false;

  return getTimestamp(itemCreatedDate) > getTimestamp(referenceCreatedDate || referenceDate);
};

/**
 * Existe lançamento posterior à data de referência?
 *
 * @param {Array<object>} registros movimentações e suplementações já carregadas
 * @param {string} dataReferencia
 * @param {string} [createdDateReferencia]
 */
export const existeLancamentoPosterior = (registros, dataReferencia, createdDateReferencia) =>
  (registros || []).some((item) => {
    const dataItem = item.data_movimentacao || item.data_lancamento || item.created_date;
    if (isPosterior(dataItem, dataReferencia)) return true;
    return isPosteriorOuMesmoDiaMaisNovo({
      itemDate: dataItem,
      itemCreatedDate: item.created_date,
      referenceDate: dataReferencia,
      referenceCreatedDate: createdDateReferencia,
    });
  });

export { getDateKey, getTimestamp, isPosterior, isPosteriorOuMesmoDiaMaisNovo };
