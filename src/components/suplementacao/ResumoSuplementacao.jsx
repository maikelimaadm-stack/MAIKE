import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listarLotesDaEmpresa, listarEventosDaEmpresa } from "@/services/suplementacaoService";
import { formatDateBR, formatKg } from "../utils/pecuariaUtils";
import { formatConsumoGramasCabDia, formatConsumoKgCabDia, formatQuantidadeTecnica } from "./formatters";
import DesvioConsumoTag from "./DesvioConsumoTag";

export default function ResumoSuplementacao({ lotesIds = [], modo = "completo", areaId = "" }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: lotesAtuais = [] } = useQuery({
    queryKey: ["suplementacao-lotes-atuais", empresaSelecionadaId, lotesIds.join("|")],
    queryFn: async () => {
      const all = await listarLotesDaEmpresa(empresaSelecionadaId);
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lotesIds.includes(lote.id) && lote.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId && lotesIds.length > 0,
  });

  const { data: eventosArea = [] } = useQuery({
    queryKey: ["suplementacao-eventos-area-resumo", empresaSelecionadaId, areaId],
    queryFn: async () => {
      const all = await listarEventosDaEmpresa(empresaSelecionadaId);
      return all.filter((evento) => {
        if (evento.empresa_id !== empresaSelecionadaId) return false;
        if (!areaId) return true;
        return evento.area_id === areaId || (Array.isArray(evento.area_ids) && evento.area_ids.includes(areaId));
      });
    },
    enabled: !!empresaSelecionadaId,
  });

  const eventosRecentes = useMemo(() => {
    const dataLimite = new Date();
    dataLimite.setMonth(dataLimite.getMonth() - 1);
    return eventosArea.filter((evento) => new Date(evento.data_lancamento) >= dataLimite);
  }, [eventosArea]);

  const eventosFechados = useMemo(() => {
    return eventosRecentes.filter((evento) => (evento.dias_periodo || 0) > 0 && (evento.total_cabecas_afetadas || 0) > 0);
  }, [eventosRecentes]);

  const metricas = useMemo(() => {
    const qtdLotes = lotesAtuais.length;
    const totalCabecasAtual = lotesAtuais.reduce((sum, lote) => sum + (lote.quantidade_cabecas || 0), 0);
    const pesoTotalAtual = lotesAtuais.reduce((sum, lote) => sum + ((lote.quantidade_cabecas || 0) * (lote.peso_medio_kg || 0)), 0);

    const totalFornecidoKg = eventosRecentes.reduce((sum, evento) => sum + (evento.quantidade_total_kg || 0), 0);
    const totalConsumidoKg = eventosFechados.reduce((sum, evento) => sum + ((evento.consumo_diario_grupo_kg || 0) * (evento.dias_periodo || 0)), 0);
    const sobraRestaKg = Math.max(0, totalFornecidoKg - totalConsumidoKg);

    const totalDiasFechados = eventosFechados.reduce((sum, evento) => sum + (evento.dias_periodo || 0), 0);
    const totalAnimalDias = eventosFechados.reduce((sum, evento) => sum + ((evento.total_cabecas_afetadas || 0) * (evento.dias_periodo || 0)), 0);
    const totalEsperadoPeriodoKg = eventosFechados.reduce((sum, evento) => sum + ((evento.consumo_esperado_pv_kg || 0) * (evento.dias_periodo || 0)), 0);

    const mediaCabecasHistorico = totalDiasFechados > 0
      ? eventosFechados.reduce((sum, evento) => sum + ((evento.total_cabecas_afetadas || 0) * (evento.dias_periodo || 0)), 0) / totalDiasFechados
      : 0;
    const pesoMedioHistorico = totalAnimalDias > 0
      ? eventosFechados.reduce((sum, evento) => sum + ((evento.peso_medio_lotes_kg || 0) * (evento.total_cabecas_afetadas || 0) * (evento.dias_periodo || 0)), 0) / totalAnimalDias
      : 0;

    const totalCabecasReferencia = mediaCabecasHistorico > 0 ? Math.round(mediaCabecasHistorico) : totalCabecasAtual;
    const pesoMedioGeral = pesoMedioHistorico > 0 ? pesoMedioHistorico : (totalCabecasAtual > 0 ? pesoTotalAtual / totalCabecasAtual : 0);

    const consumoRealCabDia = totalAnimalDias > 0 ? totalConsumidoKg / totalAnimalDias : 0;
    const consumoEsperadoCabDia = totalAnimalDias > 0 ? totalEsperadoPeriodoKg / totalAnimalDias : 0;
    const consumoEsperadoPVDia = totalDiasFechados > 0 ? totalEsperadoPeriodoKg / totalDiasFechados : 0;
    const desvioKg = consumoRealCabDia > 0 && consumoEsperadoCabDia > 0 ? consumoRealCabDia - consumoEsperadoCabDia : null;

    const ultimoEvento = [...eventosRecentes].sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0] || null;
    const ultimoSacos = ultimoEvento?.quantidade_sacos > 0
      ? ultimoEvento.quantidade_sacos
      : (ultimoEvento?.peso_por_saco_kg > 0 ? (ultimoEvento.quantidade_total_kg || 0) / ultimoEvento.peso_por_saco_kg : 0);

    return {
      qtdLotes,
      totalCabecasAtual: totalCabecasReferencia,
      pesoMedioGeral,
      totalFornecidoKg,
      totalConsumidoKg,
      sobraRestaKg,
      consumoEsperadoPVDia,
      consumoEsperadoCabDia,
      consumoRealCabDia,
      desvioKg,
      ultimoEvento,
      ultimoSacos,
    };
  }, [lotesAtuais, eventosRecentes, eventosFechados]);

  const percentualUso = useMemo(() => {
    const totalAnimalDias = eventosFechados.reduce((sum, evento) => sum + ((evento.total_cabecas_afetadas || 0) * (evento.dias_periodo || 0)), 0);
    const totalEsperadoPeriodoKg = eventosFechados.reduce((sum, evento) => sum + ((evento.consumo_esperado_pv_kg || 0) * (evento.dias_periodo || 0)), 0);
    const totalConsumidoKg = eventosFechados.reduce((sum, evento) => sum + ((evento.consumo_diario_grupo_kg || 0) * (evento.dias_periodo || 0)), 0);
    if (totalAnimalDias <= 0 || totalEsperadoPeriodoKg <= 0) return null;
    return (totalConsumidoKg / totalEsperadoPeriodoKg) * 100;
  }, [eventosFechados]);

  const fmtNum3 = (v) => v > 0 ? v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kg" : "-";
  const fmtSacos = (v) => v > 0 ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";

  if (!areaId || eventosRecentes.length === 0) return null;

  if (modo === "compacto") {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 mt-2">
        <div className="text-[10px] font-semibold text-slate-900 mb-1">Suplementação (30 dias)</div>
        <div className="grid grid-cols-4 gap-2 text-[9px]">
          <div>
            <div className="text-slate-500">Total</div>
            <div className="text-xs font-bold text-slate-900">{formatQuantidadeTecnica(metricas.totalConsumidoKg, 1)} kg</div>
          </div>
          <div>
            <div className="text-slate-500">kg/cab/dia</div>
            <div className="text-xs font-bold text-slate-900">{formatConsumoKgCabDia(metricas.consumoRealCabDia)}</div>
          </div>
          <div>
            <div className="text-slate-500">g/cab/dia</div>
            <div className="text-xs font-bold text-slate-900">{formatConsumoGramasCabDia(metricas.consumoRealCabDia)}</div>
          </div>
          <div>
            <div className="text-slate-500">% uso</div>
            <div className="text-xs font-bold text-slate-900">{percentualUso != null ? `${percentualUso.toFixed(0)}%` : '-'}</div>
          </div>
        </div>
      </div>
    );
  }

  const Cell = ({ label, children }) => (
    <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{children}</div>
    </div>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-1">
      <span className="font-semibold text-slate-900 text-xs">Suplementação (últimos 30 dias)</span>

      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Fornecimento</div>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <Cell label="Total fornecido">{formatKg(metricas.totalFornecidoKg)}</Cell>
          <Cell label="Total consumido">{formatKg(metricas.totalConsumidoKg)}</Cell>
          <Cell label="Sobra (resta)">{formatKg(metricas.sobraRestaKg)}</Cell>
        </div>
      </div>

      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Dados do Lote</div>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <Cell label="Qtd. Lotes">{metricas.qtdLotes}</Cell>
          <Cell label="Qtd. Cabeças">{metricas.totalCabecasAtual.toLocaleString("pt-BR")}</Cell>
          <Cell label="Peso médio geral">{metricas.pesoMedioGeral > 0 ? `${metricas.pesoMedioGeral.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg` : "-"}</Cell>
        </div>
      </div>

      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Esperado / Real</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
          <Cell label="Consumo Lote PV/dia">{metricas.consumoEsperadoPVDia > 0 ? formatKg(metricas.consumoEsperadoPVDia) : "-"}</Cell>
          <Cell label="Esperado/cab/dia">{fmtNum3(metricas.consumoEsperadoCabDia)}</Cell>
          <Cell label="Realizado cab/dia">{fmtNum3(metricas.consumoRealCabDia)}</Cell>
          <Cell label="Desvio">
            <span className="flex items-center gap-1">
              {metricas.desvioKg != null ? (
                <>
                  <DesvioConsumoTag real={metricas.consumoRealCabDia} esperado={metricas.consumoEsperadoCabDia} />
                  {metricas.desvioKg > 0 ? "+" : ""}{metricas.desvioKg.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                </>
              ) : "-"}
            </span>
          </Cell>
        </div>
      </div>

      {metricas.ultimoEvento && (
        <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Último Lançamento</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
            <Cell label="Data">{formatDateBR(metricas.ultimoEvento.data_lancamento)}</Cell>
            <Cell label="Produto">{metricas.ultimoEvento.produto || "-"}</Cell>
            <Cell label="Total fornecido">{formatKg(metricas.ultimoEvento.quantidade_total_kg || 0)}</Cell>
            <Cell label="Total sacos">{fmtSacos(metricas.ultimoSacos)}</Cell>
          </div>
        </div>
      )}
    </div>
  );
}