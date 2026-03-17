import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDateBR, formatKg } from "../utils/pecuariaUtils";
import { formatConsumoGramasCabDia, formatConsumoKgCabDia, formatQuantidadeTecnica } from "./formatters";
import { calcularResumoHistorico, filtrarHistoricoPorMeses, getHistoricoValido } from "./suplementacaoResumoUtils";
import DesvioConsumoTag from "./DesvioConsumoTag";
import { kgParaSacos } from "./unidadeConversaoUtils";

/**
 * Componente unificado para exibir resumo de suplementação.
 * 
 * @param {string[]} lotesIds - IDs dos lotes para buscar consumo
 * @param {"completo"|"compacto"} modo - "completo" ou "compacto"
 * @param {string} areaId - ID da área atual (filtra consumo apenas desta área)
 */
export default function ResumoSuplementacao({ lotesIds = [], modo = "completo", areaId = "" }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  // Buscar registros de consumo por lote
  const { data: consumosLoteBrutos = [] } = useQuery({
    queryKey: ["suplementacao-resumo", empresaSelecionadaId, lotesIds.join("|"), modo],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoLote.list();
      return all.filter((s) => s.empresa_id === empresaSelecionadaId && lotesIds.includes(s.lote_id));
    },
    enabled: !!empresaSelecionadaId && lotesIds.length > 0,
  });

  // Buscar eventos de suplementação (contém fornecimento em kg, sacos, sobra, area_id)
  const eventoIdsBrutos = useMemo(() => [...new Set(consumosLoteBrutos.map((c) => c.suplementacao_evento_id).filter(Boolean))], [consumosLoteBrutos]);
  const { data: eventosSupl = [] } = useQuery({
    queryKey: ["suplementacao-eventos-resumo", empresaSelecionadaId, eventoIdsBrutos.join("|")],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter((e) => eventoIdsBrutos.includes(e.id));
    },
    enabled: eventoIdsBrutos.length > 0,
  });

  const { data: consumosEventosRelacionados = [] } = useQuery({
    queryKey: ["suplementacao-lotes-eventos-resumo", empresaSelecionadaId, eventoIdsBrutos.join("|")],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoLote.list();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && eventoIdsBrutos.includes(item.suplementacao_evento_id));
    },
    enabled: !!empresaSelecionadaId && eventoIdsBrutos.length > 0,
  });

  // Filtrar consumos: se areaId informado, manter APENAS registros de eventos vinculados a essa área.
  // Isso impede que histórico de suplementação de outra área "viaje junto" quando o lote é movido.
  // IMPORTANTE: se areaId está definido mas eventos ainda não carregaram, retornar vazio (não mostrar dados sem filtro).
  const consumosLote = useMemo(() => {
    if (!areaId) return consumosLoteBrutos;
    // Se temos consumos mas os eventos ainda não carregaram, retornar vazio para não mostrar dados de outra área
    if (consumosLoteBrutos.length > 0 && eventoIdsBrutos.length > 0 && eventosSupl.length === 0) return [];
    if (eventosSupl.length === 0) return [];
    const eventosNaArea = new Set(
      eventosSupl
        .filter((e) => e.area_id === areaId || (Array.isArray(e.area_ids) && e.area_ids.includes(areaId)))
        .map((e) => e.id)
    );
    return consumosLoteBrutos.filter((c) => eventosNaArea.has(c.suplementacao_evento_id));
  }, [consumosLoteBrutos, eventosSupl, areaId, eventoIdsBrutos]);

  const eventoIds = useMemo(() => [...new Set(consumosLote.map((c) => c.suplementacao_evento_id).filter(Boolean))], [consumosLote]);

  const consumosRecentes = useMemo(() => filtrarHistoricoPorMeses(consumosLote, 1), [consumosLote]);
  const resumo = useMemo(() => calcularResumoHistorico(consumosRecentes), [consumosRecentes]);

  // Eventos filtrados pela área (se areaId informado)
  const eventosAreaFiltrados = useMemo(() => {
    if (!areaId) return eventosSupl;
    return eventosSupl.filter((e) => e.area_id === areaId || (Array.isArray(e.area_ids) && e.area_ids.includes(areaId)));
  }, [eventosSupl, areaId]);

  // IDs de eventos dos últimos 30 dias (sem duplicatas)
  const eventosRecentesIds = useMemo(() => [...new Set(consumosRecentes.map((c) => c.suplementacao_evento_id).filter(Boolean))], [consumosRecentes]);
  const eventosRecentes = useMemo(() => eventosAreaFiltrados.filter((e) => eventosRecentesIds.includes(e.id)), [eventosAreaFiltrados, eventosRecentesIds]);

  const percentualUso = useMemo(() => {
    const validos = consumosRecentes.filter((item) => (item.cabecas_na_area || 0) > 0 && (item.dias_periodo || 0) > 0 && (item.consumo_esperado_pv_lote_kg || 0) > 0);
    if (!validos.length) return null;
    const totalReal = validos.reduce((sum, item) => sum + (item.consumo_total_lote_periodo_kg || 0), 0);
    const totalEsperado = validos.reduce((sum, item) => sum + ((item.consumo_esperado_pv_lote_kg || 0) * (item.dias_periodo || 0)), 0);
    return totalEsperado > 0 ? (totalReal / totalEsperado) * 100 : null;
  }, [consumosRecentes]);

  // Métricas agregadas: fornecimento, lote, consumo esperado/real
  const metricas = useMemo(() => {
    const validos = getHistoricoValido(consumosRecentes);

    // --- FORNECIMENTO (eventos sem duplicar) ---
    const totalFornecidoKg = eventosRecentes.reduce((s, e) => s + (e.quantidade_total_kg || 0), 0);
    const totalSacos = eventosRecentes.reduce((s, e) => {
      if (e.quantidade_sacos > 0) return s + e.quantidade_sacos;
      if (e.peso_por_saco_kg > 0) return s + kgParaSacos(e.quantidade_total_kg || 0, e.peso_por_saco_kg);
      return s;
    }, 0);
    // Total consumido = soma do consumo real de todos os registros de lote
    const totalConsumidoKg = validos.reduce((s, i) => s + (i.consumo_total_lote_periodo_kg || 0), 0);
    // Sobra = fornecido - consumido (o que resta a consumir)
    const sobraRestaKg = Math.max(0, totalFornecidoKg - totalConsumidoKg);

    // --- DADOS DO LOTE ---
    // Média de cabeças: agrupar por evento, pegar o total_cabecas de cada evento,
    // e fazer a média. Assim se lancei 150+150 = média 150 (mesmo lote) ou 300 (lotes diferentes).
    // Usar o último registro de cada lote para refletir a qtd atual
    const ultimoRegistroPorLote = {};
    [...validos].sort((a, b) => new Date(a.data_lancamento) - new Date(b.data_lancamento)).forEach((i) => {
      ultimoRegistroPorLote[i.lote_id] = i;
    });
    const lotesUnicos = Object.values(ultimoRegistroPorLote);
    const qtdLotes = lotesUnicos.length;
    const totalCabecasAtual = lotesUnicos.reduce((s, i) => s + (i.cabecas_na_area || 0), 0);
    const totalPesoKg = lotesUnicos.reduce((s, i) => s + ((i.cabecas_na_area || 0) * (i.peso_medio_lote_kg || 0)), 0);
    const pesoMedioGeral = totalCabecasAtual > 0 ? totalPesoKg / totalCabecasAtual : 0;

    // --- CONSUMO ESPERADO (média ponderada usando cabeças atuais) ---
    const consumoEsperadoPVDia = lotesUnicos.reduce((s, i) => s + (i.consumo_esperado_pv_lote_kg || 0), 0);
    const consumoEsperadoCabDia = totalCabecasAtual > 0 && consumoEsperadoPVDia > 0 ? consumoEsperadoPVDia / totalCabecasAtual : 0;

    // --- CONSUMO REAL (kg/cab/dia ponderado por animal-dias) ---
    const totalAnimalDias = validos.reduce((s, i) => s + ((i.cabecas_na_area || 0) * (i.dias_periodo || 0)), 0);
    const consumoRealCabDia = totalAnimalDias > 0 ? totalConsumidoKg / totalAnimalDias : 0;

    // --- DESVIO ---
    const desvioKg = consumoRealCabDia > 0 && consumoEsperadoCabDia > 0 ? consumoRealCabDia - consumoEsperadoCabDia : null;

    // --- ÚLTIMO LANÇAMENTO (evento mais recente) ---
    const ultimoEvento = [...eventosRecentes].sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0] || null;
    const ultimoSacos = ultimoEvento ? (ultimoEvento.quantidade_sacos > 0 ? ultimoEvento.quantidade_sacos : (ultimoEvento.peso_por_saco_kg > 0 ? kgParaSacos(ultimoEvento.quantidade_total_kg || 0, ultimoEvento.peso_por_saco_kg) : 0)) : 0;

    return {
      totalFornecidoKg, totalSacos, totalConsumidoKg, sobraRestaKg,
      qtdLotes, totalCabecasAtual, pesoMedioGeral,
      consumoEsperadoPVDia, consumoEsperadoCabDia, consumoRealCabDia, desvioKg,
      ultimoEvento, ultimoSacos,
    };
  }, [consumosRecentes, eventosRecentes]);

  const fmtNum3 = (v) => v > 0 ? v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kg" : "-";
  const fmtSacos = (v) => v > 0 ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";

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

  const Cell = ({ label, children }) => (
    <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{children}</div>
    </div>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-1">
      <span className="font-semibold text-slate-900 text-xs">Suplementação (últimos 30 dias)</span>

      {/* FORNECIMENTO */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Fornecimento</div>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <Cell label="Total fornecido">{formatKg(metricas.totalFornecidoKg)}</Cell>
          <Cell label="Total consumido">{formatKg(metricas.totalConsumidoKg)}</Cell>
          <Cell label="Sobra (resta)">{formatKg(metricas.sobraRestaKg)}</Cell>
        </div>
      </div>

      {/* DADOS DO LOTE */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Dados do Lote</div>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <Cell label="Qtd. Lotes">{metricas.qtdLotes}</Cell>
          <Cell label="Qtd. Cabeças">{metricas.totalCabecasAtual.toLocaleString("pt-BR")}</Cell>
          <Cell label="Peso médio geral">{metricas.pesoMedioGeral > 0 ? `${metricas.pesoMedioGeral.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg` : "-"}</Cell>
        </div>
      </div>

      {/* CONSUMO ESPERADO + REAL (mesma linha) */}
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

      {/* ÚLTIMO LANÇAMENTO */}
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