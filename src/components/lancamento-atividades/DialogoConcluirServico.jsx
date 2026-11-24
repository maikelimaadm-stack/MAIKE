import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { CampoDia, EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";
import { CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";
import { barraDoAndamento, erroDoUltimoDia, feitoNoConcluir, servicoSemArea, tituloDoConcluir } from "@/lib/servicoVariosDias";
import { areasEmAndamento, rotuloDaAreaDaAtividade } from "@/lib/atividadeAreasRegras";
import { hectaresDaEscolha, hectaresParaCorpo, linhasDoResumo, numeroBr, resumoDosLancamentos } from "@/lib/fechamentoRegras";
import { listarApontamentos, obterAtividade } from "@/services/lancamentoAtividadesService";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";

/**
 * D-PROD-267 — o "Concluir" da linha da lista (maquete V3): "Concluir <operação> · <área>", um campo só — "Qual foi o
 * último dia?", já com o último dia lançado ("sugerido: último dia lançado") — e "40 de 40 ha (100%)" com a barra. Grava
 * pelo `POST /atividades/:id/concluir` de sempre (as áreas em andamento e a atividade, numa transação; o servidor recusa
 * o dia futuro, antes do início ou antes do último dia lançado). A data é conferida aqui antes da rede, com a mesma regra.
 * D-PROD-274 (ajustes do teste de ponta a ponta): o título diz o capim do Plantio de pastagem; o serviço sem área mostra a
 * quantidade feita no lugar dos hectares (o local já está no título).
 *
 * D-PROD-292: "Fez o pasto todo?" por área em andamento ("Sim, os 25 ha" / "Não, fiz só uma parte" + os hectares) e o
 * resumo "Como ficou": jatos, horas de máquina, cada produto por hectare, custo total e por hectare. Os hectares vão no
 * concluir (`areas[]`); o servidor lança o que falta num fechamento.
 *
 * @param {{ item: any, hoje: string, onFechar: () => void,
 *   onConcluir: (dia: string, areas?: Array<{ atividade_area_id: string, hectares: string }>) => Promise<unknown> }} props
 */
export default function DialogoConcluirServico({ item, hoje, onFechar, onConcluir }) {
  const a = item?.andamento ?? {};
  const sugerido = typeof a.ultimo_dia === "string" && a.ultimo_dia ? a.ultimo_dia : hoje || "";
  const [dia, setDia] = useState(sugerido);
  const [erro, setErro] = useState(/** @type {string|null} */ (null));
  const [aviso, setAviso] = useState(/** @type {string|null} */ (null));
  const [enviando, setEnviando] = useState(false);
  // D-PROD-274: sem área, a quantidade feita (o local está no título; nunca "0 ha"); o título leva o capim do plantio.
  const hectares = feitoNoConcluir(item);
  const barra = barraDoAndamento(item);

  // D-PROD-292: o detalhe (as áreas com o tamanho) e os lançamentos (o resumo).
  const atividadeId = String(item?.id ?? item?.atividade_id ?? "");
  const detalhe = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "fechamento-detalhe", atividadeId],
    queryFn: () => obterAtividade(atividadeId),
    enabled: Boolean(atividadeId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const lancamentos = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "fechamento-lancamentos", atividadeId],
    queryFn: () => listarApontamentos(atividadeId),
    enabled: Boolean(atividadeId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const apontamentos = useMemo(() => {
    const d = /** @type {any} */ (lancamentos.data);
    return Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [];
  }, [lancamentos.data]);
  const semArea = servicoSemArea(item);
  const areas = useMemo(() => (semArea ? [] : areasEmAndamento(detalhe.data)), [semArea, detalhe.data]);
  /** Hectares já lançados por área da atividade (Σ dos dias confirmados). */
  const lancadoPorArea = useMemo(() => {
    /** @type {Record<string, number>} */
    const m = {};
    for (const ap of apontamentos) {
      if (ap?.status === "CANCELADO" || !ap?.atividade_area_id) continue;
      const n = Number(ap.area_executada_dia);
      if (Number.isFinite(n)) m[String(ap.atividade_area_id)] = (m[String(ap.atividade_area_id)] ?? 0) + n;
    }
    return m;
  }, [apontamentos]);
  const tamanhoDa = (/** @type {any} */ a) => {
    const n = Number(a?.area_planejada ?? a?.area?.tamanho_hectares);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // A escolha de cada área: já completa (lançado ≥ tamanho) vem "Sim"; as outras, sem escolha.
  const [escolhas, setEscolhas] = useState(/** @type {Record<string, { escolha: 'SIM'|'PARTE'|'', digitado: string }>} */ ({}));
  const escolhaDa = (/** @type {any} */ a) => {
    const id = String(a.id);
    if (escolhas[id]) return escolhas[id];
    const t = tamanhoDa(a);
    return { escolha: /** @type {'SIM'|''} */ (t !== null && (lancadoPorArea[id] ?? 0) >= t ? "SIM" : ""), digitado: "" };
  };
  const [errosArea, setErrosArea] = useState(/** @type {Record<string, string>} */ ({}));
  const hectaresInformados = areas.map((a) =>
    hectaresDaEscolha({ ...escolhaDa(a), tamanho: tamanhoDa(a), jaLancado: lancadoPorArea[String(a.id)] ?? 0 }),
  );
  const totalHa = hectaresInformados.every((h) => h.hectares !== null) && areas.length ? hectaresInformados.reduce((t, h) => t + /** @type {number} */ (h.hectares), 0) : null;
  const resumo = useMemo(() => resumoDosLancamentos(apontamentos), [apontamentos]);
  const linhas = linhasDoResumo(resumo, totalHa);
  const carregandoAreas = !semArea && (detalhe.isLoading || lancamentos.isLoading);

  const concluir = async () => {
    if (enviando) return;
    const e = erroDoUltimoDia(dia, { hoje, dataInicio: item?.data_inicio ?? null, ultimoDia: a.ultimo_dia ?? null });
    setErro(e);
    // D-PROD-292: cada área em andamento precisa da resposta do "Fez o pasto todo?".
    /** @type {Record<string, string>} */
    const ea = {};
    areas.forEach((ar, i) => {
      if (hectaresInformados[i].erro) ea[String(ar.id)] = /** @type {string} */ (hectaresInformados[i].erro);
    });
    setErrosArea(ea);
    if (e || Object.keys(ea).length) return;
    // Só vai a área em que os hectares informados passam dos já lançados (igual ao lançado: nada a acrescentar).
    const corpoAreas = areas
      .map((ar, i) => ({ ar, h: /** @type {number} */ (hectaresInformados[i].hectares) }))
      .filter(({ ar, h }) => h > (lancadoPorArea[String(ar.id)] ?? 0))
      .map(({ ar, h }) => ({ atividade_area_id: String(ar.id), hectares: hectaresParaCorpo(h) }));
    setEnviando(true);
    setAviso(null);
    try {
      await onConcluir(dia, corpoAreas.length ? corpoAreas : undefined);
    } catch (falha) {
      setAviso(
        ehResultadoIncerto(falha)
          ? "Não recebemos a resposta do servidor: a atividade PODE ter sido finalizada. Feche e confira a lista antes de tentar de novo."
          : mensagemDeErroAtividade(falha, "Não foi possível finalizar. Nada foi alterado."),
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo={
        <span className="flex min-w-0 flex-col">
          <span data-testid="dialogo-concluir-servico-titulo">Finalizar atividade</span>
          <span className="text-[12.5px] font-normal text-[var(--mg-text-2,#475569)]" data-testid="dialogo-concluir-servico-nome">
            {tituloDoConcluir(item)}
          </span>
        </span>
      }
      testId="dialogo-concluir-servico"
      className="b1-concluir-servico"
      contentProps={{ "data-permissao-explicita": "" }}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid="dialogo-concluir-servico-cancelar">
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => void concluir()} disabled={enviando || carregandoAreas} data-testid="dialogo-concluir-servico-enviar">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {enviando ? "Finalizando…" : "Finalizar atividade"}
          </button>
        </>
      }
    >
      <div className="b1 mg-b1-form-grid" data-densidade={DENSIDADE_BASE1}>
        <CampoDia
          label="Qual foi o último dia?"
          value={dia}
          onChange={(v) => {
            setDia(v || "");
            setErro(null);
          }}
          min={typeof item?.data_inicio === "string" ? item.data_inicio : undefined}
          max={hoje || undefined}
          required
          span={12}
          error={erro}
          testId="dialogo-concluir-servico-dia"
        />
        {a.ultimo_dia ? (
          <p className="col-span-12 -mt-1 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="dialogo-concluir-servico-sugerido">
            sugerido: último dia lançado
          </p>
        ) : null}
        {hectares ? (
          <div className="col-span-12 flex min-w-0 flex-col gap-2 pt-2" data-testid="dialogo-concluir-servico-hectares">
            <span className="text-[14px] text-[#141413]">{hectares}</span>
            {barra !== null ? (
              <span className="b1-servico-barra" aria-hidden>
                <span className="b1-servico-barra__feito" style={{ width: `${barra}%` }} />
              </span>
            ) : null}
          </div>
        ) : null}
        {/* D-PROD-292: "Fez o pasto todo?" por área em andamento. */}
        {areas.map((ar) => {
          const id = String(ar.id);
          const t = tamanhoDa(ar);
          const ja = lancadoPorArea[id] ?? 0;
          const e = escolhaDa(ar);
          const mudar = (/** @type {Partial<{ escolha: 'SIM'|'PARTE'|'', digitado: string }>} */ m) => {
            setEscolhas((x) => ({ ...x, [id]: { ...e, ...m } }));
            setErrosArea((x) => ({ ...x, [id]: "" }));
          };
          return (
            <React.Fragment key={id}>
              <SecaoForm titulo={areas.length > 1 ? `Fez o pasto todo? · ${rotuloDaAreaDaAtividade(ar)}` : "Fez o pasto todo?"} />
              <EscolhaSegmentada
                rotulo={rotuloDaAreaDaAtividade(ar)}
                opcoes={[
                  { value: "SIM", label: t !== null ? `Sim, os ${numeroBr(Math.max(t, ja), 2)} ha` : "Sim, o pasto todo" },
                  { value: "PARTE", label: "Não, fiz só uma parte" },
                ]}
                value={e.escolha}
                onChange={(v) => mudar({ escolha: /** @type {'SIM'|'PARTE'} */ (v) })}
                span={12}
                testId={`dialogo-concluir-fez-tudo-${id}`}
              />
              {e.escolha === "PARTE" ? (
                <CampoTexto
                  label="Quantos hectares fez?"
                  value={e.digitado}
                  onChange={(v) => mudar({ digitado: v })}
                  span={12}
                  inputMode="decimal"
                  maxLength={16}
                  keepCase
                  testId={`dialogo-concluir-hectares-${id}`}
                />
              ) : null}
              {ja > 0 ? (
                <p className="col-span-12 -mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">já lançados {numeroBr(ja, 2)} ha nos dias</p>
              ) : null}
              {errosArea[id] ? (
                <p className="col-span-12 text-[12.5px] text-amber-800" role="alert" data-testid={`dialogo-concluir-erro-area-${id}`}>
                  {errosArea[id]}
                </p>
              ) : null}
            </React.Fragment>
          );
        })}

        {/* D-PROD-292: "Como ficou" (os lançamentos confirmados; por hectare com os hectares informados). */}
        {linhas.jatos || linhas.horas || linhas.porHectare.length || linhas.custoTotal ? (
          <>
            <SecaoForm titulo="Como ficou" />
            {linhas.jatos || linhas.horas ? (
              <div className="col-span-12 min-w-0 b1-jato" data-testid="dialogo-concluir-resumo-uso">
                {linhas.jatos ? (
                  <div className="b1-jato__linha">
                    <span>Jatos</span>
                    <b>{linhas.jatos}</b>
                  </div>
                ) : null}
                {linhas.horas ? (
                  <div className="b1-jato__linha">
                    <span>Horas de máquina</span>
                    <b>{linhas.horas}</b>
                  </div>
                ) : null}
              </div>
            ) : null}
            {linhas.porHectare.length ? (
              <div className="col-span-12 min-w-0 b1-jato" data-testid="dialogo-concluir-resumo-produtos">
                <small className="text-[12.5px] text-[var(--mg-text-2,#475569)]">{totalHa ? "Por hectare" : "Total (escolha os hectares para ver por hectare)"}</small>
                {linhas.porHectare.map((p) => (
                  <div key={p.rotulo} className="b1-jato__linha">
                    <span>{p.rotulo}</span>
                    <b>{p.texto}</b>
                  </div>
                ))}
              </div>
            ) : null}
            {linhas.custoTotal ? (
              <div className="col-span-12 min-w-0 b1-jato" data-testid="dialogo-concluir-resumo-custo">
                <div className="b1-jato__linha">
                  <span>Custo total</span>
                  <b>{linhas.custoTotal}</b>
                </div>
                {linhas.custoPorHectare ? (
                  <div className="b1-jato__linha">
                    <span>Custo por hectare</span>
                    <b>{linhas.custoPorHectare}</b>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {aviso ? (
          <p className="col-span-12 text-[12.5px] text-amber-800" role="alert" data-testid="dialogo-concluir-servico-erro">
            {aviso}
          </p>
        ) : null}
      </div>
    </B1Janela>
  );
}
