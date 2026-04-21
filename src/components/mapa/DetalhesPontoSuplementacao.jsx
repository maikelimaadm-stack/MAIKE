import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/components/offline/mapaOfflineCache";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioLancamentoSuplementacao from "../suplementacao/FormularioLancamentoSuplementacao";
import FormularioLancamentoSuplementacaoLote from "../suplementacao/FormularioLancamentoSuplementacaoLote";
import HistoricoSuplementacaoPonto from "../suplementacao/HistoricoSuplementacaoPonto";
import DetalhesDepositoSuplementacao from "./DetalhesDepositoSuplementacao";
import PontoPercentIcon from "./PontoPercentIcon";

import { formatDecimal, formatKg } from "../suplementacao/formatters";
import CardMetricaEvento from "../suplementacao/CardMetricaEvento";
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

export default function DetalhesPontoSuplementacao({ ponto, onClose, permissions = {} }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showLancamento, setShowLancamento] = useState(false);
  const [showLancamentoLote, setShowLancamentoLote] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const isDeposito = normalizeText(ponto?.categoria_ponto) === "DEPOSITO";

  const { data: eventos = [], isLoading: loadingEventos } = useQuery({
    queryKey: ["mapa-eventosSuplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('eventosSuplementacao', empresaSelecionadaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('eventosSuplementacao', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(["mapa-eventosSuplementacao", empresaSelecionadaId], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('eventosSuplementacao', empresaSelecionadaId);
      }
      return cached || [];
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 60 * 1000,
    select: (data) => data.filter(e => e.ponto_suplementacao_id === ponto.id).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["mapa-icones"],
    queryFn: async () => {
      const cached = await getMapaCachedData('icones', '__GLOBAL__');
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('icones', '__GLOBAL__').then(fresh => {
            if (fresh?.length) queryClient.setQueryData(["mapa-icones"], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('icones', '__GLOBAL__');
      }
      return cached || [];
    },
    staleTime: 10 * 60 * 1000
  });

  const { data: produtos = [], isLoading: loadingProdutos } = useQuery({
    queryKey: ["produtos-ponto-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      if (!navigator.onLine) {
        // Se estiver offline, retorna o que tiver na Query Cache do TanStack ou vazio
        return [];
      }
      const all = await base44.entities.Produto.list();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const { data: lotes = [], isLoading: loadingLotes } = useQuery({
    queryKey: ["mapa-lotes", empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('lotes', empresaSelecionadaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('lotes', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(["mapa-lotes", empresaSelecionadaId], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('lotes', empresaSelecionadaId);
      }
      return cached || [];
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 60 * 1000
  });

  const { data: pontos = [] } = useQuery({
    queryKey: ["pontos-suplementacao-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const { data: areas = [], isLoading: loadingAreas } = useQuery({
    queryKey: ["mapa-areas", empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('areas', empresaSelecionadaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('areas', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(["mapa-areas", empresaSelecionadaId], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('areas', empresaSelecionadaId);
      }
      return cached || [];
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
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
  const areaIdsRelacionadas = Array.isArray(ponto.area_vinculada_ids) && ponto.area_vinculada_ids.length > 0 ?
  ponto.area_vinculada_ids :
  ponto.area_vinculada_id ?
  [ponto.area_vinculada_id] :
  [];
  const areaNomesRelacionadas = useMemo(() => {
    const nomesPorId = new Map(areas.map((area) => [area.id, area.nome]));
    const nomesPorIds = areaIdsRelacionadas.map((id) => nomesPorId.get(id)).filter(Boolean);
    if (nomesPorIds.length > 0) return nomesPorIds;
    if (Array.isArray(ponto.area_vinculada_nomes) && ponto.area_vinculada_nomes.length > 0) return ponto.area_vinculada_nomes.filter(Boolean);
    return ponto.area_vinculada_nome ? [ponto.area_vinculada_nome] : [];
  }, [areas, areaIdsRelacionadas, ponto.area_vinculada_nomes, ponto.area_vinculada_nome]);
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
    // 1) %PV calculado dos lotes atuais
    const consumoPorPeso = consumoEsperadoGrupoDia(pesoMedioRelacionados, percentualProduto, totalCabecasRelacionadas);
    if (consumoPorPeso > 0) return consumoPorPeso;
    // 2) consumo_esperado_pv_kg salvo no evento (calculado no momento do lançamento)
    if (Number(ultimoEvento.consumo_esperado_pv_kg || 0) > 0) return Number(ultimoEvento.consumo_esperado_pv_kg);
    // 3) consumo ideal por cabeça cadastrado no ponto × cabeças
    const consumoIdealPonto = Number(ponto?.consumo_ideal_por_cabeca_kg || 0) * totalCabecasRelacionadas;
    if (consumoIdealPonto > 0) return consumoIdealPonto;
    return 0;
  }, [ultimoEvento, pesoMedioRelacionados, percentualProduto, totalCabecasRelacionadas, ponto]);
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
  const diasAlertaReposicao = Number(ponto.dias_alerta_reposicao || 3);
  const temAlerta = ponto.status === "Ativo" && (diasSemLancamento === null || diasSemLancamento >= Number(ponto.alerta_sem_lancamento_dias || 10));

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["eventos-ponto", "mapa-eventos-supl", "mapa-pontos-supl", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  const pontosMesmoTipo = useMemo(() => {
    return pontos
      .filter((item) => normalizeText(item.categoria_ponto) !== "DEPOSITO" && item.status === "Ativo")
      .sort((a, b) => (a.nome_ponto || "").localeCompare(b.nome_ponto || ""));
  }, [pontos]);

  if (isDeposito) {
    return <DetalhesDepositoSuplementacao deposito={ponto} permissions={permissions} onClose={onClose} />;
  }

  // Aguarda a leitura rápida do cache local
  const loadingInicial = (loadingEventos && eventos.length === 0) || (loadingLotes && lotes.length === 0) || (loadingAreas && areas.length === 0);

  if (loadingInicial) {
    return (
      <div className="space-y-1" translate="no">
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          <span className="text-xs font-medium text-slate-700">Carregando detalhes do cocho...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1" translate="no">
      <div className="pb-1 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">Local: {ponto.nome_ponto}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-1">
        {permissions.lancar_suplementacao !== false && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLancamento(true)}>Lançar</Button>}
        {permissions.lancar_suplementacao !== false && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLancamentoLote(true)}>Lançar em lote</Button>}
        {permissions.visualizar_historico_cocho !== false && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>}
      </div>

      {/* Saldo estimado no cocho */}
      {ultimoEvento && (() => {
        const sobra = Number(ultimoEvento.sobra_kg || 0);
        const fornecido = Number(ultimoEvento.quantidade_total_kg || 0);
        const diasDesde = diasSemLancamento || 0;
        // totalDisponivel = o que foi colocado no cocho neste lançamento (fornecido) + sobra do anterior
        const totalDisponivel = fornecido + sobra;
        const diasAlerta = Number(ponto.dias_alerta_reposicao || 3);
        const capacidadeCocho = Number(ponto.capacidade_cocho_kg || 0);

        // consumoBase: apenas via %PV calculado dos lotes atuais — NÃO usa consumo_diario_grupo_kg do evento
        // pois esse campo guarda o consumo do período FECHADO anterior, não o consumo diário esperado
        const consumoBase = consumoEsperadoDiaKg > 0 ? consumoEsperadoDiaKg : 0;

        let saldoEstimado;
        let baseDuracaoTotal;
        let diasRestantes;

        if (ultimoEvento.dias_periodo != null) {
          // Período fechado: saldo é a sobra registrada no fechamento
          saldoEstimado = sobra;
          baseDuracaoTotal = consumoBase > 0 ? Math.max(0, Math.round(totalDisponivel / consumoBase)) : Number(ultimoEvento.dias_periodo || 0);
          diasRestantes = consumoBase > 0 ? Math.max(0, Math.round(sobra / consumoBase)) : 0;
        } else if (consumoBase > 0) {
          // Período em aberto com %PV configurado: descontar dias desde o lançamento
          saldoEstimado = Math.max(0, totalDisponivel - consumoBase * diasDesde);
          baseDuracaoTotal = Math.max(0, Math.round(totalDisponivel / consumoBase));
          diasRestantes = Math.max(0, baseDuracaoTotal - diasDesde);
        } else {
          // Sem %PV configurado: não desconta, mostra total fornecido como saldo
          saldoEstimado = totalDisponivel;
          baseDuracaoTotal = 0;
          diasRestantes = 0;
        }

        const dataBaseLancamento = parseDateLocal(ultimoEvento.data_lancamento);
        const proximaData = dataBaseLancamento && baseDuracaoTotal > 0 ?
        new Date(dataBaseLancamento.getTime() + baseDuracaoTotal * 86400000) :
        null;

        // Gráfico 1: saldo consumo (quanto resta do fornecido neste ciclo)
        const percentConsumo = totalDisponivel > 0 ? Math.min(1, Math.max(0, saldoEstimado / totalDisponivel)) : 0;
        // Gráfico 2: saldo capacidade (quanto ocupa da capacidade física do cocho)
        const percentCapacidade = capacidadeCocho > 0 ? Math.min(1, Math.max(0, saldoEstimado / capacidadeCocho)) : null;

        const alertaGrafico = diasRestantes > 0 && diasRestantes <= diasAlerta;

        return (
          <CardSection title="Saldo estimado no cocho">
            <div className="my-1 grid grid-cols-1 md:grid-cols-[auto,1fr] gap-1 items-center">
              <div className="pb-1 flex flex-col gap-1">
                <div className="flex items-end gap-3">
                  {/* Gráfico 1: Consumo estimado */}
                  <div className="flex flex-col items-center gap-0.5" title="Saldo do ciclo">
                    <PontoPercentIcon
                      imageUrl={iconeExibicao}
                      label={ponto.categoria_ponto || "Cocho"}
                      percent={percentConsumo}
                      fillClassName={alertaGrafico ? "bg-red-500" : "bg-lime-400"} />
                  </div>
                  {/* Gráfico 2: Capacidade física (só se capacidade cadastrada) */}
                  {percentCapacidade !== null &&
                  <div className="flex flex-col items-center gap-0.5" title="Capacidade do cocho">
                      <PontoPercentIcon
                      imageUrl={null}
                      label="Capacidade"
                      percent={percentCapacidade}
                      fillClassName={percentCapacidade < 0.2 ? "bg-red-400" : "bg-blue-400"}
                      hideImageArea={true} />
                    </div>
                  }
                </div>
                <div className="flex items-center gap-3 pl-1">
                  <div className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${alertaGrafico ? "bg-red-500" : "bg-lime-400"}`} />
                    <span className="text-[8px] text-slate-500">Saldo ciclo</span>
                  </div>
                  {percentCapacidade !== null &&
                  <div className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${percentCapacidade < 0.2 ? "bg-red-400" : "bg-blue-400"}`} />
                      <span className="text-[8px] text-slate-500">Capac. cocho</span>
                    </div>
                  }
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Saldo estimado</div>
                  <div className="text-sm font-bold text-slate-900">{formatKg(saldoEstimado)}</div>
                  {consumoBase > 0 && <div className="text-[11px] text-slate-600 mt-0.5">{formatKg(consumoBase)}/dia</div>}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Duração estimada</div>
                  <div className="text-sm font-bold text-slate-900">{baseDuracaoTotal > 0 ? `${formatDecimal(baseDuracaoTotal, 0, true)} dia(s)` : '-'}</div>
                  {diasRestantes > 0 && <div className="text-[11px] text-slate-600 mt-0.5">Restam {formatDecimal(diasRestantes, 0, true)} dia(s)</div>}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Próxima Reposição</div>
                  <div className="text-sm font-bold text-slate-900">{proximaData ? proximaData.toLocaleDateString('pt-BR') : '-'}</div>
                </div>
              </div>
            </div>
          </CardSection>);

      })()}

      <CardSection title="Total Fornecido por Produto">
        {resumoProdutos.length === 0 ?
        <div className="text-xs text-slate-500">Nenhum produto lançado ainda.</div> :

        <div className="space-y-1">
            {resumoProdutos.map((item) =>
          <div key={item.produto} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                  <div className="truncate font-medium text-slate-900">{item.produto}</div>
                  <div className="whitespace-nowrap font-semibold text-slate-900">{item.sacos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos</div>
                  <div className="whitespace-nowrap font-semibold text-slate-900">{formatKg(item.kg)}</div>
                </div>
              </div>
          )}
          </div>
        }
      </CardSection>

      <CardSection title="Último Registro">
        {ultimoEvento ? (() => {
          const totalDisp = Number(ultimoEvento.quantidade_total_kg || 0) + Number(ultimoEvento.sobra_kg || 0);
          const durEst = consumoEsperadoDiaKg > 0 ? Math.round(totalDisp / consumoEsperadoDiaKg) : 0;
          const dataBase = parseDateLocal(ultimoEvento.data_lancamento);
          const proxReposicao = durEst > 0 && dataBase ? new Date(dataBase.getTime() + durEst * 86400000).toLocaleDateString("pt-BR") : null;
          return (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-1 text-[11px] space-y-0">
            <div className="flex items-center justify-between">
              <div className="font-semibold leading-tight text-slate-900">{ultimoEvento.produto}</div>
              <span className="text-slate-500 px-1">Data: {formatDateBR(ultimoEvento.data_lancamento)}</span>
            </div>
            <CardMetricaEvento
                evento={ultimoEvento}
                consumoEsperadoDiaKg={consumoEsperadoDiaKg}
                sacos={ultimoEventoSacos}
                showProjecao={true}
                duracaoEstimada={durEst}
                proximaReposicao={proxReposicao} />
              
            {ultimoEvento.observacoes && <div className="break-words text-[10px] italic text-slate-500">{ultimoEvento.observacoes}</div>}
          </div>);
        })() :
        <div className="text-xs text-slate-500">Nenhum lançamento ainda.</div>
        }
      </CardSection>

      <CardSection title="Informações do Cocho">
        <div className="space-y-1 text-[10px]">
          







          
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Número:</span><span className="font-semibold text-slate-900">{ponto.numero_ponto || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Sigla:</span><span className="font-semibold text-slate-900">{ponto.sigla || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Tipo:</span><span className="font-semibold text-slate-900">{ponto.tipo || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Depósito vinculado:</span><span className="font-semibold text-slate-900">{ponto.deposito_origem_nome || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Áreas vinculadas:</span><span className="font-semibold text-slate-900">{areaNomesRelacionadas.join(', ') || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Produto padrão:</span><span className="font-semibold text-slate-900">{ponto.produto_padrao || '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Capacidade:</span><span className="font-semibold text-slate-900">{ponto.capacidade_cocho_kg ? formatKg(ponto.capacidade_cocho_kg) : '-'}</span></div>
          {ponto.metragem_cocho_m && <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Metragem:</span><span className="font-semibold text-slate-900">{formatDecimal(ponto.metragem_cocho_m)} m</span></div>}
          {ponto.cobertura_cocho && <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Cobertura:</span><span className="font-semibold text-slate-900">{ponto.cobertura_cocho}</span></div>}
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Consumo ideal/cab:</span><span className="font-semibold text-slate-900">{ponto.consumo_ideal_por_cabeca_kg ? `${formatDecimal(ponto.consumo_ideal_por_cabeca_kg, 3)} kg` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Limite mínimo:</span><span className="font-semibold text-slate-900">{ponto.limite_minimo_consumo ? `${formatDecimal(ponto.limite_minimo_consumo, 3)} kg` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Limite máximo:</span><span className="font-semibold text-slate-900">{ponto.limite_maximo_consumo ? `${formatDecimal(ponto.limite_maximo_consumo, 3)} kg` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Dias alerta reposição:</span><span className="font-semibold text-slate-900">{ponto.dias_alerta_reposicao ? `${formatDecimal(ponto.dias_alerta_reposicao, 0, true)} dia(s)` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Alerta sem lançamento:</span><span className="font-semibold text-slate-900">{ponto.alerta_sem_lancamento_dias ? `${formatDecimal(ponto.alerta_sem_lancamento_dias, 0, true)} dia(s)` : '-'}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Observações:</span><span className="font-semibold text-slate-900 break-words">{ponto.observacoes || '-'}</span></div>
        </div>
      </CardSection>

      <Dialog open={showLancamento} onOpenChange={setShowLancamento}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto overflow-x-hidden"><FormularioLancamentoSuplementacao ponto={ponto} onCancel={() => {setShowLancamento(false);handleSaved();}} /></DialogContent>
      </Dialog>

      <Dialog open={showLancamentoLote} onOpenChange={setShowLancamentoLote}>
        <DialogContent className="max-w-[980px] max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <FormularioLancamentoSuplementacaoLote
            pontos={pontosMesmoTipo}
            onCancel={() => setShowLancamentoLote(false)}
            onSaved={() => { setShowLancamentoLote(false); handleSaved(); }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="bg-background px-2 py-2 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto">
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