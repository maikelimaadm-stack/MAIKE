import React, { useId } from "react";
import { formatarPercentualNivel } from "@/domain/suplementacao/nivelSuplementacao";

/**
 * Medidor do uso do LIMITE OPERACIONAL (cocho e depósito), D-PROD-178.
 *
 * O percentual é BRUTO: pode passar de 100% e aparece como número visível e em
 * `aria-valuenow`; só o preenchimento da barra é limitado a 0..100%. Sem valor
 * (limite não configurado, sem estimativa) o medidor fica neutro e mostra a
 * `descricao` — não há `role="meter"`, porque não há o que medir.
 *
 * @param {{
 *   percentualBruto: number|null,
 *   rotulo: string,
 *   descricao?: string,
 *   variante?: 'normal'|'excesso'|'neutro',
 *   className?: string,
 * }} props
 *   `variante` ausente: neutro sem valor, excesso acima de 100, normal no resto.
 */
export default function MedidorLimiteOperacional({ percentualBruto, rotulo, descricao = "", variante, className = "" }) {
  const id = useId();
  const idRotulo = `${id}-rotulo`;
  const idDescricao = `${id}-descricao`;
  const temValor = typeof percentualBruto === "number" && Number.isFinite(percentualBruto);
  const valor = temValor ? Math.max(0, /** @type {number} */ (percentualBruto)) : null;
  const tipo = variante || (valor == null ? "neutro" : valor > 100 ? "excesso" : "normal");
  const largura = valor == null || tipo === "neutro" ? 0 : Math.min(100, valor);
  const textoValor = valor != null ? formatarPercentualNivel(valor) : "";

  const corPreenchimento = tipo === "excesso" ? "bg-amber-500" : "bg-emerald-600";
  const corValor = tipo === "excesso" ? "text-amber-800" : "text-slate-900";

  const trilha = (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        data-medidor-preenchimento=""
        className={`h-full rounded-full ${corPreenchimento} transition-[width] duration-300`}
        style={{ width: `${largura}%` }}
      />
    </div>
  );

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`} data-variante={valor == null ? tipo : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span id={idRotulo} className="text-[10px] font-medium text-slate-500">{rotulo}</span>
        {valor != null && <span className={`text-sm font-bold tabular-nums ${corValor}`}>{textoValor}</span>}
      </div>
      {valor != null ? (
        <div
          role="meter"
          aria-labelledby={idRotulo}
          aria-describedby={descricao ? idDescricao : undefined}
          aria-valuemin={0}
          aria-valuemax={Math.max(100, Math.round(valor * 100) / 100)}
          aria-valuenow={Math.round(valor * 100) / 100}
          aria-valuetext={descricao ? `${textoValor} ${descricao}` : textoValor}
          data-variante={tipo}
        >
          {trilha}
        </div>
      ) : (
        <div aria-hidden="true">{trilha}</div>
      )}
      {descricao && <span id={idDescricao} className={`text-[10px] ${tipo === "excesso" ? "font-medium text-amber-800" : "text-slate-600"}`}>{descricao}</span>}
    </div>
  );
}
