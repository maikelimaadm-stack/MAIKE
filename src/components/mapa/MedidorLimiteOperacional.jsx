import React, { useId } from "react";
import { formatarPercentualNivel } from "@/domain/suplementacao/nivelSuplementacao";

/**
 * Medidor do uso do LIMITE OPERACIONAL (cocho e depósito), D-PROD-178.
 *
 * O percentual é BRUTO: pode passar de 100% e aparece como número visível e em
 * `aria-valuenow`; só o preenchimento da barra é limitado a 0..100%.
 *
 * Leitor de tela: o `role="meter"` é a fonte única. `aria-valuetext` traz a
 * frase completa (`textoAcessivel`, ex.: "200% do limite operacional: 600 kg
 * de 300 kg, 300 kg acima"); o número e a descrição visíveis ficam fora da
 * árvore acessível para não serem lidos de novo (sem `aria-describedby`).
 *
 * Sem valor (limite não configurado, sem estimativa) o medidor fica neutro: não
 * há `role="meter"`, a trilha é tracejada e sem preenchimento (não parece um
 * "0%") e a `descricao` aparece com a `orientacao` do que fazer.
 *
 * @param {{
 *   percentualBruto: number|null,
 *   rotulo: string,
 *   descricao?: string,
 *   textoAcessivel?: string,
 *   orientacao?: string|null,
 *   variante?: 'normal'|'excesso'|'neutro',
 *   className?: string,
 * }} props
 *   `variante` ausente: neutro sem valor, excesso acima de 100, normal no resto.
 *   `textoAcessivel` ausente: "75%: <descricao>".
 */
export default function MedidorLimiteOperacional({ percentualBruto, rotulo, descricao = "", textoAcessivel, orientacao = null, variante, className = "" }) {
  const idRotulo = `${useId()}-rotulo`;
  const temValor = typeof percentualBruto === "number" && Number.isFinite(percentualBruto);
  const valor = temValor ? Math.max(0, /** @type {number} */ (percentualBruto)) : null;
  const tipo = variante || (valor == null ? "neutro" : valor > 100 ? "excesso" : "normal");
  const textoValor = valor != null ? formatarPercentualNivel(valor) : "";

  const corPreenchimento = tipo === "excesso" ? "bg-amber-500" : "bg-emerald-600";
  const corValor = tipo === "excesso" ? "text-amber-800" : "text-slate-900";
  const corDescricao = tipo === "excesso" ? "font-medium text-amber-800" : "text-slate-600";

  if (valor == null) {
    return (
      <div className={`flex min-w-0 flex-col gap-1 ${className}`} data-variante={tipo}>
        <span id={idRotulo} className="text-[10px] font-medium text-slate-500">{rotulo}</span>
        <div data-medidor-trilha="neutra" aria-hidden="true" className="h-2 w-full rounded-full border border-dashed border-slate-300" />
        {descricao && <span className="text-[10px] text-slate-600">{descricao}</span>}
        {orientacao && <span className="text-[10px] leading-snug text-slate-500">{orientacao}</span>}
      </div>
    );
  }

  const largura = tipo === "neutro" ? 0 : Math.min(100, valor);
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span id={idRotulo} className="text-[10px] font-medium text-slate-500">{rotulo}</span>
        <span aria-hidden="true" className={`text-sm font-bold tabular-nums ${corValor}`}>{textoValor}</span>
      </div>
      <div
        role="meter"
        aria-labelledby={idRotulo}
        aria-valuemin={0}
        aria-valuemax={Math.max(100, Math.round(valor * 100) / 100)}
        aria-valuenow={Math.round(valor * 100) / 100}
        aria-valuetext={textoAcessivel || (descricao ? `${textoValor}: ${descricao}` : textoValor)}
        data-variante={tipo}
      >
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            data-medidor-preenchimento=""
            className={`h-full rounded-full ${corPreenchimento} transition-[width] duration-300`}
            style={{ width: `${largura}%` }}
          />
        </div>
      </div>
      {descricao && <span aria-hidden="true" className={`text-[10px] ${corDescricao}`}>{descricao}</span>}
    </div>
  );
}
