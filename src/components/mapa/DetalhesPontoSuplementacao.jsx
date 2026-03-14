import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioLancamentoSuplementacao from "../suplementacao/FormularioLancamentoSuplementacao";
import HistoricoSuplementacaoPonto from "../suplementacao/HistoricoSuplementacaoPonto";
import DetalhesDepositoSuplementacao from "./DetalhesDepositoSuplementacao";
import IndicadorCopoNivel from "../suplementacao/IndicadorCopoNivel";
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

  const { data: pontosReferencia = [] } = useQuery({
    queryKey: ["pontos-referencia-cocho-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoReferencia.list();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && item.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const referencia = useMemo(() => {
    return pontosReferencia.find((item) => normalizeText(item.nome) === normalizeText(ponto.nome_ponto)) || null;
  }, [pontosReferencia, ponto.nome_ponto]);

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
      <div className="flex items-start justify-between gap-3 pb-2 border-b">
        <div className="flex items-start gap-3">
          <IndicadorCopoNivel
            titulo="Nível do cocho"
            valor={`${Math.round((indicador?.percent || 0) * 100)}%`}
            subtitulo={indicador.helperLabel}
            percent={indicador.percent}
            cor="#10b981"
          />
          <div>
            <div className="text-sm font-bold text-slate-900 mb-1">{ponto.nome_ponto}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={ponto.status === "Ativo" ? "default" : "secondary"} className="text-xs">{ponto.status}</Badge>
              {ponto.deposito_origem_nome && <Badge variant="outline" className="text-xs">Depósito: {ponto.deposito_origem_nome}</Badge>}
              <Badge variant="outline" className="text-xs">{indicador.badgeLabel}</Badge>
              {temAlerta && <Badge className="bg-amber-100 text-amber-800 text-xs"><AlertCircle className="w-3 h-3 mr-1" />Alerta</Badge>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowLancamento(true)}>Lançar</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <CardInfo label="Área vinculada" value={ponto.area_vinculada_nome || "-"} />
        <CardInfo label="Capacidade" value={ponto.capacidade_cocho_kg ? `${ponto.capacidade_cocho_kg} kg` : "-"} />
        <CardInfo label="Último lançamento" value={ultimoEvento ? new Date(ultimoEvento.data_lancamento).toLocaleDateString("pt-BR") : "-"} />
        <CardInfo label="Total fornecido" value={`${totalFornecido.toFixed(1)} kg`} />
      </div>

      <CardSection title="Último Registro">
        {ultimoEvento ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[10px] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{ultimoEvento.produto}</span>
              <Badge variant="outline" className="text-xs">{ultimoEvento.quantidade_total_kg?.toFixed?.(2) || ultimoEvento.quantidade_total_kg} kg</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <div>Data: <span className="font-semibold text-slate-900">{new Date(ultimoEvento.data_lancamento).toLocaleDateString("pt-BR")}</span></div>
              <div>Cabeças: <span className="font-semibold text-slate-900">{ultimoEvento.total_cabecas_afetadas || 0}</span></div>
              <div>Sobra: <span className="font-semibold text-slate-900">{ultimoEvento.sobra_kg || 0} kg</span></div>
              <div>Peso consumo: <span className="font-semibold text-slate-900">{ultimoEvento.peso_total_consumo?.toFixed?.(2) || 0}</span></div>
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
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Frequência esperada:</span><span className="font-semibold text-slate-900">{ponto.frequencia_esperada_dias || 0} dia(s)</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Alerta sem lançamento:</span><span className="font-semibold text-slate-900">{ponto.alerta_sem_lancamento_dias || 0} dia(s)</span></div>
        </div>
      </CardSection>

      <Dialog open={showLancamento} onOpenChange={setShowLancamento}>
        <DialogContent className="max-w-2xl"><FormularioLancamentoSuplementacao ponto={ponto} onCancel={() => { setShowLancamento(false); handleSaved(); }} /></DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Histórico do Cocho</DialogTitle></DialogHeader>
          <HistoricoSuplementacaoPonto pontoId={ponto.id} pontoNome={ponto.nome_ponto} ponto={ponto} indicador={indicador} />
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