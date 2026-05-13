import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useBebedouroHistorico } from "@/hooks/useBebedouroHistorico";
import { useBebedouroSanidade } from "@/hooks/useBebedouroSanidade";
import BebedouroTimeline from "./BebedouroTimeline";
import FormularioLancamentoBebedouro from "./FormularioLancamentoBebedouro";

const formatDecimal = (value, digits = 2) => Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const formatDateBR = (value) => value ? new Date(`${String(value).split("T")[0]}T00:00:00`).toLocaleDateString("pt-BR") : "-";
const addDaysToDate = (value, days) => {
  if (!value || !days) return "-";
  const date = new Date(`${String(value).split("T")[0]}T00:00:00`);
  date.setDate(date.getDate() + Number(days));
  return date.toLocaleDateString("pt-BR");
};
const getPeriodDays = (periodicidade, personalizado) => {
  if (periodicidade === "Personalizado") return Number(personalizado || 0);
  if (periodicidade === "Semanal") return 7;
  if (periodicidade === "Quinzenal") return 15;
  if (periodicidade === "Mensal") return 30;
  return 0;
};
const normalizeText = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

export default function DetalhesBebedouro({ bebedouro }) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const [showLancamento, setShowLancamento] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const registroReal = Boolean(bebedouro?.id);
  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones-bebedouro-detalhe", empresaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((item) => item.ativo !== false && item.tipo_entidade === "Ponto");
    },
    enabled: !!empresaId,
    staleTime: 10 * 60 * 1000
  });
  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-bebedouro-detalhe", empresaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((lote) => lote.empresa_id === empresaId && lote.status === "Ativo");
    },
    enabled: !!empresaId,
    staleTime: 60 * 1000
  });
  const { data: historico = [] } = useBebedouroHistorico(empresaId, registroReal ? bebedouro?.id : null);
  const { data: sanidade = [] } = useBebedouroSanidade(empresaId, registroReal ? bebedouro?.id : null);
  const ultimoSanitario = historico.find((item) => item.nivel_risco || item.cor_agua || item.presenca_contaminacao) || sanidade[0];
  const ultimoLancamento = historico[0];
  const custoTotal = historico.reduce((sum, item) => sum + Number(item.custo || 0), 0);
  const iconePonto = useMemo(() => {
    const tipoBebedouro = normalizeText(bebedouro?.tipo || "");
    const nomeBebedouro = normalizeText(bebedouro?.nome || "");
    return iconesConfig.find((item) => {
      const categoriaIcone = normalizeText(item.categoria || "");
      if (categoriaIcone === "BEBEDOURO") return true;
      if (categoriaIcone && tipoBebedouro.includes(categoriaIcone)) return true;
      if (categoriaIcone && nomeBebedouro.includes(categoriaIcone)) return true;
      return false;
    });
  }, [iconesConfig, bebedouro?.tipo, bebedouro?.nome]);
  const subIconePonto = bebedouro?.sub_icone_url || bebedouro?.icone_url || iconePonto?.sub_icone_url || iconePonto?.icone_url || "";
  const areaIdsBebedouro = Array.isArray(bebedouro.area_vinculada_ids) && bebedouro.area_vinculada_ids.length ? bebedouro.area_vinculada_ids : bebedouro.pasto_id ? [bebedouro.pasto_id] : [];
  const nomesPastos = Array.isArray(bebedouro.area_vinculada_nomes) && bebedouro.area_vinculada_nomes.length ? bebedouro.area_vinculada_nomes : bebedouro.pasto_nome ? [bebedouro.pasto_nome] : [];
  const lotesAtendidos = lotes.filter((lote) => areaIdsBebedouro.includes(lote.area_atual_id));
  const totalAnimaisAgua = lotesAtendidos.reduce((total, lote) => total + Number(lote.quantidade_cabecas || 0), 0);
  const ultimoLancamentoLimpeza = historico.find((item) => item.tipo_lancamento === "Limpeza");
  const ultimaInspecao = historico.find((item) => item.tipo_lancamento === "Inspeção") || ultimoSanitario;
  const diasLimpeza = getPeriodDays(bebedouro.periodicidade_limpeza, bebedouro.dias_limpeza_personalizado);
  const diasInspecao = getPeriodDays(bebedouro.periodicidade_inspecao, bebedouro.dias_inspecao_personalizado);
  const proximaLimpeza = addDaysToDate(ultimoLancamentoLimpeza?.data_lancamento, diasLimpeza);
  const proximaInspecao = addDaysToDate(ultimaInspecao?.data_lancamento || ultimaInspecao?.data_avaliacao, diasInspecao);


  return (
    <div className="space-y-1" translate="no">
      <div className="pb-1 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">Local: {bebedouro.nome}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => setShowLancamento(true)}>Lançar</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => setShowHistorico(true)}>Histórico</Button>
      </div>

      <CardSection title="Informações de Bebedouro">
        <div className="my-1 grid grid-cols-1 md:grid-cols-[auto,1fr] gap-1 items-center">
          <div className="flex items-center justify-center min-w-[120px] py-2">
            {subIconePonto ? (
              <img src={subIconePonto} alt={bebedouro.tipo || "Bebedouro"} className="h-[68px] w-[68px] object-contain pointer-events-none" />
            ) : (
              <div className="h-[68px] w-[68px] rounded border border-slate-200 bg-slate-50" />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
            <MetricBox label="Próxima inspeção" value={proximaInspecao} />
            <MetricBox label="Próxima limpeza" value={proximaLimpeza} />
            <MetricBox label="Animais consumindo água" value={totalAnimaisAgua ? `${totalAnimaisAgua.toLocaleString("pt-BR")} cab.` : "-"} />
          </div>
        </div>
      </CardSection>

      <CardSection title="Último Registro">
        {ultimoLancamento ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-1 text-[11px] space-y-1">
            <div className="flex items-center justify-between gap-2"><div className="font-semibold leading-tight text-slate-900">{ultimoLancamento.tipo_lancamento}</div><span className="text-slate-500 px-1">Data: {formatDateBR(ultimoLancamento.data_lancamento)}</span></div>
            <SectionLabel>DADOS DO LANÇAMENTO</SectionLabel>
            <div className="grid grid-cols-2 gap-1 text-[10px]"><MetricBox label="Status" value={ultimoLancamento.status || "-"} /><MetricBox label="Custo" value={ultimoLancamento.custo ? `R$ ${formatDecimal(ultimoLancamento.custo)}` : "-"} /></div>
            {(ultimoLancamento.produto_utilizado || ultimoLancamento.quantidade_utilizada) && <><SectionLabel>PRODUTO</SectionLabel><div className="grid grid-cols-2 gap-1 text-[10px]"><MetricBox label="Produto" value={ultimoLancamento.produto_utilizado || "-"} /><MetricBox label="Quantidade" value={ultimoLancamento.quantidade_utilizada || "-"} /></div></>}
            {(ultimoLancamento.nivel_risco || ultimoLancamento.cor_agua || ultimoLancamento.turbidez) && <><SectionLabel>SANIDADE DA ÁGUA</SectionLabel><div className="grid grid-cols-3 gap-1 text-[10px]"><MetricBox label="Risco" value={ultimoLancamento.nivel_risco || "-"} /><MetricBox label="Cor" value={ultimoLancamento.cor_agua || "-"} /><MetricBox label="Turbidez" value={ultimoLancamento.turbidez || "-"} /></div></>}
            {ultimoLancamento.descricao && <div className="break-words text-[10px] italic text-slate-500 mt-1">{ultimoLancamento.descricao}</div>}
          </div>
        ) : <div className="text-xs text-slate-500">Nenhum lançamento ainda.</div>}
      </CardSection>

      <CardSection title="Informações do Bebedouro">
        <div className="space-y-1 text-[10px]">
          <InfoLine label="Número" value={bebedouro.codigo_interno || "-"} />
          <InfoLine label="Tipo" value={bebedouro.tipo || "-"} />
          <InfoLine label="Capacidade" value={bebedouro.capacidade_litros ? `${Number(bebedouro.capacidade_litros).toLocaleString("pt-BR")} L` : "-"} />
          <InfoLine label="Origem da água" value={bebedouro.origem_agua || "-"} />
          <InfoLine label="Pastos atendidos" value={nomesPastos.join(", ") || "-"} />
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

function SectionLabel({ children }) {
  return <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-1 mb-0.5">{children}</div>;
}

function CardSection({ title, children }) {
  return <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1"><div className="text-[11px] font-bold text-slate-900">{title}</div>{children}</div>;
}

function InfoLine({ label, value }) {
  return <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">{label}:</span><span className="font-semibold text-slate-900 break-words">{value}</span></div>;
}