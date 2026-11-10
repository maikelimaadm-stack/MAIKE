import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listarLotesDaEmpresa, listarEventosDaEmpresa } from "@/services/suplementacaoService";
import { formatConsumoGramasCabDia, formatConsumoKgCabDia, formatQuantidadeTecnica } from "./formatters";
import DesvioConsumoTag from "./DesvioConsumoTag";
import { CartaoDl, PilulaTitulo, TituloSecao, GradeCampos, useDlUi } from "@/components/mapa/detalhes-lote/pecas";
import { VAZIO, fmtData, fmtInt, fmtNum } from "@/components/mapa/detalhes-lote/catalogo";

/**
 * @param {{ lotesIds?: string[], modo?: string, areaId?: string, lotesInformados?: any[] }} props
 * `lotesInformados`: PR174-R1 (D-PROD-107) — numa empresa no ledger o mapa já
 * entrega as POSIÇÕES desta área (cabeças/peso da projeção); não há Lote a buscar.
 */
export default function ResumoSuplementacao({ lotesIds = [], modo = "completo", areaId = "", lotesInformados = undefined }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const ui = useDlUi();

  const { data: lotesBuscados = [] } = useQuery({
    queryKey: ["suplementacao-lotes-atuais", empresaSelecionadaId, lotesIds.join("|")],
    queryFn: async () => {
      const all = await listarLotesDaEmpresa(empresaSelecionadaId);
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lotesIds.includes(lote.id) && lote.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId && lotesIds.length > 0 && !lotesInformados,
  });
  const lotesAtuais = lotesInformados ? lotesInformados.filter((p) => Number(p.quantidade_cabecas || 0) > 0) : lotesBuscados;

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

    const ultimoEvento = [...eventosRecentes].sort((a, b) => new Date(b.data_lancamento).getTime() - new Date(a.data_lancamento).getTime())[0] || null;
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

  // Número sem unidade (a unidade vai no rótulo); vazio = "—".
  /** @param {number} v */
  const fmtNum3 = (v) => (v > 0 ? fmtNum(v, 3) : VAZIO);
  /** @param {number} v */
  const fmtSacos = (v) => (v > 0 ? fmtNum(v, 2) : VAZIO);

  if (!areaId || eventosRecentes.length === 0) return null;

  if (modo === "compacto") {
    return (
      <div className="bg-[#FAFCFE] border border-slate-200 rounded-lg p-2 mt-2">
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

  // Modo "completo": card do padrão Detalhes do Lote v8 (mockup linhas 136–150 / 394–409).
  const colsLargas = ui.celular ? 2 : 4;
  const desvio = metricas.desvioKg;
  const secoes = [
    {
      titulo: "Fornecimento",
      colunas: 3,
      campos: [
        { rotulo: "Total fornecido (kg)", texto: fmtNum(metricas.totalFornecidoKg) },
        { rotulo: "Total consumido (kg)", texto: fmtNum(metricas.totalConsumidoKg) },
        { rotulo: "Sobra (resta) (kg)", texto: fmtNum(metricas.sobraRestaKg) },
      ],
    },
    {
      titulo: "Dados do Lote",
      colunas: 3,
      campos: [
        { rotulo: "Qtd. Lotes", texto: fmtInt(metricas.qtdLotes) },
        { rotulo: "Qtd. Cabeças", texto: fmtInt(metricas.totalCabecasAtual) },
        { rotulo: "Peso médio geral (kg)", texto: metricas.pesoMedioGeral > 0 ? fmtInt(metricas.pesoMedioGeral) : VAZIO },
      ],
    },
    {
      titulo: "Consumo Esperado / Real",
      colunas: colsLargas,
      campos: [
        { rotulo: "Consumo Lote PV/dia (kg)", texto: metricas.consumoEsperadoPVDia > 0 ? fmtNum(metricas.consumoEsperadoPVDia) : VAZIO },
        { rotulo: "Esperado/cab/dia (kg)", texto: fmtNum3(metricas.consumoEsperadoCabDia) },
        { rotulo: "Realizado cab/dia (kg)", texto: fmtNum3(metricas.consumoRealCabDia) },
        {
          rotulo: "Desvio (kg)",
          texto: desvio != null ? (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <DesvioConsumoTag real={metricas.consumoRealCabDia} esperado={metricas.consumoEsperadoCabDia} />
              {`${desvio > 0 ? "+" : ""}${fmtNum(desvio, 3)}`}
            </span>
          ) : VAZIO,
        },
      ],
    },
    ...(metricas.ultimoEvento ? [{
      titulo: "Último Lançamento",
      colunas: colsLargas,
      campos: [
        { rotulo: "Data", texto: fmtData(metricas.ultimoEvento.data_lancamento) },
        { rotulo: "Produto", texto: metricas.ultimoEvento.produto || VAZIO },
        { rotulo: "Total fornecido (kg)", texto: fmtNum(metricas.ultimoEvento.quantidade_total_kg || 0) },
        { rotulo: "Total sacos", texto: fmtSacos(metricas.ultimoSacos) },
      ],
    }] : []),
  ];

  return (
    <CartaoDl gap={6}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PilulaTitulo>Suplementação (últimos 30 dias)</PilulaTitulo>
      </div>
      {secoes.map((secao) => (
        <div key={secao.titulo}>
          <TituloSecao>{secao.titulo}</TituloSecao>
          <GradeCampos campos={secao.campos} colunas={secao.colunas} />
        </div>
      ))}
    </CartaoDl>
  );
}
