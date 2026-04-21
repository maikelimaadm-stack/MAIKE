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

const isPosteriorOuMesmoDiaMaisNovo = ({ itemCreatedDate, referenceCreatedDate, referenceDate }) => {
  return getTimestamp(itemCreatedDate) > getTimestamp(referenceCreatedDate || referenceDate);
};

export async function validarOrdemTemporalLote({ empresaId, loteId, dataReferencia, createdDateReferencia, ignorarMovimentacaoId }) {
  if (!empresaId || !loteId || !dataReferencia) return;

  const [movimentacoes, suplementacoes] = await Promise.all([
    base44.entities.MovimentacaoMapa.filter({ empresa_id: empresaId, lote_id: loteId }, "-data_movimentacao", 200),
    base44.entities.SuplementacaoLote.filter({ empresa_id: empresaId, lote_id: loteId }, "-data_lancamento", 200),
  ]);

  const existePosteriorMovimentacao = movimentacoes
    .filter((item) => item.id !== ignorarMovimentacaoId)
    .filter((item) => !item.motivo || !['Junção de Lotes', 'Renomear Lote'].includes(item.motivo))
    .some((item) => isPosteriorOuMesmoDiaMaisNovo({
      itemDate: item.data_movimentacao || item.created_date,
      itemCreatedDate: item.created_date,
      referenceDate: dataReferencia,
      referenceCreatedDate: createdDateReferencia,
    }));

  const existePosteriorSuplementacao = suplementacoes.some((item) => isPosteriorOuMesmoDiaMaisNovo({
    itemDate: item.data_lancamento || item.created_date,
    itemCreatedDate: item.created_date,
    referenceDate: dataReferencia,
    referenceCreatedDate: createdDateReferencia,
  }));

  if (existePosteriorMovimentacao || existePosteriorSuplementacao) {
    throw new Error("Não é possível seguir com este registro, pois existem eventos posteriores para o lote.");
  }
}

export async function validarOrdemTemporalLotes({ empresaId, lotes, dataReferencia, createdDateReferencia, ignorarMovimentacaoId }) {
  const loteIds = [...new Set((lotes || []).map((lote) => lote?.id).filter(Boolean))];

  for (const loteId of loteIds) {
    await validarOrdemTemporalLote({ empresaId, loteId, dataReferencia, createdDateReferencia, ignorarMovimentacaoId });
  }
}

export async function validarSemRegistrosPosteriores({ empresaId, loteId, dataReferencia, createdDateReferencia, ignorarMovimentacaoId }) {
  if (!empresaId || !loteId || !dataReferencia) return;

  const [movimentacoes, suplementacoes] = await Promise.all([
    base44.entities.MovimentacaoMapa.filter({ empresa_id: empresaId, lote_id: loteId }, "-data_movimentacao", 200),
    base44.entities.SuplementacaoLote.filter({ empresa_id: empresaId, lote_id: loteId }, "-data_lancamento", 200),
  ]);

  const movimentacoesPosteriores = movimentacoes
    .filter((item) => item.id !== ignorarMovimentacaoId)
    .some((item) => isPosteriorOuMesmoDiaMaisNovo({
      itemDate: item.data_movimentacao || item.created_date,
      itemCreatedDate: item.created_date,
      referenceDate: dataReferencia,
      referenceCreatedDate: createdDateReferencia,
    }));

  const suplementacoesPosteriores = suplementacoes.some((item) => isPosteriorOuMesmoDiaMaisNovo({
    itemDate: item.data_lancamento || item.created_date,
    itemCreatedDate: item.created_date,
    referenceDate: dataReferencia,
    referenceCreatedDate: createdDateReferencia,
  }));

  if (movimentacoesPosteriores || suplementacoesPosteriores) {
    throw new Error("Existem registros posteriores para este lote. Exclua primeiro os lançamentos mais recentes e refaça o registro, se necessário.");
  }
}