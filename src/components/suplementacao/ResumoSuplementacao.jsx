import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDecimal } from "../utils/pecuariaUtils";

/**
 * Componente unificado para exibir resumo de suplementação.
 * Substitui ResumoSuplementacaoLote e ResumoSuplementacaoCategoria.
 * 
 * @param {string[]} lotesIds - IDs dos lotes para buscar consumo
 * @param {"completo"|"compacto"} modo - "completo" (3 colunas, fundo verde) ou "compacto" (2 colunas, fundo azul)
 */
export default function ResumoSuplementacao({ lotesIds = [], modo = "completo" }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: consumosLote = [] } = useQuery({
    queryKey: ["suplementacao-resumo", lotesIds.join("|"), modo],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoLote.list();
      return all.filter((s) => s.empresa_id === empresaSelecionadaId && lotesIds.includes(s.lote_id));
    },
    enabled: !!empresaSelecionadaId && lotesIds.length > 0,
  });

  if (consumosLote.length === 0) return null;

  const dataLimite = new Date();
  dataLimite.setDate(dataLimite.getDate() - 30);
  const consumosRecentes = consumosLote.filter((c) => new Date(c.data_lancamento) >= dataLimite);

  const consumoTotalKg = consumosRecentes.reduce((sum, c) => sum + (c.consumo_total_lote_periodo_kg || 0), 0);
  const consumoMedioPorCabeca = consumosRecentes.length > 0
    ? consumosRecentes.reduce((sum, c) => sum + (c.consumo_por_cabeca_dia_kg || 0), 0) / consumosRecentes.length
    : 0;
  const ultimoLancamento = consumosLote.length > 0
    ? consumosLote.sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0]
    : null;

  if (modo === "compacto") {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mt-2">
        <div className="text-[10px] font-semibold text-blue-900 mb-1">📊 Suplementação (30d)</div>
        <div className="grid grid-cols-2 gap-2 text-[9px]">
          <div>
            <div className="text-blue-700">Total</div>
            <div className="text-xs font-bold text-blue-900">{formatDecimal(consumoTotalKg, 1)} kg</div>
          </div>
          <div>
            <div className="text-blue-700">Média/cab/dia</div>
            <div className="text-xs font-bold text-blue-900">{formatDecimal(consumoMedioPorCabeca, 3)} kg</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">
      <div className="text-xs font-semibold text-emerald-900 mb-2">📊 Suplementação (últimos 30 dias)</div>
      <div className="grid grid-cols-3 gap-3 text-[10px]">
        <div>
          <div className="text-emerald-700 mb-0.5">Total consumido</div>
          <div className="text-sm font-bold text-emerald-900">{formatDecimal(consumoTotalKg, 1)} kg</div>
        </div>
        <div>
          <div className="text-emerald-700 mb-0.5">Média/cabeça/dia</div>
          <div className="text-sm font-bold text-emerald-900">{formatDecimal(consumoMedioPorCabeca, 3)} kg</div>
        </div>
        <div>
          <div className="text-emerald-700 mb-0.5">Último lançamento</div>
          <div className="text-[11px] font-semibold text-emerald-900">
            {ultimoLancamento ? new Date(ultimoLancamento.data_lancamento).toLocaleDateString("pt-BR") : "-"}
          </div>
        </div>
      </div>
      {ultimoLancamento && (
        <div className="mt-2 pt-2 border-t border-emerald-200 text-[10px] text-emerald-800">
          <strong>Último produto:</strong> {ultimoLancamento.produto}
        </div>
      )}
    </div>
  );
}