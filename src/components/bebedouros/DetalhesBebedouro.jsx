import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { listarIconesPorTipoEntidade, listarPontosDaEmpresa } from "@/services/mapaService";
import { listarTodosLotes } from "@/services/loteManejoService";
import { useBebedouroHistorico } from "@/hooks/useBebedouroHistorico";
import BebedouroTimeline from "./BebedouroTimeline";
import FormularioLancamentoBebedouro from "./FormularioLancamentoBebedouro";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";
import { ArrowLeft } from "lucide-react";

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

/**
 * @param {object} props
 * @param {object} props.bebedouro
 * @param {(locked: boolean) => void} [props.onSubFlowChange] true enquanto lançamento/histórico ocupa a tela
 * @param {(toolbar: import('react').ReactNode) => void} [props.onRecordToolbarChange]
 */
export default function DetalhesBebedouro({ bebedouro, onSubFlowChange, onRecordToolbarChange }) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const [subView, setSubView] = useState(/** @type {'main'|'lancamento'|'historico'} */ ("main"));
  const registroReal = Boolean(bebedouro?.id && !String(bebedouro.id).startsWith("ponto-"));

  React.useEffect(() => {
    onSubFlowChange?.(subView !== "main");
  }, [subView, onSubFlowChange]);

  React.useEffect(() => {
    if (subView === "lancamento") {
      onRecordToolbarChange?.(
        <PillBtn tone="gray" type="button" onClick={() => setSubView("main")}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Voltar ao resumo
        </PillBtn>,
      );
      return;
    }
    if (subView === "historico") {
      onRecordToolbarChange?.(
        <PillBtn tone="gray" type="button" onClick={() => setSubView("main")}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Voltar ao resumo
        </PillBtn>,
      );
      return;
    }
    onRecordToolbarChange?.(null);
  }, [subView, onRecordToolbarChange]);

  React.useEffect(() => {
    setSubView("main");
  }, [bebedouro?.id]);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones-bebedouro-detalhe", empresaId],
    queryFn: async () => {
      const icones = await listarIconesPorTipoEntidade("Ponto");
      return icones.filter((item) => item.ativo !== false);
    },
    enabled: !!empresaId,
    staleTime: 10 * 60 * 1000
  });
  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-bebedouro-detalhe", empresaId],
    queryFn: async () => {
      const all = await listarTodosLotes();
      return all.filter((lote) => lote.empresa_id === empresaId && lote.status === "Ativo");
    },
    enabled: !!empresaId,
    staleTime: 60 * 1000
  });
  const { data: pontosReferencia = [] } = useQuery({
    queryKey: ["pontos-referencia-bebedouro-detalhe", empresaId],
    queryFn: async () => {
      const pontos = await listarPontosDaEmpresa(empresaId);
      return pontos.filter((ponto) => ponto.ativo !== false);
    },
    enabled: !!empresaId,
    staleTime: 60 * 1000
  });
  const { data: historico = [] } = useBebedouroHistorico(empresaId, registroReal ? bebedouro?.id : null);
  const ultimaAvaliacaoAgua = historico.find((item) => item.qualidade_agua || item.escore_agua);
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
  const pontoReferencia = pontosReferencia.find((ponto) => {
    const codigo = normalizeText(bebedouro?.codigo_interno);
    const nome = normalizeText(bebedouro?.nome);
    return ponto.id === bebedouro?.ponto_referencia_id ||
      (nome && normalizeText(ponto.nome) === nome) ||
      (codigo && normalizeText(ponto.sigla) === codigo) ||
      (codigo && normalizeText(ponto.numero_ponto) === codigo);
  });
  const numeroBebedouro = pontoReferencia?.numero_ponto || bebedouro?.numero_ponto || bebedouro?.codigo_interno || "-";
  const areaIdsBebedouro = Array.isArray(bebedouro.area_vinculada_ids) && bebedouro.area_vinculada_ids.length ? bebedouro.area_vinculada_ids : bebedouro.pasto_id ? [bebedouro.pasto_id] : [];
  const nomesPastos = Array.isArray(bebedouro.area_vinculada_nomes) && bebedouro.area_vinculada_nomes.length ? bebedouro.area_vinculada_nomes : bebedouro.pasto_nome ? [bebedouro.pasto_nome] : [];
  const lotesAtendidos = lotes.filter((lote) => areaIdsBebedouro.includes(lote.area_atual_id));
  const totalAnimaisAgua = lotesAtendidos.reduce((total, lote) => total + Number(lote.quantidade_cabecas || 0), 0);
  const ultimoLancamentoLimpeza = historico.find((item) => item.tipo_lancamento === "Limpeza");
  const ultimaInspecao = historico.find((item) => item.tipo_lancamento === "Inspeção") || ultimaAvaliacaoAgua;
  const diasLimpeza = getPeriodDays(bebedouro.periodicidade_limpeza, bebedouro.dias_limpeza_personalizado);
  const diasInspecao = getPeriodDays(bebedouro.periodicidade_inspecao, bebedouro.dias_inspecao_personalizado);
  const proximaLimpeza = addDaysToDate(ultimoLancamentoLimpeza?.data_lancamento, diasLimpeza);
  const proximaInspecao = addDaysToDate(ultimaInspecao?.data_lancamento || ultimaInspecao?.data_avaliacao, diasInspecao);

  if (subView === "lancamento") {
    return (
      <FormularioLancamentoBebedouro
        bebedouro={bebedouro}
        onCancel={() => setSubView("main")}
        onSaved={() => setSubView("main")}
      />
    );
  }

  if (subView === "historico") {
    return (
      <div className="cadastro-b1">
        <CardSection title="Histórico do Bebedouro">
          <BebedouroTimeline historico={historico} />
        </CardSection>
      </div>
    );
  }

  return (
    <div className="cadastro-b1 space-y-2" translate="no">
      <div className="pb-1 border-b border-[var(--mg-divider)] space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">Local: {bebedouro.nome}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button type="button" className="tb-btn tb-btn-green w-full" onClick={() => setSubView("lancamento")}>Lançar</button>
        <button type="button" className="tb-btn tb-btn-gray w-full" onClick={() => setSubView("historico")}>Histórico</button>
      </div>

      <CardSection title="Resumo Operacional">
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
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">{ultimoLancamento.tipo_lancamento || "Lançamento"}</div>
              <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">
                {formatDateBR(ultimoLancamento.data_lancamento)}{ultimoLancamento.hora_lancamento ? ` · ${ultimoLancamento.hora_lancamento}` : ""}
              </span>
            </div>
            {ultimoLancamento.descricao && <div className="text-[10px] text-slate-500 break-words">Obs: {ultimoLancamento.descricao}</div>}
          </div>
        ) : <div className="text-xs text-slate-500">Nenhum lançamento ainda.</div>}
      </CardSection>

      <CardSection title="Informações do Bebedouro">
        <div className="space-y-1 text-[10px]">
          <InfoLine label="Número" value={numeroBebedouro} />
          <InfoLine label="Tipo" value={bebedouro.tipo || "-"} />
          <InfoLine label="Capacidade" value={bebedouro.capacidade_litros ? `${Number(bebedouro.capacidade_litros).toLocaleString("pt-BR")} L` : "-"} />
          <InfoLine label="Origem da água" value={bebedouro.origem_agua || "-"} />
          <InfoLine label="Pastos atendidos" value={nomesPastos.join(", ") || "-"} />
          <InfoLine label="Status" value={bebedouro.status || "-"} />
          <InfoLine label="Rotina limpeza" value={bebedouro.dias_limpeza_personalizado ? `${bebedouro.dias_limpeza_personalizado} dia(s)` : bebedouro.periodicidade_limpeza || "-"} />
          <InfoLine label="Rotina inspeção" value={bebedouro.dias_inspecao_personalizado ? `${bebedouro.dias_inspecao_personalizado} dia(s)` : bebedouro.periodicidade_inspecao || "-"} />
          <InfoLine label="Custo acumulado" value={`R$ ${formatDecimal(custoTotal)}`} />
          <InfoLine label="Observações" value={bebedouro.observacoes || "-"} />
        </div>
      </CardSection>
    </div>
  );
}

function MetricBox({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"><div className="text-slate-500">{label}</div><div className="text-sm font-bold text-slate-900 break-words leading-tight">{value}</div></div>;
}

function CardSection({ title, children }) {
  return (
    <div className="mg-card p-2 space-y-1">
      <div className="text-[11px] font-bold text-slate-900">{title}</div>
      {children}
    </div>
  );
}

function InfoLine({ label, value }) {
  return <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">{label}:</span><span className="font-semibold text-slate-900 break-words">{value}</span></div>;
}
