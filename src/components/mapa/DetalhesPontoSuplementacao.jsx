import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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

  if (isDeposito) return <DetalhesDepositoSuplementacao deposito={ponto} onClose={onClose} />;

  return (
    <div className="space-y-3" translate="no">
      {/* Header */}
      <div className="pb-2 border-b">
        <div className="text-sm font-bold text-slate-900">{ponto.nome_ponto}</div>
        <div className="text-[10px] text-slate-500">
          {ponto.status} · {ponto.deposito_origem_nome ? `Depósito: ${ponto.deposito_origem_nome}` : "Sem depósito"}
          {temAlerta && " · Alerta: sem lançamento"}
        </div>
      </div>

      {/* Botões */}
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLancamento(true)}>Lançar</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-1.5">
        <InfoBox label="Áreas" value={(Array.isArray(ponto.area_vinculada_nomes) && ponto.area_vinculada_nomes.length > 0) ? ponto.area_vinculada_nomes.join(", ") : ponto.area_vinculada_nome || "-"} />
        <InfoBox label="Capacidade" value={ponto.capacidade_cocho_kg ? formatKg(ponto.capacidade_cocho_kg) : "-"} />
        <InfoBox label="Último lançamento" value={ultimoEvento ? new Date(ultimoEvento.data_lancamento).toLocaleDateString("pt-BR") : "-"} />
        <InfoBox label="Total fornecido" value={formatKg(totalFornecido)} />
      </div>

      {/* Saldo estimado */}
      {ultimoEvento && (() => {
        const sobra = ultimoEvento.sobra_kg || 0;
        const fornecido = ultimoEvento.quantidade_total_kg || 0;
        const consumoDiario = ultimoEvento.consumo_diario_grupo_kg || 0;
        const diasDesde = diasSemLancamento || 0;
        let saldoEstimado;
        if (ultimoEvento.dias_periodo != null) { saldoEstimado = sobra; }
        else { const totalDisponivel = fornecido + sobra; const consumoEstimado = consumoDiario > 0 ? consumoDiario : (totalDisponivel / (ponto.frequencia_esperada_dias || 7)); saldoEstimado = Math.max(0, totalDisponivel - (consumoEstimado * diasDesde)); }
        return (
          <div className="border border-slate-200 rounded p-2">
            <div className="text-[10px] text-slate-500">Saldo estimado no cocho</div>
            <div className="text-sm font-bold text-slate-900">{formatKg(saldoEstimado)}</div>
            <div className="text-[9px] text-slate-400">{ultimoEvento.dias_periodo != null ? "Sobra do último fechamento" : `~${diasDesde} dia(s) desde lançamento`}</div>
          </div>
        );
      })()}

      {/* Último registro */}
      <div className="border border-slate-200 rounded p-2.5">
        <div className="text-[11px] font-bold text-slate-900 mb-1.5">Último Registro</div>
        {ultimoEvento ? (
          <div className="text-[10px] space-y-1 text-slate-600">
            <div className="flex justify-between"><span className="font-semibold text-slate-900">{ultimoEvento.produto}</span><span className="font-semibold text-slate-900">{formatKg(ultimoEvento.quantidade_total_kg || 0)}</span></div>
            <div>Data: <span className="font-semibold text-slate-900">{new Date(ultimoEvento.data_lancamento).toLocaleDateString("pt-BR")}</span></div>
            <div>Cabeças: <span className="font-semibold text-slate-900">{formatDecimal(ultimoEvento.total_cabecas_afetadas || 0, 0, true)}</span></div>
            <div>Sobra: <span className="font-semibold text-slate-900">{formatKg(ultimoEvento.sobra_kg || 0)}</span></div>
            <div>Fechamento: <span className="font-semibold text-slate-900">{ultimoEvento.dias_periodo ? `${ultimoEvento.dias_periodo} dia(s)` : "Em aberto"}</span></div>
            {ultimoEvento.observacoes && <div className="text-slate-500">{ultimoEvento.observacoes}</div>}
          </div>
        ) : (
          <div className="text-[10px] text-slate-500">Nenhum lançamento.</div>
        )}
      </div>

      {/* Info do cocho */}
      <div className="border border-slate-200 rounded p-2.5">
        <div className="text-[11px] font-bold text-slate-900 mb-1.5">Informações do Cocho</div>
        <div className="space-y-0.5 text-[10px] text-slate-600">
          <div>Tipo: <span className="font-semibold text-slate-900">{ponto.tipo}</span></div>
          <div>Produto padrão: <span className="font-semibold text-slate-900">{ponto.produto_padrao || "-"}</span></div>
          {ponto.metragem_cocho_m && <div>Metragem: <span className="font-semibold text-slate-900">{formatDecimal(ponto.metragem_cocho_m)} m</span></div>}
          {ponto.cobertura_cocho && <div>Cobertura: <span className="font-semibold text-slate-900">{ponto.cobertura_cocho}</span></div>}
          <div>Frequência: <span className="font-semibold text-slate-900">{formatDecimal(ponto.frequencia_esperada_dias || 0, 0, true)} dia(s)</span></div>
        </div>
      </div>

      {/* Dialogs */}
      <Dialog open={showLancamento} onOpenChange={setShowLancamento}>
        <DialogContent className="max-w-2xl"><FormularioLancamentoSuplementacao ponto={ponto} onCancel={() => { setShowLancamento(false); handleSaved(); }} /></DialogContent>
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

function InfoBox({ label, value }) {
  return (
    <div className="border border-slate-200 rounded p-2">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-[11px] font-bold text-slate-900">{value}</div>
    </div>
  );
}