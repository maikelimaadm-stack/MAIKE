import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleCheck } from "lucide-react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { chaveTotais, resumoParaConcluir } from "@/lib/atividadeLinhasRegras";
import { ehDiaValido } from "@/lib/diaCivil";
import { LOCALE_ATIVIDADE, formatarDiaAtividade } from "@/lib/lancamentoAtividadesRegras";
import { STATUS_AREA, areasDaAtividade, rotuloDaAreaDaAtividade } from "@/lib/atividadeAreasRegras";
import { obterAtividade, obterTotaisAtividade } from "@/services/lancamentoAtividadesService";

/** Formatação das mensagens do diálogo de ação. */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: LOCALE_ATIVIDADE, moeda: "BRL", casas: 2 });

/**
 * "Concluir atividade" (D-PROD-232; emenda 3 da D-PROD-252: na janela padrão do Base1, 680px): o título com o selo; o
 * Resumo (período, área feita, custo total, custo por hectare e combustível, campos de leitura na grade de duas
 * colunas); a Conclusão (a data, a regra de sempre, `erroDaDataDeConclusao`, conferida por quem envia) e, só quando há,
 * as áreas que ainda não estão concluídas. Sem nome da atividade, barra, aviso de área que falta (a "Área feita" já mostra
 * feita / planejada) nem notas.
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

  const pendentes = areasDaAtividade(atividade).filter((a) => a.status !== STATUS_AREA.CONCLUIDA);

  return (
    <DialogoAcao
      aberto
      janelaBase1
      titulo="Concluir atividade"
      descricao=""
      icone={<CircleCheck size={20} strokeWidth={2} />}
      iconeBotao={<Check size={16} aria-hidden />}
      rotuloBotao="Concluir atividade"
      testId="dialogo-concluir-atividade"
      comMotivo={false}
      perigo={false}
      contexto={CONTEXTO_MENSAGENS}
      conteudo={
        <div className="b1 mg-b1-form-grid" data-densidade={DENSIDADE_BASE1}>
          <SecaoForm titulo="Resumo" />
          <ValorCalculado label="Período" valor={valor(resumo.periodo, lendoDias)} span={6} testId="concluir-resumo-periodo" />
          <ValorCalculado label="Área feita" valor={valor(resumo.area, lendoTotais)} span={6} testId="concluir-resumo-area" />
          <ValorCalculado label="Custo total" valor={valor(resumo.custo, lendoTotais)} span={6} testId="concluir-resumo-custo" />
          <ValorCalculado label="Custo por hectare" valor={valor(resumo.custoPorHa, lendoTotais)} span={6} testId="concluir-resumo-custo-ha" />
          <ValorCalculado label="Combustível" valor={valor(resumo.combustivel, lendoTotais)} span={6} testId="concluir-resumo-combustivel" />
          {totaisQuery.isError ? (
            <p className="col-span-12 text-[12px] text-amber-800" data-testid="concluir-resumo-erro">
              Não foi possível ler os custos agora; a conclusão não depende deles.
            </p>
          ) : null}
          <SecaoForm titulo="Conclusão" />
          <CampoDia
            label="Data de conclusão"
            value={dataConclusao}
            onChange={onDataConclusao}
            min={ehDiaValido(atividade?.data_inicio) ? String(atividade.data_inicio) : undefined}
            max={hoje || undefined}
            required
            span={6}
            error={erroData}
            testId="dialogo-concluir-atividade-data"
          />
          {pendentes.length ? (
            <div className="col-span-12 min-w-0" data-testid="concluir-areas">
              {pendentes.map((a) => (
                <p key={String(a.id)} className="b1-janela__linha" data-testid={`concluir-area-${a.id}`}>
                  <span className="min-w-0 truncate">{rotuloDaAreaDaAtividade(a)}</span>
                  <span className="shrink-0 text-[#73726C]">
                    {a.status === STATUS_AREA.EM_ANDAMENTO ? `conclui junto${dataConclusao ? ` em ${formatarDiaAtividade(dataConclusao)}` : ""}` : "fica não iniciada"}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      }
      onFechar={onFechar}
      onEnviar={onEnviar}
      onConsultar={onConsultar}
    />
  );
}
