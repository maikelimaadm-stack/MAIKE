import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioLancamentoSuplementacao from "../suplementacao/FormularioLancamentoSuplementacao";
import HistoricoSuplementacaoPonto from "../suplementacao/HistoricoSuplementacaoPonto";
import DetalhesDepositoSuplementacao from "./DetalhesDepositoSuplementacao";

import { formatDecimal, formatKg } from "../suplementacao/formatters";
import { getCochoIndicator } from "./pontoStatusUtils";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";

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
    enabled: !!empresaSelecionadaId && !!ponto?.id,
  });

  const indicador = useMemo(() => getCochoIndicator(ponto, eventos), [ponto, eventos]);
  const ultimoEvento = indicador.latestRecord;
  const diasSemLancamento = ultimoEvento ? Math.floor((new Date() - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24)) : null;
  const totalFornecido = eventos.reduce((total, evento) => total + (evento.quantidade_total_kg || 0), 0);
  const temAlerta = ponto.status === "Ativo" && (diasSemLancamento === null || diasSemLancamento > (ponto.alerta_sem_lancamento_dias || 10));

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["eventos-ponto", "mapa-eventos-supl", "mapa-pontos-supl", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  if (isDeposito) {
    return <DetalhesDepositoSuplementacao deposito={ponto} onClose={onClose} />;
  }

  return (
    <div className="space-y-4" translate="no">
      <div className="pb-2 border-b space-y-2">
        <div className="text-sm font-bold text-slate-900">{ponto.nome_ponto}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs text-slate-700 border-slate-300 bg-white">{ponto.status}</Badge>
          {ponto.deposito_origem_nome && <Badge variant="outline" className="text-xs text-slate-700 border-slate-300 bg-white">Depósito: {ponto.deposito_origem_nome}</Badge>}
          <Badge variant="outline" className="text-xs text-slate-700 border-slate-300 bg-white">{indicador.badgeLabel}</Badge>
          <Badge variant="outline" className="text-xs text-slate-700 border-slate-300 bg-white">Nível estimado: {Math.round((indicador?.percent || 0) * 100)}%</Badge>
          {temAlerta && <Badge variant="outline" className="text-xs text-slate-700 border-slate-300 bg-white">Alerta</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLancamento(true)}>Lançar</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <CardInfo label="Áreas vinculadas" value={
          (Array.isArray(ponto.area_vinculada_nomes) && ponto.area_vinculada_nomes.length > 0)
            ? ponto.area_vinculada_nomes.join(", ")
            : ponto.area_vinculada_nome || "-"
        } />
        <CardInfo label="Capacidade" value={ponto.capacidade_cocho_kg ? formatKg(ponto.capacidade_cocho_kg) : "-"} />
        <CardInfo label="Último lançamento" value={ultimoEvento ? new Date(ultimoEvento.data_lancamento).toLocaleDateString("pt-BR") : "-"} />
        <CardInfo label="Total fornecido" value={formatKg(totalFornecido)} />
      </div>

      {/* Saldo estimado no cocho */}
      {ultimoEvento && (() => {
        const sobra = ultimoEvento.sobra_kg || 0;
        const fornecido = ultimoEvento.quantidade_total_kg || 0;
        const consumoDiario = ultimoEvento.consumo_diario_grupo_kg || 0;
        const diasDesde = diasSemLancamento || 0;
        let saldoEstimado;
        if (ultimoEvento.dias_periodo != null) {
          saldoEstimado = sobra;
        } else {
          const totalDisponivel = fornecido + sobra;
          const consumoEstimado = consumoDiario > 0 ? consumoDiario : (totalDisponivel / (ponto.frequencia_esperada_dias || 7));
          saldoEstimado = Math.max(0, totalDisponivel - (consumoEstimado * diasDesde));
        }
        const percentual = ponto.capacidade_cocho_kg > 0 ? Math.min(1, saldoEstimado / ponto.capacidade_cocho_kg) : 0;
        return (
          <CardSection title="Saldo estimado no cocho">
            <div className="space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Saldo estimado</div>
                  <div className="text-sm font-bold text-slate-900">{formatKg(saldoEstimado)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Capacidade</div>
                  <div className="text-sm font-bold text-slate-900">{ponto.capacidade_cocho_kg ? formatKg(ponto.capacidade_cocho_kg) : '-'}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Nível estimado</div>
                  <div className="text-sm font-bold text-slate-900">{Math.round(percentual * 100)}%</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-slate-500">Base</div>
                  <div className="text-sm font-bold text-slate-900">{ultimoEvento.dias_periodo != null ? 'Último fechamento' : `~${diasDesde} dia(s)`}</div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-slate-500">Gráfico de ocupação</span>
                  <span className="font-semibold text-slate-900">{Math.round(percentual * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full rounded-full bg-slate-600 transition-all" style={{ width: `${Math.round(percentual * 100)}%` }} />
                </div>
              </div>
            </div>
          </CardSection>
        );
      })()}

      <CardSection title="Último Registro">
        {ultimoEvento ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[10px] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{ultimoEvento.produto}</span>
              <Badge variant="outline" className="text-xs">{formatKg(ultimoEvento.quantidade_total_kg || 0)}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <div>Data: <span className="font-semibold text-slate-900">{new Date(ultimoEvento.data_lancamento).toLocaleDateString("pt-BR")}</span></div>
              <div>Cabeças: <span className="font-semibold text-slate-900">{formatDecimal(ultimoEvento.total_cabecas_afetadas || 0, 0, true)}</span></div>
              <div>Sobra: <span className="font-semibold text-slate-900">{formatKg(ultimoEvento.sobra_kg || 0)}</span></div>
              <div>Peso consumo: <span className="font-semibold text-slate-900">{formatDecimal(ultimoEvento.peso_total_consumo || 0)}</span></div>
              <div>Fechamento: <span className="font-semibold text-slate-900">{ultimoEvento.dias_periodo ? `${formatDecimal(ultimoEvento.dias_periodo, 0, true)} dia(s)` : "Em aberto"}</span></div>
              <div>Novo fechamento: <span className="font-semibold text-slate-900">{ultimoEvento.dias_periodo ? new Date(new Date(ultimoEvento.data_lancamento).getTime() + (ultimoEvento.dias_periodo * 86400000)).toLocaleDateString("pt-BR") : "-"}</span></div>
            </div>
            {ultimoEvento.observacoes && <div className="text-slate-500 italic">{ultimoEvento.observacoes}</div>}
          </div>
        ) : (
          <div className="text-xs text-slate-500">Nenhum lançamento ainda.</div>
        )}
      </CardSection>

      <CardSection title="Informações do Cocho">
        <div className="space-y-1.5 text-[10px]">
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Tipo:</span><span className="font-semibold text-slate-900">{ponto.tipo}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Produto padrão:</span><span className="font-semibold text-slate-900">{ponto.produto_padrao || "-"}</span></div>
          {ponto.metragem_cocho_m && <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Metragem:</span><span className="font-semibold text-slate-900">{formatDecimal(ponto.metragem_cocho_m)} m</span></div>}
          {ponto.cobertura_cocho && <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Cobertura:</span><span className="font-semibold text-slate-900">{ponto.cobertura_cocho}</span></div>}
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Frequência esperada:</span><span className="font-semibold text-slate-900">{formatDecimal(ponto.frequencia_esperada_dias || 0, 0, true)} dia(s)</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Alerta sem lançamento:</span><span className="font-semibold text-slate-900">{formatDecimal(ponto.alerta_sem_lancamento_dias || 0, 0, true)} dia(s)</span></div>
        </div>
      </CardSection>

      <Dialog open={showLancamento} onOpenChange={setShowLancamento}>
        <DialogContent className="max-w-[880px]"><FormularioLancamentoSuplementacao ponto={ponto} onCancel={() => { setShowLancamento(false); handleSaved(); }} /></DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Histórico do Cocho</DialogTitle></DialogHeader>
          <HistoricoSuplementacaoPonto pontoId={ponto.id} pontoNome={ponto.nome_ponto} ponto={ponto} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CardInfo({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function CardSection({ title, children }) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-3 space-y-2">
      <div className="text-[11px] font-bold text-slate-900">{title}</div>
      {children}
    </div>
  );
}