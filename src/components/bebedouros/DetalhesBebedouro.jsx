import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useBebedouroHistorico } from "@/hooks/useBebedouroHistorico";
import { useBebedouroSanidade } from "@/hooks/useBebedouroSanidade";
import BebedouroStatusBadge from "./BebedouroStatusBadge";
import BebedouroTimeline from "./BebedouroTimeline";
import FormularioLancamentoBebedouro from "./FormularioLancamentoBebedouro";
import { buildBebedouroAlertas, getBebedouroStatusVisual } from "@/services/bebedouroService";

const formatDecimal = (value, digits = 2) => Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const formatDateBR = (value) => value ? new Date(`${String(value).split("T")[0]}T00:00:00`).toLocaleDateString("pt-BR") : "-";

export default function DetalhesBebedouro({ bebedouro }) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const [showLancamento, setShowLancamento] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const registroReal = Boolean(bebedouro?.id && !String(bebedouro.id).startsWith("ponto-"));
  const { data: historico = [] } = useBebedouroHistorico(empresaId, registroReal ? bebedouro?.id : null);
  const { data: sanidade = [] } = useBebedouroSanidade(empresaId, registroReal ? bebedouro?.id : null);
  const visual = useMemo(() => getBebedouroStatusVisual({ bebedouro, historico, sanidade }), [bebedouro, historico, sanidade]);
  const alertas = useMemo(() => buildBebedouroAlertas(bebedouro, historico, sanidade), [bebedouro, historico, sanidade]);
  const ultimoSanitario = historico.find((item) => item.nivel_risco || item.cor_agua || item.presenca_contaminacao) || sanidade[0];
  const ultimoLancamento = historico[0];
  const custoTotal = historico.reduce((sum, item) => sum + Number(item.custo || 0), 0);
  const nomesPastos = Array.isArray(bebedouro.area_vinculada_nomes) && bebedouro.area_vinculada_nomes.length ? bebedouro.area_vinculada_nomes : bebedouro.pasto_nome ? [bebedouro.pasto_nome] : [];

  return (
    <div className="space-y-1" translate="no">
      <div className="pb-1 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">Local: {bebedouro.nome}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLancamento(true)} disabled={!registroReal}>Lançar</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>
      </div>

      {!registroReal && <CardSection title="Atenção"><div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800 font-medium">Este ponto ainda não possui cadastro técnico completo de bebedouro. Edite o ponto no cadastro do mapa e salve para liberar lançamentos e sanidade.</div></CardSection>}

      {alertas.length > 0 && <CardSection title="Alertas"><div className="space-y-1">{alertas.map((alerta, idx) => <div key={idx} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800 font-medium">• {alerta.descricao}</div>)}</div></CardSection>}

      <CardSection title="Condição do Bebedouro">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
          <MetricBox label="Capacidade" value={bebedouro.capacidade_litros ? `${Number(bebedouro.capacidade_litros).toLocaleString("pt-BR")} L` : "-"} />
          <MetricBox label="Origem da água" value={bebedouro.origem_agua || "-"} />
          <MetricBox label="Último lançamento" value={ultimoLancamento ? formatDateBR(ultimoLancamento.data_lancamento) : "-"} />
        </div>
      </CardSection>

      <CardSection title="Sanidade da água">
        {ultimoSanitario ? <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]"><MetricBox label="Risco" value={ultimoSanitario.nivel_risco || "-"} /><MetricBox label="Cor" value={ultimoSanitario.cor_agua || "-"} /><MetricBox label="Turbidez" value={ultimoSanitario.turbidez || "-"} /></div> : <div className="text-xs text-slate-500">Nenhuma avaliação registrada.</div>}
      </CardSection>

      <CardSection title="Último Registro">
        {ultimoLancamento ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-1 text-[11px] space-y-1">
            <div className="flex items-center justify-between gap-2"><div className="font-semibold leading-tight text-slate-900">{ultimoLancamento.tipo_lancamento}</div><span className="text-slate-500 px-1">Data: {formatDateBR(ultimoLancamento.data_lancamento)}</span></div>
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              <MetricBox label="Status" value={ultimoLancamento.status || "-"} />
              <MetricBox label="Custo" value={ultimoLancamento.custo ? `R$ ${formatDecimal(ultimoLancamento.custo)}` : "-"} />
            </div>
            {(ultimoLancamento.produto_utilizado || ultimoLancamento.quantidade_utilizada) && <div className="grid grid-cols-2 gap-1 text-[10px]"><MetricBox label="Produto" value={ultimoLancamento.produto_utilizado || "-"} /><MetricBox label="Quantidade" value={ultimoLancamento.quantidade_utilizada || "-"} /></div>}
            {ultimoLancamento.descricao && <div className="break-words text-[10px] italic text-slate-500 mt-1">{ultimoLancamento.descricao}</div>}
          </div>
        ) : <div className="text-xs text-slate-500">Nenhum lançamento ainda.</div>}
      </CardSection>

      <CardSection title="Informações do Bebedouro">
        <div className="space-y-1 text-[10px]">
          <InfoLine label="Número" value={bebedouro.codigo_interno || "-"} />
          <InfoLine label="Tipo" value={bebedouro.tipo || "-"} />
          <InfoLine label="Status" value={bebedouro.status || "-"} />
          <InfoLine label="Áreas vinculadas" value={nomesPastos.join(", ") || "-"} />
          <InfoLine label="Rotina limpeza" value={bebedouro.dias_limpeza_personalizado ? `${bebedouro.dias_limpeza_personalizado} dia(s)` : bebedouro.periodicidade_limpeza || "-"} />
          <InfoLine label="Rotina inspeção" value={bebedouro.dias_inspecao_personalizado ? `${bebedouro.dias_inspecao_personalizado} dia(s)` : bebedouro.periodicidade_inspecao || "-"} />
          <InfoLine label="Custo acumulado" value={`R$ ${formatDecimal(custoTotal)}`} />
          <InfoLine label="Observações" value={bebedouro.observacoes || "-"} />
        </div>
      </CardSection>

      <Dialog open={showLancamento} onOpenChange={setShowLancamento}><DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto overflow-x-hidden"><FormularioLancamentoBebedouro bebedouro={bebedouro} onCancel={() => setShowLancamento(false)} onSaved={() => setShowLancamento(false)} /></DialogContent></Dialog>
      <Dialog open={showHistorico} onOpenChange={setShowHistorico}><DialogContent className="bg-background px-2 py-2 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg sm:rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto"><CardSection title="Histórico do Bebedouro"><BebedouroTimeline historico={historico} /></CardSection></DialogContent></Dialog>
    </div>
  );
}

function MetricBox({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"><div className="text-slate-500">{label}</div><div className="text-sm font-bold text-slate-900 break-words leading-tight">{value}</div></div>;
}

function CardSection({ title, children }) {
  return <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1"><div className="text-[11px] font-bold text-slate-900">{title}</div>{children}</div>;
}

function InfoLine({ label, value }) {
  return <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">{label}:</span><span className="font-semibold text-slate-900 break-words">{value}</span></div>;
}