import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDateBR, formatKg } from "../utils/pecuariaUtils";
import { formatConsumoGramasCabDia, formatConsumoKgCabDia, formatQuantidadeTecnica } from "./formatters";
import { calcularResumoHistorico, filtrarHistoricoPorMeses, getHistoricoValido } from "./suplementacaoResumoUtils";
import DesvioConsumoTag from "./DesvioConsumoTag";

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
    queryKey: ["suplementacao-resumo", empresaSelecionadaId, lotesIds.join("|"), modo],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoLote.list();
      return all.filter((s) => s.empresa_id === empresaSelecionadaId && lotesIds.includes(s.lote_id));
    },
    enabled: !!empresaSelecionadaId && lotesIds.length > 0,
  });

  const consumosRecentes = useMemo(() => filtrarHistoricoPorMeses(consumosLote, 1), [consumosLote]);
  const resumo = useMemo(() => calcularResumoHistorico(consumosRecentes), [consumosRecentes]);
  const percentualUso = useMemo(() => {
    const validos = consumosRecentes.filter((item) => (item.cabecas_na_area || 0) > 0 && (item.dias_periodo || 0) > 0 && (item.consumo_esperado_pv_lote_kg || 0) > 0);
    if (!validos.length) return null;
    const totalReal = validos.reduce((sum, item) => sum + (item.consumo_total_lote_periodo_kg || 0), 0);
    const totalEsperado = validos.reduce((sum, item) => sum + ((item.consumo_esperado_pv_lote_kg || 0) * (item.dias_periodo || 0)), 0);
    return totalEsperado > 0 ? (totalReal / totalEsperado) * 100 : null;
  }, [consumosRecentes]);

  if (consumosLote.length === 0) return null;

  if (modo === "compacto") {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 mt-2">
        <div className="text-[10px] font-semibold text-slate-900 mb-1">Suplementação (30 dias)</div>
        <div className="grid grid-cols-4 gap-2 text-[9px]">
          <div>
            <div className="text-slate-500">Total</div>
            <div className="text-xs font-bold text-slate-900">{formatQuantidadeTecnica(resumo.consumoTotalKg, 1)} kg</div>
          </div>
          <div>
            <div className="text-slate-500">kg/cab/dia</div>
            <div className="text-xs font-bold text-slate-900">{formatConsumoKgCabDia(resumo.consumoMedioKgCabDia)}</div>
          </div>
          <div>
            <div className="text-slate-500">g/cab/dia</div>
            <div className="text-xs font-bold text-slate-900">{formatConsumoGramasCabDia(resumo.consumoMedioKgCabDia)}</div>
          </div>
          <div>
            <div className="text-slate-500">% uso</div>
            <div className="text-xs font-bold text-slate-900">{percentualUso != null ? `${percentualUso.toFixed(0)}%` : '-'}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-1">
      <span className="font-semibold text-slate-900 text-xs">Suplementação (últimos 30 dias)</span>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Total consumido</div>
          <div className="font-semibold text-slate-900">{formatQuantidadeTecnica(resumo.consumoTotalKg, 1)} kg</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Média kg/cab/dia</div>
          <div className="font-semibold text-slate-900">{formatConsumoKgCabDia(resumo.consumoMedioKgCabDia)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Média g/cab/dia</div>
          <div className="font-semibold text-slate-900">{formatConsumoGramasCabDia(resumo.consumoMedioKgCabDia)} g</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">% uso</div>
          <div className="font-semibold text-slate-900">{percentualUso != null ? `${percentualUso.toFixed(0)}%` : '-'}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Último lançamento</div>
          <div className="font-semibold text-slate-900">{resumo.ultimoLancamento ? formatDateBR(resumo.ultimoLancamento.data_lancamento) : "-"}</div>
        </div>
        {resumo.ultimoLancamento && (
          <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
            <div className="text-slate-500">Último produto</div>
            <div className="font-semibold text-slate-900">{resumo.ultimoLancamento.produto}</div>
          </div>
        )}
      </div>
    </div>
  );
}