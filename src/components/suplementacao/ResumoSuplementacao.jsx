import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDateBR } from "../utils/pecuariaUtils";
import { formatConsumoGramasCabDia, formatConsumoKgCabDia, formatQuantidadeTecnica } from "./formatters";
import { calcularResumoHistorico, filtrarHistoricoPorMeses } from "./suplementacaoResumoUtils";

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

  if (consumosLote.length === 0) return null;

  if (modo === "compacto") {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 mt-2">
        <div className="text-[10px] font-semibold text-slate-900 mb-1">Suplementação (30 dias)</div>
        <div className="grid grid-cols-3 gap-2 text-[9px]">
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
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3">
      <div className="text-xs font-semibold text-slate-900 mb-2">Suplementação (últimos 30 dias)</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-[10px]">
        <div>
          <div className="text-slate-500 mb-0.5">Total consumido</div>
          <div className="text-sm font-bold text-slate-900">{formatQuantidadeTecnica(resumo.consumoTotalKg, 1)} kg</div>
        </div>
        <div>
          <div className="text-slate-500 mb-0.5">Média kg/cab/dia</div>
          <div className="text-sm font-bold text-slate-900">{formatConsumoKgCabDia(resumo.consumoMedioKgCabDia)}</div>
        </div>
        <div>
          <div className="text-slate-500 mb-0.5">Média g/cab/dia</div>
          <div className="text-sm font-bold text-slate-900">{formatConsumoGramasCabDia(resumo.consumoMedioKgCabDia)} g</div>
        </div>
        <div>
          <div className="text-slate-500 mb-0.5">Último lançamento</div>
          <div className="text-[11px] font-semibold text-slate-900">{resumo.ultimoLancamento ? formatDateBR(resumo.ultimoLancamento.data_lancamento) : "-"}</div>
        </div>
      </div>
      {resumo.ultimoLancamento && (
        <div className="mt-2 pt-2 border-t border-slate-200 text-[10px] text-slate-700">
          <strong>Último produto:</strong> {resumo.ultimoLancamento.produto}
        </div>
      )}
    </div>
  );
}