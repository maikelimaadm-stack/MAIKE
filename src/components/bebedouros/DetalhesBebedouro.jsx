import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useBebedouroHistorico } from "@/hooks/useBebedouroHistorico";
import { useBebedouroSanidade } from "@/hooks/useBebedouroSanidade";
import BebedouroStatusBadge from "./BebedouroStatusBadge";
import BebedouroTimeline from "./BebedouroTimeline";
import FormularioLancamentoBebedouro from "./FormularioLancamentoBebedouro";
import FormularioSanidadeBebedouro from "./FormularioSanidadeBebedouro";
import { buildBebedouroAlertas, getBebedouroStatusVisual } from "@/services/bebedouroService";

export default function DetalhesBebedouro({ bebedouro }) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const [showLancamento, setShowLancamento] = useState(false);
  const [showSanidade, setShowSanidade] = useState(false);
  const { data: historico = [] } = useBebedouroHistorico(empresaId, bebedouro?.id);
  const { data: sanidade = [] } = useBebedouroSanidade(empresaId, bebedouro?.id);
  const visual = useMemo(() => getBebedouroStatusVisual({ bebedouro, historico, sanidade }), [bebedouro, historico, sanidade]);
  const alertas = useMemo(() => buildBebedouroAlertas(bebedouro, historico, sanidade), [bebedouro, historico, sanidade]);
  const ultimoSanitario = sanidade[0];
  const custoTotal = historico.reduce((sum, item) => sum + Number(item.custo || 0), 0);

  return (
    <div className="space-y-2" translate="no">
      <div className="flex items-center gap-2 flex-wrap border-b pb-2">
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Bebedouro: {bebedouro.nome}</Badge>
        <BebedouroStatusBadge visual={visual} />
        <Badge variant="outline" className="text-xs">{bebedouro.tipo}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Info label="Capacidade" value={bebedouro.capacidade_litros ? `${Number(bebedouro.capacidade_litros).toLocaleString("pt-BR")} L` : "-"} />
        <Info label="Origem da água" value={bebedouro.origem_agua || "-"} />
        <Info label="Pasto" value={bebedouro.pasto_nome || "-"} />
        <Info label="Custo acumulado" value={`R$ ${custoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
      </div>

      {alertas.length > 0 && <Card className="border-red-200 bg-red-50"><CardContent className="p-2 space-y-1">{alertas.map((alerta, idx) => <div key={idx} className="text-xs text-red-800 font-medium">• {alerta.descricao}</div>)}</CardContent></Card>}

      <div className="grid grid-cols-2 gap-1">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLancamento(true)}>Lançar</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowSanidade(true)}>Sanidade da água</Button>
      </div>

      <Card className="border-slate-200 shadow-sm"><CardContent className="p-2 space-y-1">
        <div className="text-[11px] font-bold text-slate-900">Última avaliação sanitária</div>
        {ultimoSanitario ? <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]"><Info label="Risco" value={ultimoSanitario.nivel_risco} /><Info label="Cor" value={ultimoSanitario.cor_agua || "-"} /><Info label="Odor" value={ultimoSanitario.odor || "-"} /><Info label="Turbidez" value={ultimoSanitario.turbidez || "-"} /></div> : <div className="text-xs text-slate-500">Nenhuma avaliação registrada.</div>}
      </CardContent></Card>

      <Card className="border-slate-200 shadow-sm"><CardContent className="p-2 space-y-2"><div className="text-[11px] font-bold text-slate-900">Histórico do Bebedouro</div><BebedouroTimeline historico={historico} /></CardContent></Card>

      <Card className="border-slate-200 shadow-sm"><CardContent className="p-2 space-y-1 text-xs"><div className="text-[11px] font-bold text-slate-900">Informações</div><div>Código: <b>{bebedouro.codigo_interno || "-"}</b></div><div>Status: <b>{bebedouro.status}</b></div><div>Observações: <b>{bebedouro.observacoes || "-"}</b></div></CardContent></Card>

      <Dialog open={showLancamento} onOpenChange={setShowLancamento}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="text-sm">Novo lançamento do bebedouro</DialogTitle></DialogHeader><FormularioLancamentoBebedouro bebedouro={bebedouro} onCancel={() => setShowLancamento(false)} onSaved={() => setShowLancamento(false)} /></DialogContent></Dialog>
      <Dialog open={showSanidade} onOpenChange={setShowSanidade}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="text-sm">Sanidade da água</DialogTitle></DialogHeader><FormularioSanidadeBebedouro bebedouro={bebedouro} onCancel={() => setShowSanidade(false)} onSaved={() => setShowSanidade(false)} /></DialogContent></Dialog>
    </div>
  );
}

function Info({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] text-slate-500">{label}</div><div className="text-xs font-bold text-slate-900 break-words">{value}</div></div>;
}