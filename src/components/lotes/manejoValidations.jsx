import { base44 } from "@/api/base44Client";

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

export async function validarOrdemTemporalLote({ empresaId, loteId, dataReferencia }) {
  if (!empresaId || !loteId || !dataReferencia) return;

  const [movimentacoes, suplementacoes] = await Promise.all([
    base44.entities.MovimentacaoMapa.filter({ empresa_id: empresaId, lote_id: loteId }, '-data_movimentacao', 200),
    base44.entities.SuplementacaoLote.filter({ empresa_id: empresaId, lote_id: loteId }, '-data_lancamento', 200),
  ]);

  const existePosterior = [...movimentacoes, ...suplementacoes].some((item) => {
    const dataItem = item.data_movimentacao || item.data_lancamento || item.created_date;
    return isPosterior(dataItem, dataReferencia);
  });

  if (existePosterior) {
    throw new Error('Não é possível lançar ou alterar este registro, pois existem eventos posteriores para o lote.');
  }
}

export async function validarOrdemTemporalLotes({ empresaId, lotes, dataReferencia }) {
  const loteIds = [...new Set((lotes || []).map((lote) => lote?.id).filter(Boolean))];

  for (const loteId of loteIds) {
    await validarOrdemTemporalLote({ empresaId, loteId, dataReferencia });
  }
}