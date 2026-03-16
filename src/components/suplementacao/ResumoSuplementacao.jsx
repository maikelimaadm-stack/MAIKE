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

  // Métricas agregadas de fornecimento e consumo
  const metricas = useMemo(() => {
    const validos = getHistoricoValido(consumosRecentes);
    // Fornecimento total (soma de todos os registros)
    const totalFornecidoKg = consumosRecentes.reduce((s, i) => s + (i.quantidade_fornecida_kg || i.consumo_total_lote_periodo_kg || 0), 0);
    // Consumo esperado PV total/dia (média ponderada por cabeças)
    const totalCabecas = validos.reduce((s, i) => s + (i.cabecas_na_area || 0), 0);
    const totalPesoKg = validos.reduce((s, i) => s + ((i.cabecas_na_area || 0) * (i.peso_medio_kg || 0)), 0);
    const pesoMedioGeral = totalCabecas > 0 ? totalPesoKg / totalCabecas : 0;
    const consumoEsperadoPVTotal = validos.reduce((s, i) => s + ((i.consumo_esperado_pv_lote_kg || 0)), 0);
    const consumoEsperadoPVDia = validos.length > 0 ? consumoEsperadoPVTotal / validos.length : 0;
    const consumoEsperadoCabDia = consumoEsperadoPVDia > 0 && totalCabecas > 0 ? (consumoEsperadoPVDia / (totalCabecas / validos.length)) : 0;
    // Consumo real cab/dia
    const totalAnimalDias = validos.reduce((s, i) => s + ((i.cabecas_na_area || 0) * (i.dias_periodo || 0)), 0);
    const totalConsumoReal = validos.reduce((s, i) => s + (i.consumo_total_lote_periodo_kg || 0), 0);
    const consumoRealCabDia = totalAnimalDias > 0 ? totalConsumoReal / totalAnimalDias : 0;
    const desvioKg = consumoRealCabDia > 0 && consumoEsperadoCabDia > 0 ? consumoRealCabDia - consumoEsperadoCabDia : null;

    return { totalFornecidoKg, totalCabecas, pesoMedioGeral, consumoEsperadoPVDia, consumoEsperadoCabDia, consumoRealCabDia, desvioKg };
  }, [consumosRecentes]);

  const fmtNum3 = (v) => v > 0 ? v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kg" : "-";

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

      {/* FORNECIMENTO */}
      {metricas.totalFornecidoKg > 0 && (
        <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Fornecimento</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Total fornecido</div>
              <div className="font-semibold text-slate-900">{formatKg(metricas.totalFornecidoKg)}</div>
            </div>
          </div>
        </div>
      )}

      {/* DADOS DO LOTE */}
      {metricas.totalCabecas > 0 && (
        <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Dados do Lote</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Qtd. Cabeças (média)</div>
              <div className="font-semibold text-slate-900">{Math.round(metricas.totalCabecas / (resumo.periodosValidos || 1)).toLocaleString("pt-BR")}</div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Peso médio</div>
              <div className="font-semibold text-slate-900">{metricas.pesoMedioGeral > 0 ? `${metricas.pesoMedioGeral.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg` : "-"}</div>
            </div>
          </div>
        </div>
      )}

      {/* CONSUMO ESPERADO */}
      {metricas.consumoEsperadoCabDia > 0 && (
        <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Esperado</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Consumo Lote PV/dia</div>
              <div className="font-semibold text-slate-900">{metricas.consumoEsperadoPVDia > 0 ? formatKg(metricas.consumoEsperadoPVDia) : "-"}</div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Esperado/cab/dia</div>
              <div className="font-semibold text-slate-900">{fmtNum3(metricas.consumoEsperadoCabDia)}</div>
            </div>
          </div>
        </div>
      )}

      {/* CONSUMO REAL */}
      {metricas.consumoRealCabDia > 0 && (
        <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Real</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Realizado cab/dia</div>
              <div className="font-semibold text-slate-900">{fmtNum3(metricas.consumoRealCabDia)}</div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Desvio</div>
              <div className="font-semibold text-slate-900 flex items-center gap-1">
                {metricas.desvioKg != null ? (
                  <>
                    <DesvioConsumoTag real={metricas.consumoRealCabDia} esperado={metricas.consumoEsperadoCabDia} />
                    {metricas.desvioKg > 0 ? "+" : ""}{metricas.desvioKg.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                  </>
                ) : "-"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}