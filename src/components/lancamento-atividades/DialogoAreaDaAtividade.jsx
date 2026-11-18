import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, MapPin, Play, Plus, RotateCcw, Ruler, Trash2 } from "lucide-react";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { CampoDia, CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import { CampoSelect } from "@/components/gestao/GestaoFormParts";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { ehDiaValido } from "@/lib/diaCivil";
import { notifySuccess } from "@/lib/maikeNotify";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { LIMITES_DECIMAL_ATIVIDADE, LOCALE_ATIVIDADE, formatarDiaAtividade, rotuloDaArea } from "@/lib/lancamentoAtividadesRegras";
import { STATUS_AREA, areasDaAtividade, lerPlanejada, planejadaParaEdicao, rotuloDaAreaDaAtividade } from "@/lib/atividadeAreasRegras";
import { planoDaFeita } from "@/lib/lancamentosDaAreaRegras";
import { acaoAreaAtividade, adicionarAreaAtividade, editarApontamento, editarAreaAtividade, listarAreasDaFazenda } from "@/services/lancamentoAtividadesService";

/** Formatação das mensagens do diálogo de ação. */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: LOCALE_ATIVIDADE, moeda: "BRL", casas: 2 });
const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/**
 * O que cada modo do diálogo diz e faz.
 * @type {Record<string, { titulo: string, botao: string, Icone: any, perigo?: boolean }>}
 */
const MODOS = {
  iniciar: { titulo: "Iniciar área", botao: "Iniciar área", Icone: Play },
  concluir: { titulo: "Concluir área", botao: "Concluir área", Icone: CircleCheck },
  reabrir: { titulo: "Reabrir área", botao: "Reabrir área", Icone: RotateCcw },
  remover: { titulo: "Remover área", botao: "Remover área", Icone: Trash2, perigo: true },
  planejada: { titulo: "Área planejada", botao: "Salvar", Icone: MapPin },
  feita: { titulo: "Hectares feitos", botao: "Salvar", Icone: Ruler },
  adicionar: { titulo: "Adicionar área", botao: "Adicionar área", Icone: Plus },
};

/**
 * D-PROD-249 — o diálogo das ações de UMA área da atividade (no diálogo de ação do sistema): iniciar (a data de início,
 * padrão hoje na fazenda, nunca futura nem antes do início da atividade), concluir (a data de conclusão, nunca antes
 * do início da área), reabrir, remover (só a não iniciada e sem lançamento), a área planejada e adicionar uma área
 * nova à atividade. A recusa do servidor fica dentro do diálogo. Quando `area` não vem e há `escolher` (as áreas a
 * iniciar), o diálogo pergunta qual (o "Iniciar uma área" da janela de lançamento sem área em andamento).
 *
 * @param {{
 *   modo: 'iniciar'|'concluir'|'reabrir'|'remover'|'planejada'|'feita'|'adicionar',
 *   atividade: any,
 *   area?: any,
 *   apontamentos?: any[],
 *   feitaAtual?: string|null,
 *   escolher?: any[],
 *   onFechar: () => void,
 *   onFeito: (resposta: { area?: any, atividade: any, removida?: string }) => void,
 * }} props `onFeito`: a resposta do servidor (`{ area, atividade }`; remover: `{ removida, atividade }`).
 */
export default function DialogoAreaDaAtividade({ modo, atividade, area = null, escolher = [], apontamentos = [], feitaAtual = null, onFechar, onFeito }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje } = useFusoDaFazenda(empresaId);
  const conf = MODOS[modo] ?? MODOS.iniciar;
  const [escolhidaId, setEscolhidaId] = useState(area?.id ? String(area.id) : escolher.length === 1 ? String(escolher[0].id) : "");
  const alvo = area ?? escolher.find((a) => String(a.id) === escolhidaId) ?? null;
  const [data, setData] = useState(hoje || "");
  const [planejada, setPlanejada] = useState(modo === "planejada" ? planejadaParaEdicao(area?.area_planejada) : "");
  const [feita, setFeita] = useState(modo === "feita" ? planejadaParaEdicao(feitaAtual) : "");
  const [areaNovaId, setAreaNovaId] = useState("");
  const [erro, setErro] = useState(/** @type {Record<string, string>} */ ({}));

  // Adicionar: as áreas ativas da fazenda que ainda não estão na atividade.
  const areasQuery = useQuery({
    queryKey: ["areas", empresaId, RAIZ_CONSULTAS_ATIVIDADES],
    queryFn: () => listarAreasDaFazenda(),
    enabled: modo === "adicionar" && Boolean(empresaId),
    staleTime: 30 * 1000,
  });
  const jaNaAtividade = useMemo(() => new Set(areasDaAtividade(atividade).map((a) => String(a.area_id))), [atividade]);
  const opcoesNovas = useMemo(
    () =>
      (Array.isArray(areasQuery.data) ? areasQuery.data : [])
        .filter((a) => a && a.id != null && a.ativo !== false && !jaNaAtividade.has(String(a.id)))
        .map((a) => ({ value: String(a.id), label: rotuloDaArea(a) || String(a.id) })),
    [areasQuery.data, jaNaAtividade],
  );
  const areaNova = (Array.isArray(areasQuery.data) ? areasQuery.data : []).find((a) => String(a?.id) === areaNovaId) ?? null;

  const nomeDaArea = alvo ? rotuloDaAreaDaAtividade(alvo) : "";
  const inicioDaAtividade = ehDiaValido(atividade?.data_inicio) ? String(atividade.data_inicio) : "";
  const inicioDaArea = ehDiaValido(alvo?.data_inicio) ? String(alvo.data_inicio) : "";

  /** Confere antes da rede (o erro fica no campo e nada é enviado). @returns {boolean} */
  const conferir = () => {
    /** @type {Record<string, string>} */
    const e = {};
    if ((modo === "iniciar" || modo === "concluir") && !alvo) e.area = "Escolha a área.";
    if (modo === "iniciar" || modo === "concluir") {
      if (!ehDiaValido(data)) e.data = "Informe a data.";
      else if (hoje && data > hoje) e.data = "A data não pode ser posterior a hoje na fazenda.";
      else if (modo === "iniciar" && inicioDaAtividade && data < inicioDaAtividade) e.data = `A área não começa antes do início da atividade (${formatarDiaAtividade(inicioDaAtividade)}).`;
      else if (modo === "concluir" && inicioDaArea && data < inicioDaArea) e.data = `A área não termina antes de começar (${formatarDiaAtividade(inicioDaArea)}).`;
    }
    if (modo === "planejada" || modo === "adicionar") {
      const lida = lerPlanejada(planejada);
      if (lida.erro) e.planejada = lida.erro;
    }
    if (modo === "feita") {
      const lida = lerPlanejada(feita);
      if (lida.erro) e.feita = lida.erro.replace("área planejada", "área feita");
    }
    if (modo === "adicionar" && !areaNovaId) e.area = "Escolha a área.";
    setErro(e);
    return Object.keys(e).length === 0;
  };

  const enviar = async () => {
    if (!conferir()) return;
    const id = String(atividade?.id ?? "");
    /** @type {any} */
    let r;
    if (modo === "feita") {
      // Sem endpoint novo: o servidor soma `area_executada_dia` dos lançamentos confirmados da área; o valor digitado vai no mais novo.
      const { passos, semLancamento } = planoDaFeita({ apontamentos, areaId: String(alvo?.id ?? ""), valor: lerPlanejada(feita).valor ?? null });
      if (semLancamento) {
        setErro({ feita: "A área ainda não tem lançamento: registre algo nela antes de informar os hectares feitos." });
        return;
      }
      for (const p of passos) r = await editarApontamento(id, String(p.apontamento.id), { area_executada_dia: p.area_executada_dia, versao: p.apontamento.versao });
      r = { atividade: r?.atividade ?? null };
    } else if (modo === "adicionar") r = await adicionarAreaAtividade(id, { area_id: areaNovaId, ...(planejada.trim() ? { area_planejada: lerPlanejada(planejada).valor } : {}) });
    else if (modo === "planejada") r = await editarAreaAtividade(id, alvo, lerPlanejada(planejada).valor);
    else r = await acaoAreaAtividade(id, alvo, /** @type {any} */ (modo), { data: modo === "iniciar" || modo === "concluir" ? data : null });
    const nome = modo === "adicionar" ? rotuloDaArea(areaNova) || "A área" : nomeDaArea || "A área";
    const frases = /** @type {Record<string, string>} */ ({
      iniciar: `${nome} foi iniciada: já recebe lançamentos.`,
      concluir: `${nome} foi concluída.`,
      reabrir: `${nome} voltou a ficar em andamento.`,
      remover: `${nome} saiu da atividade.`,
      planejada: `Área planejada de ${nome} atualizada.`,
      feita: `Hectares feitos de ${nome} atualizados.`,
      adicionar: `${nome} entrou na atividade, a iniciar.`,
    });
    notifySuccess("Sucesso", frases[modo] ?? "Feito.");
    onFeito(r);
  };

  const descricao =
    modo === "adicionar"
      ? [atividade?.numero != null ? `Nº ${atividade.numero}` : "", String(atividade?.nome ?? "")].filter(Boolean).join(" · ")
      : nomeDaArea || "Escolha a área";
  const textos = /** @type {Record<string, string>} */ ({
    iniciar: "A partir da data de início, a área recebe os lançamentos (máquinas, insumos, mão de obra e custos extras).",
    concluir: "Concluída, a área não recebe lançamento novo; o que já foi lançado fica. Dá para reabrir depois.",
    reabrir: "A área volta a ficar em andamento e recebe lançamentos de novo. A data de início fica a mesma.",
    remover: "A área sai da atividade. Só sai a área não iniciada e sem nenhum lançamento: nada com custo é apagado.",
    planejada: "A área planejada desta área. A da atividade é a soma das áreas.",
    feita: "Os hectares já feitos nesta área. Eles dividem o custo (R$/ha) e a dose por hectare dos produtos. Em branco, a área fica sem hectares feitos.",
    adicionar: "A área entra na atividade a iniciar. Comece os lançamentos nela pelo Iniciar área.",
  });

  return (
    <DialogoAcao
      aberto
      titulo={conf.titulo}
      descricao={descricao}
      icone={<conf.Icone size={20} strokeWidth={2} />}
      iconeBotao={<conf.Icone size={16} aria-hidden />}
      rotuloBotao={conf.botao}
      testId={`dialogo-area-${modo}`}
      comMotivo={false}
      perigo={conf.perigo === true}
      contexto={CONTEXTO_MENSAGENS}
      conteudo={
        <div className="cadastro-b1 flex min-w-0 flex-col gap-3">
          <p className={NOTA}>{textos[modo]}</p>
          <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
            {!area && (modo === "iniciar" || modo === "concluir") ? (
              <CampoSelect
                label="Área"
                value={escolhidaId}
                onChange={(v) => {
                  setEscolhidaId(v);
                  setErro((e) => ({ ...e, area: "" }));
                }}
                options={escolher.map((a) => ({ value: String(a.id), label: rotuloDaAreaDaAtividade(a) }))}
                required
                span={12}
                error={erro.area || undefined}
              />
            ) : null}
            {modo === "feita" ? (
              <CampoNumero
                label="Feita (ha)"
                value={feita}
                onChange={(v) => {
                  setFeita(v);
                  setErro((e) => ({ ...e, feita: "" }));
                }}
                locale={LOCALE_ATIVIDADE}
                limites={LIMITES_DECIMAL_ATIVIDADE}
                span={12}
                error={erro.feita || null}
                testId="dialogo-area-feita-ha"
              />
            ) : null}
            {modo === "adicionar" ? (
              <CampoSelect
                label="Área"
                value={areaNovaId}
                onChange={(v) => {
                  setAreaNovaId(v);
                  const a = (Array.isArray(areasQuery.data) ? areasQuery.data : []).find((x) => String(x?.id) === v);
                  setPlanejada(planejadaParaEdicao(a?.tamanho_hectares));
                  setErro((e) => ({ ...e, area: "" }));
                }}
                options={opcoesNovas}
                placeholder={areasQuery.isLoading ? "Carregando as áreas…" : opcoesNovas.length ? "Escolha a área" : "Todas as áreas da fazenda já estão na atividade"}
                required
                span={12}
                error={erro.area || undefined}
              />
            ) : null}
            {modo === "iniciar" || modo === "concluir" ? (
              <CampoDia
                label={modo === "iniciar" ? "Data de início" : "Data de conclusão"}
                value={data}
                onChange={(v) => {
                  setData(v);
                  setErro((e) => ({ ...e, data: "" }));
                }}
                min={(modo === "iniciar" ? inicioDaAtividade : inicioDaArea) || undefined}
                max={hoje || undefined}
                required
                span={12}
                error={erro.data || null}
                testId={`dialogo-area-${modo}-data`}
              />
            ) : null}
            {modo === "planejada" || modo === "adicionar" ? (
              <CampoNumero
                label="Área planejada (ha)"
                value={planejada}
                onChange={(v) => {
                  setPlanejada(v);
                  setErro((e) => ({ ...e, planejada: "" }));
                }}
                locale={LOCALE_ATIVIDADE}
                limites={LIMITES_DECIMAL_ATIVIDADE}
                span={12}
                error={erro.planejada || null}
                testId={`dialogo-area-${modo}-planejada`}
              />
            ) : null}
          </div>
          {modo === "iniciar" && alvo?.status && alvo.status !== STATUS_AREA.PLANEJADA ? <p className={NOTA}>Esta área já foi iniciada.</p> : null}
        </div>
      }
      onFechar={onFechar}
      onEnviar={enviar}
    />
  );
}
