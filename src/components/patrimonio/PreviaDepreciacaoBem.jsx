import React from "react";
import { ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { formatarMoeda, formatarNumero } from "@/lib/dinheiroDecimal";
import { LOCALE_BEM } from "@/components/patrimonio/bemFormulario";

export const ROTULO_PREVIA_DEPRECIACAO = "Prévia simulada — não é lançamento contábil";

/** @param {unknown} v */
const moeda = (v) => formatarMoeda(v, { locale: LOCALE_BEM, moeda: "BRL" });

/** "2026-11" → "11/2026". @param {unknown} c */
const competencia = (c) => (typeof c === "string" && /^\d{4}-\d{2}$/.test(c) ? `${c.slice(5)}/${c.slice(0, 4)}` : "—");

/**
 * Resultado da prévia de depreciação linear (§6) devolvido pelo servidor. É uma
 * SIMULAÇÃO gerencial: não grava nada e não mostra valor contábil nem
 * depreciação acumulada (o ledger é de um slice futuro).
 *
 * @param {{ previa: any }} props
 */
export default function PreviaDepreciacaoBem({ previa }) {
  if (!previa || typeof previa !== "object") return null;
  const meses = Number.isInteger(previa.vida_util_meses) ? previa.vida_util_meses : null;
  return (
    <section
      className="col-span-12 mt-1 rounded-md border border-blue-200 bg-blue-50/40 p-2"
      aria-label={ROTULO_PREVIA_DEPRECIACAO}
      data-testid="bem-previa-depreciacao"
    >
      <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-blue-900">{ROTULO_PREVIA_DEPRECIACAO}</h4>
      <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
        <ValorCalculado label="Custo base" valor={moeda(previa.custo_base)} testId="bem-previa-custo-base" />
        <ValorCalculado label="Valor residual" valor={moeda(previa.valor_residual)} testId="bem-previa-residual" />
        <ValorCalculado label="Valor depreciável" valor={moeda(previa.valor_depreciavel)} testId="bem-previa-depreciavel" />
        <ValorCalculado label="Quota mensal" valor={moeda(previa.quota_mensal)} testId="bem-previa-quota-mensal" destaque />
        <ValorCalculado label="Última quota" valor={moeda(previa.ultima_quota)} testId="bem-previa-ultima-quota" />
        <ValorCalculado label="Quota anual" valor={moeda(previa.quota_anual)} testId="bem-previa-quota-anual" />
        <ValorCalculado
          label="Taxa anual"
          valor={typeof previa.taxa_anual_percentual === "string" ? `${formatarNumero(previa.taxa_anual_percentual, { locale: LOCALE_BEM, casasMax: 4 })} %` : "—"}
          testId="bem-previa-taxa"
        />
        <ValorCalculado label="Vida útil" valor={meses === null ? "—" : `${meses} ${meses === 1 ? "mês" : "meses"}`} testId="bem-previa-vida" />
        <ValorCalculado
          label="Competências"
          valor={`${competencia(previa.primeira_competencia)} a ${competencia(previa.ultima_competencia)}`}
          testId="bem-previa-competencias"
        />
      </div>
      <p className="mt-2 text-[11px] text-[var(--mg-text-2,#475569)]">
        Método linear, sem pró-rata: a primeira quota é a do mês de início e a diferença de arredondamento fica na última. Não gera lançamento,
        título, despesa nem movimento de estoque.
      </p>
    </section>
  );
}
