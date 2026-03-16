import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioLancamentoSuplementacao from "../suplementacao/FormularioLancamentoSuplementacao";
import HistoricoSuplementacaoPonto from "../suplementacao/HistoricoSuplementacaoPonto";
import DetalhesDepositoSuplementacao from "./DetalhesDepositoSuplementacao";
import PontoPercentIcon from "./PontoPercentIcon";

import { formatDecimal, formatKg } from "../suplementacao/formatters";
import { getCochoIndicator } from "./pontoStatusUtils";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { kgParaSacos } from "../suplementacao/unidadeConversaoUtils";
import { consumoEsperadoGrupoDia, pesoMedioPonderadoLotes } from "../suplementacao/consumoPVUtils";
import { sugerirPercentualPV } from "../suplementacao/suplementacaoRules";

const parseDateLocal = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ano, mes, dia] = value.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateBR = (value) => {
  const data = parseDateLocal(value);
  return data ? data.toLocaleDateString("pt-BR") : "-";
};

const startOfLocalDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const diffLocalDays = (start, end = new Date()) => {
  const inicio = parseDateLocal(start);
  if (!inicio) return 0;
  const inicioDia = startOfLocalDay(inicio);
  const fimDia = startOfLocalDay(end);
  return Math.max(0, Math.floor((fimDia - inicioDia) / 86400000));
};

export default function DetalhesPontoSuplementacao({ ponto, onClose }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showLancamento, setShowLancamento] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const isDeposito = normalizeText(ponto?.categoria_ponto) === "DEPOSITO";

  const { data: eventos = [] } = useQuery({
    queryKey: ["eventos-ponto", ponto.id],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter((evento) => evento.empresa_id === empresaSelecionadaId && evento.ponto_suplementacao_id === ponto.id).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!ponto?.id
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones-ponto-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((item) => item.ativo !== false && item.tipo_entidade === "Ponto");
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-ponto-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-ponto-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId
  });

  const indicador = useMemo(() => getCochoIndicator(ponto, eventos), [ponto, eventos]);
  const iconePonto = useMemo(() => {
    const categoriaPonto = normalizeText(ponto?.categoria_ponto || "");
    const nomePonto = normalizeText(ponto?.nome_ponto || "");

    return iconesConfig.find((item) => {
      const categoriaIcone = normalizeText(item.categoria || "");
      if (categoriaIcone === categoriaPonto) return true;
      if (categoriaPonto.includes("COCHO") && categoriaIcone === "COCHO") return true;
      if (categoriaPonto.includes("DEPOSITO") && categoriaIcone === "DEPOSITO") return true;
      if (nomePonto.includes("COCHO") && categoriaIcone === "COCHO") return true;
      if (nomePonto.includes("DEPOSITO") && categoriaIcone === "DEPOSITO") return true;
      return false;
    });
  }, [iconesConfig, ponto?.categoria_ponto, ponto?.nome_ponto]);
  const subIconePonto = iconePonto?.sub_icone_url || iconePonto?.icone_url || "";
  const iconeExibicao = subIconePonto;
  const ultimoEvento = indicador.latestRecord;
  const diasSemLancamento = ultimoEvento ? diffLocalDays(ultimoEvento.data_lancamento) : null;
  const totalFornecido = eventos.reduce((total, evento) => total + (evento.quantidade_total_kg || 0), 0);
  const areaIdsRelacionadas = Array.isArray(ponto.area_vinculada_ids) && ponto.area_vinculada_ids.length > 0
    ? ponto.area_vinculada_ids
    : ponto.area_vinculada_id
      ? [ponto.area_vinculada_id]
      : [];
  const lotesRelacionados = useMemo(() => {
    return lotes.filter((lote) => areaIdsRelacionadas.includes(lote.area_atual_id));
  }, [lotes, areaIdsRelacionadas]);
  const totalCabecasRelacionadas = useMemo(() => {
    return lotesRelacionados.reduce((total, lote) => total + Number(lote.quantidade_cabecas || 0), 0);
  }, [lotesRelacionados]);
  const pesoMedioRelacionados = useMemo(() => pesoMedioPonderadoLotes(lotesRelacionados), [lotesRelacionados]);
  const ultimoProduto = useMemo(() => {
    if (!ultimoEvento?.produto) return null;
    return produtos.find((produto) => normalizeText(produto.nome_produto || "") === normalizeText(ultimoEvento.produto || "")) || null;
  }, [produtos, ultimoEvento]);
  const ultimoEventoSacos = useMemo(() => {
    const pesoPorSaco = Number(ultimoProduto?.peso_por_saco_kg || 0);
    if (!ultimoEvento || pesoPorSaco <= 0) return null;
    return kgParaSacos(ultimoEvento.quantidade_total_kg || 0, pesoPorSaco);
  }, [ultimoProduto, ultimoEvento]);
  const percentualProduto = Number(ultimoProduto?.percentual_consumo_pv || sugerirPercentualPV(ultimoEvento?.produto || "")?.percentual_consumo_pv || 0);
  const consumoEsperadoDiaKg = useMemo(() => {
    if (!ultimoEvento) return 0;
    const consumoPorPeso = consumoEsperadoGrupoDia(pesoMedioRelacionados, percentualProduto, totalCabecasRelacionadas);
    if (consumoPorPeso > 0) return consumoPorPeso;
    return Number(ultimoEvento.consumo_diario_grupo_kg || 0);
  }, [ultimoEvento, pesoMedioRelacionados, percentualProduto, totalCabecasRelacionadas]);
  const resumoProdutos = useMemo(() => {
    const mapa = new Map();
    eventos.forEach((evento) => {
      const produto = produtos.find((item) => normalizeText(item.nome_produto || "") === normalizeText(evento.produto || ""));
      const pesoPorSaco = Number(produto?.peso_por_saco_kg || 0);
      const atual = mapa.get(evento.produto) || { produto: evento.produto, kg: 0, sacos: 0 };
      atual.kg += Number(evento.quantidade_total_kg || 0);
      atual.sacos += pesoPorSaco > 0 ? kgParaSacos(evento.quantidade_total_kg || 0, pesoPorSaco) : 0;
      mapa.set(evento.produto, atual);
    });
    return Array.from(mapa.values()).sort((a, b) => (a.produto || "").localeCompare(b.produto || ""));
  }, [eventos, produtos]);
  const frequenciaMinimaAlerta = Number(ponto.frequencia_esperada_dias_minimo || ponto.frequencia_esperada_dias || 0);
  const temAlerta = ponto.status === "Ativo" && frequenciaMinimaAlerta > 0 && (diasSemLancamento === null || diasSemLancamento > frequenciaMinimaAlerta);

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["eventos-ponto", "mapa-eventos-supl", "mapa-pontos-supl", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  if (isDeposito) {
    return <DetalhesDepositoSuplementacao deposito={ponto} onClose={onClose} />;
  }

  return (
    <div className="space-y-1" translate="no">
      <div className="pb-2 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">Local: {ponto.nome_ponto}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLancamento(true)}>Lançar</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>
      </div>

      {/* Saldo estimado no cocho */}
      {ultimoEvento && (() => {
        const sobra = Number(ultimoEvento.sobra_kg || 0);
        const fornecido = Number(ultimoEvento.quantidade_total_kg || 0);
        const diasDesde = diasSemLancamento || 0;
        const totalDisponivel = fornecido + sobra;
        const consumoBase = consumoEsperadoDiaKg > 0 ? consumoEsperadoDiaKg : (ultimoEvento.consumo_diario_grupo_kg || 0);
        // Se período já fechado, saldo = sobra. Senão, saldo = total - consumo × dias desde lançamento
        const saldoEstimado = ultimoEvento.dias_periodo != null ? sobra : Math.max(0, totalDisponivel - consumoBase * diasDesde);
        const minimoDias = Number(ponto.frequencia_esperada_dias_minimo || 0);
        // Base duração = dias totais que o totalDisponivel dura (desde a data do lançamento)
        const baseDuracaoTotal = consumoBase > 0 ? Math.max(0, Math.round(totalDisponivel / consumoBase)) : 0;
        // Dias restantes a partir de hoje
        const diasRestantes = ultimoEvento.dias_periodo != null
          ? (consumoBase > 0 ? Math.max(0, Math.round(sobra / consumoBase)) : 0)
          : Math.max(0, baseDuracaoTotal - diasDesde);
        const dataBaseLancamento = parseDateLocal(ultimoEvento.data_lancamento);
        // Próxima suplementação = data_lancamento + duração total
        const proximaData = dataBaseLancamento && baseDuracaoTotal > 0
          ? new Date(dataBaseLancamento.getTime() + baseDuracaoTotal * 86400000)
          : null;
        // Percentual baseado na proporção restante do período (saldo/totalDisponivel)
        const percentual = totalDisponivel > 0 ? Math.min(1, saldoEstimado / totalDisponivel) : 0;
        const alertaGrafico = minimoDias > 0 && diasDesde >= minimoDias;
        return (
          <CardSection title="Saldo estimado no cocho">
            <div className="my-1 grid grid-cols-1 md:grid-cols-[auto,1fr] gap-1 items-center">
              <div className="pb-1 flex items-center gap-3">
                <PontoPercentIcon
                  imageUrl={iconeExibicao}
                  label={ponto.categoria_ponto || "Cocho"}
                  percent={percentual}
                  fillClassName={alertaGrafico ? "bg-red-500" : "bg-lime-400"} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Saldo estimado kg</div>
                  <div className="text-sm font-bold text-slate-900">{formatKg(saldoEstimado)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Duração total</div>
                  <div className="text-sm font-bold text-slate-900">{baseDuracaoTotal > 0 ? `${formatDecimal(baseDuracaoTotal, 0, true)} dia(s)` : '-'}</div>
                  {diasRestantes > 0 && <div className="text-[9px] text-slate-500 mt-0.5">Restam {formatDecimal(diasRestantes, 0, true)} dia(s)</div>}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Próxima suplementação</div>
                  <div className="text-sm font-bold text-slate-900">{proximaData ? proximaData.toLocaleDateString('pt-BR') : '-'}</div>
                </div>
              </div>
            </div>
          </CardSection>);

      })()}

      <CardSection title="Total Fornecido por Produto">
        {resumoProdutos.length === 0 ? (
          <div className="text-xs text-slate-500">Nenhum produto lançado ainda.</div>
        ) : (
          <div className="space-y-1">
            {resumoProdutos.map((item) => (
              <div key={item.produto} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                  <div className="truncate font-medium text-slate-900">{item.produto}</div>
                  <div className="whitespace-nowrap font-semibold text-slate-900">{item.sacos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos</div>
                  <div className="whitespace-nowrap font-semibold text-slate-900">{formatKg(item.kg)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardSection>

      <CardSection title="Último Registro">
        {ultimoEvento ?
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-2">
            <div className="font-semibold leading-tight text-slate-900">{ultimoEvento.produto}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-1">
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Data: <span className="font-semibold text-slate-900">{formatDateBR(ultimoEvento.data_lancamento)}</span></div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Quantidade kg: <span className="font-semibold text-slate-900">{formatKg(ultimoEvento.quantidade_total_kg || 0)}</span></div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Quantidade sacos: <span className="font-semibold text-slate-900">{ultimoEventoSacos != null ? formatDecimal(ultimoEventoSacos, 2) : '-'}</span></div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Cabeças: <span className="font-semibold text-slate-900">{formatDecimal(ultimoEvento.total_cabecas_afetadas || 0, 0, true)}</span></div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Sobra: <span className="font-semibold text-slate-900">{formatKg(ultimoEvento.sobra_kg || 0)}</span></div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Peso consumo: <span className="font-semibold text-slate-900">{formatDecimal(ultimoEvento.peso_total_consumo || 0)}</span></div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Fechamento: <span className="font-semibold text-slate-900">{ultimoEvento.dias_periodo ? `${formatDecimal(ultimoEvento.dias_periodo, 0, true)} dia(s)` : "Em aberto"}</span></div>
              <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Novo fechamento: <span className="font-semibold text-slate-900">{ultimoEvento.dias_periodo ? new Date(new Date(ultimoEvento.data_lancamento).getTime() + ultimoEvento.dias_periodo * 86400000).toLocaleDateString("pt-BR") : "-"}</span></div>
            </div>
            {ultimoEvento.observacoes && <div className="break-words text-[10px] italic text-slate-500">{ultimoEvento.observacoes}</div>}
          </div> :

        <div className="text-xs text-slate-500">Nenhum lançamento ainda.</div>
        }
      </CardSection>

      <CardSection title="Informações do Cocho">
        <div className="space-y-1 text-[10px]">
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Depósito vinculado:</span><span className="font-semibold text-slate-900">{ponto.deposito_origem_nome || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Áreas vinculadas:</span><span className="font-semibold text-slate-900">{Array.isArray(ponto.area_vinculada_nomes) && ponto.area_vinculada_nomes.length > 0 ? ponto.area_vinculada_nomes.join(', ') : ponto.area_vinculada_nome || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Tipo:</span><span className="font-semibold text-slate-900">{ponto.tipo}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Produto padrão:</span><span className="font-semibold text-slate-900">{ponto.produto_padrao || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Capacidade:</span><span className="font-semibold text-slate-900">{ponto.capacidade_cocho_kg ? formatKg(ponto.capacidade_cocho_kg) : '-'}</span></div>
          {ponto.metragem_cocho_m && <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Metragem:</span><span className="font-semibold text-slate-900">{formatDecimal(ponto.metragem_cocho_m)} m</span></div>}
          {ponto.cobertura_cocho && <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Cobertura:</span><span className="font-semibold text-slate-900">{ponto.cobertura_cocho}</span></div>}
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Frequência mínima:</span><span className="font-semibold text-slate-900">{ponto.frequencia_esperada_dias_minimo ? `${formatDecimal(ponto.frequencia_esperada_dias_minimo, 0, true)} dia(s)` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Frequência máxima:</span><span className="font-semibold text-slate-900">{ponto.frequencia_esperada_dias_maximo ? `${formatDecimal(ponto.frequencia_esperada_dias_maximo, 0, true)} dia(s)` : ponto.frequencia_esperada_dias ? `${formatDecimal(ponto.frequencia_esperada_dias, 0, true)} dia(s)` : '-'}</span></div>

        </div>
      </CardSection>

      <Dialog open={showLancamento} onOpenChange={setShowLancamento}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto"><FormularioLancamentoSuplementacao ponto={ponto} onCancel={() => {setShowLancamento(false);handleSaved();}} /></DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="bg-background px-2 py-2 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Histórico do Cocho</DialogTitle></DialogHeader>
          <HistoricoSuplementacaoPonto pontoId={ponto.id} pontoNome={ponto.nome_ponto} ponto={ponto} />
        </DialogContent>
      </Dialog>
    </div>);

}

function CardInfo({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      <div className="text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-900 break-words leading-tight">{value}</div>
    </div>);

}

function CardSection({ title, children }) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
      <div className="text-[11px] font-bold text-slate-900">{title}</div>
      {children}
    </div>);

}