import React, { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";
import { barraDoAndamento, erroDoUltimoDia, textoDosHectares, tituloDoConcluir } from "@/lib/servicoVariosDias";

/**
 * D-PROD-267 — o "Concluir" da linha da lista (maquete V3): "Concluir <operação> · <área>", um campo só — "Qual foi o
 * último dia?", já com o último dia lançado ("sugerido: último dia lançado") — e "40 de 40 ha (100%)" com a barra. Grava
 * pelo `POST /atividades/:id/concluir` de sempre (as áreas em andamento e a atividade, numa transação; o servidor recusa
 * o dia futuro, antes do início ou antes do último dia lançado). A data é conferida aqui antes da rede, com a mesma regra.
 *
 * @param {{ item: any, hoje: string, onFechar: () => void, onConcluir: (dia: string) => Promise<unknown> }} props
 */
export default function DialogoConcluirServico({ item, hoje, onFechar, onConcluir }) {
  const a = item?.andamento ?? {};
  const sugerido = typeof a.ultimo_dia === "string" && a.ultimo_dia ? a.ultimo_dia : hoje || "";
  const [dia, setDia] = useState(sugerido);
  const [erro, setErro] = useState(/** @type {string|null} */ (null));
  const [aviso, setAviso] = useState(/** @type {string|null} */ (null));
  const [enviando, setEnviando] = useState(false);
  const hectares = textoDosHectares(a.hectares_feitos, a.hectares_area, a.percentual);
  const barra = barraDoAndamento(item);

  const concluir = async () => {
    if (enviando) return;
    const e = erroDoUltimoDia(dia, { hoje, dataInicio: item?.data_inicio ?? null, ultimoDia: a.ultimo_dia ?? null });
    setErro(e);
    if (e) return;
    setEnviando(true);
    setAviso(null);
    try {
      await onConcluir(dia);
    } catch (falha) {
      setAviso(
        ehResultadoIncerto(falha)
          ? "Não recebemos a resposta do servidor: o serviço PODE ter sido concluído. Feche e confira a lista antes de tentar de novo."
          : mensagemDeErroAtividade(falha, "Não foi possível concluir. Nada foi alterado."),
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
      titulo={<span data-testid="dialogo-concluir-servico-titulo">Concluir {tituloDoConcluir(item)}</span>}
      testId="dialogo-concluir-servico"
      className="b1-concluir-servico"
      contentProps={{ "data-permissao-explicita": "" }}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid="dialogo-concluir-servico-cancelar">
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => void concluir()} disabled={enviando} data-testid="dialogo-concluir-servico-enviar">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {enviando ? "Concluindo…" : "Concluir"}
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
        {aviso ? (
          <p className="col-span-12 text-[12.5px] text-amber-800" role="alert" data-testid="dialogo-concluir-servico-erro">
            {aviso}
          </p>
        ) : null}
      </div>
    </B1Janela>
  );
}
