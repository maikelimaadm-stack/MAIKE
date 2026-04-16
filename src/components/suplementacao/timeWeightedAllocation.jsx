import { safeDivide } from "../utils/pecuariaUtils";

const DAY_MS = 86400000;

const parseDateLocal = (value) => {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ano, mes, dia] = value.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const diffDays = (start, end) => Math.max(0, Math.ceil((end - start) / DAY_MS));

export function buildTimeWeightedLoteAllocations({
  lotes = [],
  movimentacoes = [],
  areaIds = [],
  dataInicio,
  dataFim,
  consumoTotalPeriodo = 0,
}) {
  const inicio = parseDateLocal(dataInicio);
  const fim = parseDateLocal(dataFim);

  if (!inicio || !fim || fim <= inicio || !lotes.length) {
    return lotes.map((lote) => ({
      loteId: lote.id,
      cabecasAtuais: Number(lote.quantidade_cabecas || 0),
      diasAtivos: 0,
      animalDias: 0,
      percentualParticipacao: 0,
      consumoTotalLotePeriodoKg: 0,
      consumoPorCabecaDiaKg: 0,
      timeline: [],
    }));
  }

  const areaIdsSet = new Set(areaIds.filter(Boolean));
  const lotesMap = new Map(lotes.map((lote) => [lote.id, lote]));
  const movimentosOrdenados = movimentacoes
    .filter((mov) => lotesMap.has(mov.lote_id))
    .map((mov) => ({ ...mov, data: parseDateLocal(mov.data_movimentacao) }))
    .filter((mov) => mov.data)
    .sort((a, b) => a.data - b.data);

  const allocations = lotes.map((lote) => {
    const loteMovs = movimentosOrdenados.filter((mov) => mov.lote_id === lote.id);
    let cursor = inicio;
    let cabecasAtivas = Number(lote.quantidade_cabecas || 0);

    for (let i = loteMovs.length - 1; i >= 0; i -= 1) {
      const mov = loteMovs[i];
      if (mov.data >= fim) {
        const quantidade = Number(mov.quantidade_animais || 0);
        if (mov.tipo === "Entrada") cabecasAtivas -= quantidade;
        if (mov.tipo === "Saída") cabecasAtivas += quantidade;
      }
    }

    cabecasAtivas = Math.max(0, cabecasAtivas);
    const timeline = [];

    loteMovs.forEach((mov) => {
      if (mov.data < inicio || mov.data >= fim) return;
      const intervaloDias = diffDays(cursor, mov.data);
      if (intervaloDias > 0 && cabecasAtivas > 0) {
        timeline.push({
          inicio: cursor,
          fim: mov.data,
          dias: intervaloDias,
          cabecas: cabecasAtivas,
          animalDias: cabecasAtivas * intervaloDias,
        });
      }

      const quantidade = Number(mov.quantidade_animais || 0);
      const envolveArea = areaIdsSet.size === 0
        || areaIdsSet.has(mov.area_origem_id)
        || areaIdsSet.has(mov.area_destino_id);

      if (envolveArea) {
        if (mov.tipo === "Entrada") cabecasAtivas += quantidade;
        if (mov.tipo === "Saída") cabecasAtivas = Math.max(0, cabecasAtivas - quantidade);
      }

      cursor = mov.data;
    });

    const diasRestantes = diffDays(cursor, fim);
    if (diasRestantes > 0 && cabecasAtivas > 0) {
      timeline.push({
        inicio: cursor,
        fim,
        dias: diasRestantes,
        cabecas: cabecasAtivas,
        animalDias: cabecasAtivas * diasRestantes,
      });
    }

    const animalDias = timeline.reduce((sum, item) => sum + item.animalDias, 0);
    const diasAtivos = timeline.reduce((sum, item) => sum + item.dias, 0);

    return {
      loteId: lote.id,
      cabecasAtuais: Number(lote.quantidade_cabecas || 0),
      diasAtivos,
      animalDias,
      percentualParticipacao: 0,
      consumoTotalLotePeriodoKg: 0,
      consumoPorCabecaDiaKg: 0,
      timeline,
    };
  });

  const totalAnimalDias = allocations.reduce((sum, item) => sum + item.animalDias, 0);

  return allocations.map((item) => {
    const percentualParticipacao = safeDivide(item.animalDias, totalAnimalDias);
    const consumoTotalLotePeriodoKg = Number(consumoTotalPeriodo || 0) * percentualParticipacao;
    const consumoPorCabecaDiaKg = safeDivide(consumoTotalLotePeriodoKg, item.animalDias);

    return {
      ...item,
      percentualParticipacao,
      consumoTotalLotePeriodoKg,
      consumoPorCabecaDiaKg,
    };
  });
}