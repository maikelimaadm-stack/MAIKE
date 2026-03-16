import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDecimal, formatKg, formatDateBR } from "./formatters";
import { formatConsumoGramasCabDia, formatConsumoKgCabDia } from "./formatters";
import { calcularResumoHistorico, filtrarHistoricoPorMeses } from "./suplementacaoResumoUtils";
import { consumoEsperadoGrupoDia, pesoMedioPonderadoLotes } from "./consumoPVUtils";
import { sugerirPercentualPV } from "./suplementacaoRules";
import { kgParaSacos } from "./unidadeConversaoUtils";
import { normalizeText } from "./estoqueSuplementacaoUtils";
import DesvioConsumoTag from "./DesvioConsumoTag";

const parseDateLocal = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ano, mes, dia] = value.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const startOfLocalDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const diffLocalDays = (start) => {
  const inicio = parseDateLocal(start);
  if (!inicio) return 0;
  return Math.max(0, Math.floor((startOfLocalDay(new Date()) - startOfLocalDay(inicio)) / 86400000));
};

/**
 * Componente de suplementação no estilo cocho para detalhes de lote.
 * Mostra o último evento por lote com consumo esperado, real, projeção e indicadores.
 * 
 * modo="completo" para uso no DetalhesLote (estilo cocho)
 * modo="compacto" para uso em cards menores
 */
export default function ResumoSuplementacao({ lotesIds = [], modo = "completo" }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  // Buscar lotes ativos para ter dados de peso/cabeças
  const { data: lotesAtivos = [] } = useQuery({
    queryKey: ["lotes-resumo-supl", empresaSelecionadaId, lotesIds.join("|")],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && lotesIds.includes(l.id) && l.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId && lotesIds.length > 0,
  });

  // Buscar eventos de suplementação dos pontos vinculados às áreas dos lotes
  const areaIds = useMemo(() => [...new Set(lotesAtivos.map((l) => l.area_atual_id).filter(Boolean))], [lotesAtivos]);

  const { data: pontosSupl = [] } = useQuery({
    queryKey: ["pontos-supl-resumo-lote", empresaSelecionadaId, areaIds.join("|")],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.status === "Ativo" &&
        (areaIds.includes(p.area_vinculada_id) || (Array.isArray(p.area_vinculada_ids) && p.area_vinculada_ids.some((id) => areaIds.includes(id)))));
    },
    enabled: !!empresaSelecionadaId && areaIds.length > 0,
  });

  const pontoIds = useMemo(() => pontosSupl.map((p) => p.id), [pontosSupl]);

  const { data: eventos = [] } = useQuery({
    queryKey: ["eventos-supl-resumo-lote", empresaSelecionadaId, pontoIds.join("|")],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter((e) => e.empresa_id === empresaSelecionadaId && pontoIds.includes(e.ponto_suplementacao_id))
        .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && pontoIds.length > 0,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-resumo-supl", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Buscar SuplementacaoLote para dados de consumo realizado por lote
  const { data: consumosLote = [] } = useQuery({
    queryKey: ["suplementacao-lote-resumo", empresaSelecionadaId, lotesIds.join("|")],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoLote.list();
      return all.filter((s) => s.empresa_id === empresaSelecionadaId && lotesIds.includes(s.lote_id));
    },
    enabled: !!empresaSelecionadaId && lotesIds.length > 0,
  });

  // Último evento global (mais recente entre todos os cochos das áreas)
  const ultimoEventoGlobal = eventos[0] || null;

  // Dados do último evento (estilo cocho) - ALL HOOKS MUST BE BEFORE ANY EARLY RETURN
  const ultimoProduto = useMemo(() => {
    if (!ultimoEventoGlobal?.produto) return null;
    return produtos.find((p) => normalizeText(p.nome_produto || "") === normalizeText(ultimoEventoGlobal.produto || "")) || null;
  }, [produtos, ultimoEventoGlobal]);

  const totalCabecas = lotesAtivos.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
  const pesoMedioGeral = pesoMedioPonderadoLotes(lotesAtivos);
  const percentualPV = Number(ultimoProduto?.percentual_consumo_pv || sugerirPercentualPV(ultimoEventoGlobal?.produto || "")?.percentual_consumo_pv || 0);

  const consumoEsperadoDiaKg = useMemo(() => {
    if (!ultimoEventoGlobal) return 0;
    const consumoPorPeso = consumoEsperadoGrupoDia(pesoMedioGeral, percentualPV, totalCabecas);
    if (consumoPorPeso > 0) return consumoPorPeso;
    if (Number(ultimoEventoGlobal.consumo_esperado_pv_kg || 0) > 0) return Number(ultimoEventoGlobal.consumo_esperado_pv_kg);
    return 0;
  }, [ultimoEventoGlobal, pesoMedioGeral, percentualPV, totalCabecas]);

  // Saldo e projeção estilo cocho
  const projecao = useMemo(() => {
    if (!ultimoEventoGlobal) return null;
    const fornecido = Number(ultimoEventoGlobal.quantidade_total_kg || 0);
    const sobra = Number(ultimoEventoGlobal.sobra_kg || 0);
    const totalDisp = fornecido + sobra;
    const diasDesde = diffLocalDays(ultimoEventoGlobal.data_lancamento);
    const periodoFechado = (ultimoEventoGlobal.dias_periodo || 0) > 0;

    let saldoEstimado, baseDuracaoTotal, diasRestantes;

    if (periodoFechado) {
      saldoEstimado = sobra;
      baseDuracaoTotal = consumoEsperadoDiaKg > 0 ? Math.max(0, Math.round(totalDisp / consumoEsperadoDiaKg)) : Number(ultimoEventoGlobal.dias_periodo || 0);
      diasRestantes = consumoEsperadoDiaKg > 0 ? Math.max(0, Math.round(sobra / consumoEsperadoDiaKg)) : 0;
    } else if (consumoEsperadoDiaKg > 0) {
      saldoEstimado = Math.max(0, totalDisp - consumoEsperadoDiaKg * diasDesde);
      baseDuracaoTotal = Math.max(0, Math.round(totalDisp / consumoEsperadoDiaKg));
      diasRestantes = Math.max(0, baseDuracaoTotal - diasDesde);
    } else {
      saldoEstimado = totalDisp;
      baseDuracaoTotal = 0;
      diasRestantes = 0;
    }

    const dataBase = parseDateLocal(ultimoEventoGlobal.data_lancamento);
    const proximaData = dataBase && baseDuracaoTotal > 0
      ? new Date(dataBase.getTime() + baseDuracaoTotal * 86400000)
      : null;

    const consumoDiarioGrupo = ultimoEventoGlobal.consumo_diario_grupo_kg || 0;
    const consumoCabDiaReal = totalCabecas > 0 && consumoDiarioGrupo > 0 ? consumoDiarioGrupo / totalCabecas : 0;
    const consumoEsperadoCabDia = consumoEsperadoDiaKg > 0 && totalCabecas > 0 ? consumoEsperadoDiaKg / totalCabecas : 0;

    const pesoPorSaco = Number(ultimoProduto?.peso_por_saco_kg || 0);
    const sacosCalc = pesoPorSaco > 0 ? kgParaSacos(fornecido, pesoPorSaco) : null;

    const diferencaDias = periodoFechado && baseDuracaoTotal > 0 && ultimoEventoGlobal.dias_periodo > 0
      ? baseDuracaoTotal - ultimoEventoGlobal.dias_periodo
      : null;

    return {
      fornecido, sobra, totalDisp, saldoEstimado, baseDuracaoTotal, diasRestantes, proximaData,
      periodoFechado, consumoDiarioGrupo, consumoCabDiaReal, consumoEsperadoCabDia,
      sacosCalc, diferencaDias, diasDesde
    };
  }, [ultimoEventoGlobal, consumoEsperadoDiaKg, totalCabecas, ultimoProduto]);

  // Early return AFTER all hooks
  if (!ultimoEventoGlobal && consumosLote.length === 0) return null;

  // ---- Modo compacto (cards menores em outros contextos) ----
  if (modo === "compacto") {
    const consumosRecentes = filtrarHistoricoPorMeses(consumosLote, 1);
    const resumo = calcularResumoHistorico(consumosRecentes);
    return (
      <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
        <div className="text-[11px] font-bold text-slate-900">Suplementação (30 dias)</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
          <MC label="Total" value={`${formatKg(resumo.consumoTotalKg)}`} />
          <MC label="kg/cab/dia" value={formatConsumoKgCabDia(resumo.consumoMedioKgCabDia)} />
          <MC label="g/cab/dia" value={`${formatConsumoGramasCabDia(resumo.consumoMedioKgCabDia)} g`} />
          <MC label="Último" value={resumo.ultimoLancamento ? formatDateBR(resumo.ultimoLancamento.data_lancamento) : "-"} />
        </div>
      </div>
    );
  }

  // ---- Modo completo (estilo cocho) ----
  const fmtNum3 = (v) => v > 0 ? v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kg" : "-";
  const fmtSacos = (v) => v != null && v > 0 ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";

  return (
    <div className="space-y-1">
      {/* Último Registro - estilo cocho */}
      {ultimoEventoGlobal && projecao && (
        <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold text-slate-900">Último Registro</div>
            <span className="text-[10px] text-slate-500">{formatDateBR(ultimoEventoGlobal.data_lancamento)}</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px] space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900">{ultimoEventoGlobal.produto}</div>
              <span className="text-[9px] text-slate-500">{ultimoEventoGlobal.ponto_nome || ""}</span>
            </div>

            {/* Fornecimento */}
            <div>
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Fornecimento</div>
              <div className="grid grid-cols-3 gap-1">
                <MC label="Quantidade kg" value={formatKg(projecao.fornecido)} />
                <MC label="Quantidade sacos" value={fmtSacos(projecao.sacosCalc)} />
                <MC label="Sobra" value={formatKg(projecao.sobra)} />
              </div>
            </div>

            {/* Dados do Lote */}
            <div>
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Dados do Lote</div>
              <div className="grid grid-cols-2 gap-1">
                <MC label="Qtd. Cabeças" value={formatDecimal(totalCabecas, 0, true)} />
                <MC label="Peso médio" value={pesoMedioGeral > 0 ? `${formatDecimal(pesoMedioGeral, 0)} kg` : "-"} />
              </div>
            </div>

            {/* Consumo Esperado */}
            <div>
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Esperado</div>
              <div className="grid grid-cols-2 gap-1">
                <MC label="Consumo Lote PV/dia" value={consumoEsperadoDiaKg > 0 ? formatKg(consumoEsperadoDiaKg) : "-"} />
                <MC label="Esperado/cab/dia" value={fmtNum3(projecao.consumoEsperadoCabDia)} />
              </div>
            </div>

            {/* Consumo Real (período fechado) */}
            {projecao.periodoFechado && (
              <div>
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Real</div>
                <div className="grid grid-cols-2 gap-1">
                  <MC label="Realizado cab/dia" value={projecao.consumoCabDiaReal > 0 ? fmtNum3(projecao.consumoCabDiaReal) : "-"} />
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Desvio</div>
                    <div className="font-semibold text-slate-900 flex items-center gap-1">
                      {projecao.consumoCabDiaReal > 0 && projecao.consumoEsperadoCabDia > 0 ? (
                        <>
                          <DesvioConsumoTag real={projecao.consumoCabDiaReal} esperado={projecao.consumoEsperadoCabDia} />
                          {(projecao.consumoCabDiaReal - projecao.consumoEsperadoCabDia) > 0 ? "+" : ""}
                          {(projecao.consumoCabDiaReal - projecao.consumoEsperadoCabDia).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                        </>
                      ) : "-"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Projeção */}
            <div>
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Projeção</div>
              <div className="grid grid-cols-3 gap-1">
                <MC label="Fechamento" value={projecao.periodoFechado ? `${ultimoEventoGlobal.dias_periodo} dia(s)` : "Em aberto"} />
                <MC label="Duração estimada" value={projecao.baseDuracaoTotal > 0 ? `${projecao.baseDuracaoTotal} dia(s)` : "-"} />
                {projecao.periodoFechado ? (
                  <MC label="Diferença dia(s)" value={projecao.diferencaDias != null ? `${projecao.diferencaDias > 0 ? "+" : ""}${projecao.diferencaDias} dia(s)` : "-"} />
                ) : (
                  <MC label="Próx. reposição" value={projecao.proximaData ? projecao.proximaData.toLocaleDateString("pt-BR") : "-"} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Saldo estimado / indicadores de retorno */}
      {ultimoEventoGlobal && projecao && !projecao.periodoFechado && (
        <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Saldo Estimado</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
            <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
              <div className="text-slate-500">Saldo estimado</div>
              <div className="font-semibold text-slate-900">{formatKg(projecao.saldoEstimado)}</div>
              {consumoEsperadoDiaKg > 0 && <div className="text-[9px] text-slate-400 mt-0.5">{formatKg(consumoEsperadoDiaKg)}/dia</div>}
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
              <div className="text-slate-500">Duração estimada</div>
              <div className="font-semibold text-slate-900">{projecao.baseDuracaoTotal > 0 ? `${projecao.baseDuracaoTotal} dia(s)` : "-"}</div>
              {projecao.diasRestantes > 0 && <div className="text-[9px] text-slate-500 mt-0.5">Restam {projecao.diasRestantes} dia(s)</div>}
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
              <div className="text-slate-500">Próxima Reposição</div>
              <div className="font-semibold text-slate-900">{projecao.proximaData ? projecao.proximaData.toLocaleDateString("pt-BR") : "-"}</div>
            </div>
          </div>
        </div>
      )}

      {/* Consumo por lote individual (quando mais de 1 lote) */}
      {lotesAtivos.length > 1 && consumosLote.length > 0 && (
        <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Consumo por Lote (último)</div>
          <div className="space-y-1">
            {lotesAtivos.map((lote) => {
              const consumosDoLote = consumosLote
                .filter((c) => c.lote_id === lote.id)
                .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
              const ultimo = consumosDoLote[0];
              if (!ultimo) return null;

              return (
                <div key={lote.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[10px]">
                    <div>
                      <div className="font-medium text-slate-900 truncate">{lote.nome} ({lote.quantidade_cabecas || 0} cab)</div>
                      <div className="text-[9px] text-slate-500">{ultimo.produto || "-"} • {formatDateBR(ultimo.data_lancamento)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-slate-900">{formatConsumoKgCabDia(ultimo.consumo_por_cabeca_dia_kg)} kg/cab/dia</div>
                      <div className="text-[9px] text-slate-500">{formatConsumoGramasCabDia(ultimo.consumo_por_cabeca_dia_kg)} g/cab/dia</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MC({ label, value }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}