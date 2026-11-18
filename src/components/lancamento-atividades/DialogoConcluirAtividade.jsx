import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleCheck, Info } from "lucide-react";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { chaveTotais, resumoParaConcluir } from "@/lib/atividadeLinhasRegras";
import { ehDiaValido } from "@/lib/diaCivil";
import { LOCALE_ATIVIDADE, formatarDiaAtividade } from "@/lib/lancamentoAtividadesRegras";
import { STATUS_AREA, areasDaAtividade, rotuloDaAreaDaAtividade } from "@/lib/atividadeAreasRegras";
import { obterAtividade, obterTotaisAtividade } from "@/services/lancamentoAtividadesService";

/** Formatação das mensagens do diálogo de ação. */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: LOCALE_ATIVIDADE, moeda: "BRL", casas: 2 });

/** Linha do resumo: rótulo à esquerda, valor à direita (em negrito). */
const LINHA = "flex min-w-0 items-center justify-between gap-3 px-3.5 py-2.5";

/**
 * "Concluir atividade" (D-PROD-232, protótipo do proprietário), no diálogo de ação do sistema: o selo e o título com o
 * nome da atividade; o resumo (período e dias lançados, área feita / planejada com a barra, custo total, custo por
 * hectare e combustível); a data de conclusão (a regra de sempre, `erroDaDataDeConclusao`, conferida por quem envia);
 * o aviso quando a área feita é menor que a planejada; a nota de que a concluída fica só para consulta.
 *
 * Os números vêm do servidor e de nada mais: `GET /atividades/:id/totais` (o mesmo do totalizador) e, para os dias
 * lançados, o detalhe da atividade (`totais.dias_com_apontamento`; lido só quando a atividade não o traz). Sem o valor,
 * o campo mostra "—"; enquanto lê, "…".
 *
 * @param {{
 *   atividade: any,
 *   empresaId: string|null,
 *   hoje: string,
 *   dataConclusao: string,
 *   onDataConclusao: (v: string) => void,
 *   erroData: string|null,
 *   onFechar: () => void,
 *   onEnviar: (motivo: string) => Promise<unknown>,
 *   onConsultar: () => void,
 * }} props
 */
export default function DialogoConcluirAtividade({ atividade, empresaId, hoje, dataConclusao, onDataConclusao, erroData, onFechar, onEnviar, onConsultar }) {
  const id = atividade?.id ? String(atividade.id) : null;
  const totaisQuery = useQuery({
    queryKey: chaveTotais(empresaId, id),
    queryFn: () => obterTotaisAtividade(/** @type {string} */ (id)),
    enabled: Boolean(empresaId && id),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const semDias = !Number.isInteger(atividade?.totais?.dias_com_apontamento);
  // Mesma chave do detalhe da página: abrir pela linha lê o detalhe uma vez; aberta, ele já está no cache.
  const detalheQuery = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "detalhe", empresaId ?? null, id ?? ""],
    queryFn: () => obterAtividade(/** @type {string} */ (id)),
    enabled: Boolean(empresaId && id && semDias),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const detalhe = /** @type {any} */ (detalheQuery.data ?? null);
  const resumo = resumoParaConcluir({
    atividade,
    totais: totaisQuery.data ?? null,
    detalhe: detalhe && String(detalhe.id) === id ? detalhe : null,
    hoje,
    dataConclusao,
  });
  const lendoTotais = totaisQuery.isPending && totaisQuery.fetchStatus !== "idle";
  const lendoDias = semDias && detalheQuery.isPending && detalheQuery.fetchStatus !== "idle";
  /** @param {string|null} v @param {boolean} lendo */
  const valor = (v, lendo) => v ?? (lendo ? "…" : "—");

  const nome = String(atividade?.nome ?? "").trim();
  const numero = atividade?.numero != null ? `Nº ${atividade.numero}` : "";

  return (
    <DialogoAcao
      aberto
      titulo="Concluir atividade"
      descricao={[numero, nome.toLocaleUpperCase("pt-BR")].filter(Boolean).join(" · ")}
      icone={<CircleCheck size={20} strokeWidth={2} />}
      iconeBotao={<Check size={16} aria-hidden />}
      rotuloBotao="Concluir atividade"
      testId="dialogo-concluir-atividade"
      comMotivo={false}
      perigo={false}
      contexto={CONTEXTO_MENSAGENS}
      conteudo={
        <div className="flex min-w-0 flex-col gap-3">
          <dl
            className="min-w-0 divide-y divide-[var(--mg-divider,#E8E7E2)] overflow-hidden rounded-[10px] border border-[var(--mg-divider,#E8E7E2)] bg-white"
            data-testid="concluir-resumo"
          >
            <div className={LINHA}>
              <dt className="text-[var(--mg-text-2,#475569)]">Período</dt>
              <dd className="text-right font-semibold" data-testid="concluir-resumo-periodo">
                {valor(resumo.periodo, lendoDias)}
              </dd>
            </div>
            <div className="px-3.5 py-2.5">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <dt className="text-[var(--mg-text-2,#475569)]">Área feita</dt>
                <dd className="text-right font-semibold" data-testid="concluir-resumo-area">
                  {valor(resumo.area, lendoTotais)}
                </dd>
              </div>
              {resumo.barra !== null ? (
                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#ECEBE6]"
                  role="progressbar"
                  aria-label="Área feita"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={resumo.barra}
                  data-testid="concluir-resumo-barra"
                >
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: `${resumo.barra}%` }} />
                </div>
              ) : null}
            </div>
            <div className={LINHA}>
              <dt className="text-[var(--mg-text-2,#475569)]">Custo total</dt>
              <dd className="text-right font-semibold tabular-nums" data-testid="concluir-resumo-custo">
                {valor(resumo.custo, lendoTotais)}
              </dd>
            </div>
            <div className={LINHA}>
              <dt className="text-[var(--mg-text-2,#475569)]">Custo por hectare</dt>
              <dd className="text-right font-semibold tabular-nums" data-testid="concluir-resumo-custo-ha">
                {valor(resumo.custoPorHa, lendoTotais)}
              </dd>
            </div>
            <div className={LINHA}>
              <dt className="text-[var(--mg-text-2,#475569)]">Combustível</dt>
              <dd className="text-right font-semibold tabular-nums" data-testid="concluir-resumo-combustivel">
                {valor(resumo.combustivel, lendoTotais)}
              </dd>
            </div>
          </dl>
          {totaisQuery.isError ? (
            <p className="text-[12px] text-amber-800" data-testid="concluir-resumo-erro">
              Não foi possível ler os custos agora; a conclusão não depende deles.
            </p>
          ) : null}
          <div className="cadastro-b1">
            <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
              <CampoDia
                label="Data de conclusão"
                value={dataConclusao}
                onChange={onDataConclusao}
                min={ehDiaValido(atividade?.data_inicio) ? String(atividade.data_inicio) : undefined}
                max={hoje || undefined}
                required
                span={12}
                error={erroData}
                testId="dialogo-concluir-atividade-data"
              />
            </div>
          </div>
          {areasDaAtividade(atividade).some((a) => a.status !== STATUS_AREA.CONCLUIDA) ? (
            <div className="min-w-0 rounded-[10px] border border-[var(--mg-divider,#E8E7E2)] bg-white px-3.5 py-2.5 text-[12.5px]" data-testid="concluir-areas">
              <p className="font-semibold">Áreas que ainda não estão concluídas</p>
              <ul className="mt-1 space-y-0.5">
                {areasDaAtividade(atividade)
                  .filter((a) => a.status !== STATUS_AREA.CONCLUIDA)
                  .map((a) => (
                    <li key={String(a.id)} className="flex min-w-0 justify-between gap-3" data-testid={`concluir-area-${a.id}`}>
                      <span className="min-w-0 truncate">{rotuloDaAreaDaAtividade(a)}</span>
                      <span className="shrink-0 text-[var(--mg-text-2,#475569)]">
                        {a.status === STATUS_AREA.EM_ANDAMENTO
                          ? `conclui junto${dataConclusao ? ` em ${formatarDiaAtividade(dataConclusao)}` : ""}`
                          : "fica não iniciada"}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {resumo.falta ? (
            <p
              role="status"
              className="flex min-w-0 items-start gap-2 rounded-[10px] border border-cyan-100 bg-cyan-50 px-3 py-2.5 text-[12.5px] text-cyan-800"
              data-testid="concluir-falta-area"
            >
              <Info size={15} className="mt-[1px] shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                Faltam {resumo.falta.faltam} {resumo.falta.unidade} dos {resumo.falta.planejada} planejados. Pode concluir assim mesmo: a área fica como
                foi lançada.
              </span>
            </p>
          ) : null}
          <p className="text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="concluir-nota">
            Concluída, a atividade fica só para consulta. Dá para reabrir depois.
          </p>
        </div>
      }
      onFechar={onFechar}
      onEnviar={onEnviar}
      onConsultar={onConsultar}
    />
  );
}
