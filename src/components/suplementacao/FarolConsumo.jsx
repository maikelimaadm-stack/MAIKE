import React from "react";
import { FAROL_CONSUMO } from "@/domain/suplementacao/fechamentoConsumo";

/**
 * D-PROD-206 — exibição do fechamento do consumo: o farol (sempre com o texto,
 * não só a cor), consumo g/cab/dia, %PV real × esperado, custo e a marca
 * "Aproximado" quando a sobra final não foi medida.
 * D-PROD-210: na base g/cab/dia a meta é em gramas ("g/cab/dia real × meta") e o
 * %PV real aparece só como informação, sem %PV esperado.
 */

const COR_SELO = Object.freeze({
  vermelho: "border-red-200 bg-red-50 text-red-700",
  verde: "border-emerald-200 bg-emerald-50 text-emerald-700",
  azul: "border-sky-200 bg-sky-50 text-sky-700",
  neutro: "border-slate-200 bg-slate-50 text-slate-600",
});

const MOTIVO = Object.freeze({
  sem_esperado: "sem consumo esperado (formulação ou peso)",
  cocho_compartilhado: "cocho compartilhado",
});

/** @param {number|null|undefined} v @param {number} casas */
const fmt = (v, casas) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) : null;

/** @param {number|null|undefined} v */
const reais = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null);

/**
 * Selo do farol: símbolo + texto ("🟢 Dentro (±15%)"); sem referência traz o motivo.
 * @param {{ farol: keyof typeof FAROL_CONSUMO, motivo?: string|null, faixa?: number|null }} props
 */
export function FarolConsumoSelo({ farol, motivo, faixa }) {
  const info = FAROL_CONSUMO[farol] ?? FAROL_CONSUMO.sem_referencia;
  const detalhe = farol === "sem_referencia"
    ? (motivo && MOTIVO[motivo] ? ` — ${MOTIVO[motivo]}` : "")
    : typeof faixa === "number" ? ` (±${fmt(faixa, 0) ?? faixa}%)` : "";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${COR_SELO[info.cor]}`}
      data-testid="farol-consumo"
      data-farol={farol}
    >
      <span aria-hidden="true">{info.simbolo}</span>
      <span>{info.rotulo}{detalhe}</span>
    </span>
  );
}

/** @param {{ label: string, value: React.ReactNode }} props */
function Celula({ label, value }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-1 py-1">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}

/**
 * Resumo do fechamento do consumo (`resumoDoFechamento` / `calcularFechamentoConsumo`).
 * @param {{ resumo: ReturnType<typeof import("@/domain/suplementacao/fechamentoConsumo").calcularFechamentoConsumo> | null, previa?: boolean }} props
 */
export function ResumoFechamentoConsumo({ resumo, previa = false }) {
  if (!resumo) return null;
  const relacaoPct = typeof resumo.consumo_relacao_esperado === "number" ? resumo.consumo_relacao_esperado * 100 : null;
  const pvReal = fmt(resumo.consumo_real_pv_percentual, 3);
  const pvEsperado = fmt(resumo.consumo_esperado_pv_percentual, 3);
  const emGramas = resumo.base_consumo_aplicada === "G_CAB_DIA";
  const gReal = fmt(resumo.consumo_g_cab_dia, 0);
  const gMeta = fmt(resumo.consumo_esperado_g_cab_dia, 0);
  return (
    <div className="space-y-1" data-testid={previa ? "fechamento-consumo-previa" : "fechamento-consumo"}>
      <div className="flex flex-wrap items-center gap-1">
        <FarolConsumoSelo farol={resumo.farol_consumo} motivo={resumo.farol_consumo_motivo} faixa={resumo.faixa_tolerancia_aplicada} />
        {relacaoPct !== null && <span className="text-[10px] text-slate-600">{fmt(relacaoPct, 0)}% do esperado</span>}
        {resumo.sobra_informada === false && (
          <span className="text-[10px] font-semibold text-amber-700" data-testid="fechamento-aproximado">Aproximado — sobra não informada</span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
        {emGramas ? (
          <>
            <Celula label="g/cab/dia real × meta" value={gReal ? `${gReal} g × ${gMeta ? `${gMeta} g` : "-"}` : "-"} />
            <Celula label="%PV real (informação)" value={pvReal ? `${pvReal}%` : "-"} />
          </>
        ) : (
          <>
            <Celula label="Consumo g/cab/dia" value={gReal ? `${gReal} g` : "-"} />
            <Celula label="%PV real × esperado" value={pvReal ? `${pvReal}% × ${pvEsperado ?? "-"}${pvEsperado ? "%" : ""}` : "-"} />
          </>
        )}
        <Celula label="Custo R$/cab/dia" value={reais(resumo.custo_cab_dia) ?? "Sem custo"} />
        <Celula
          label="Custo do período"
          value={reais(resumo.custo_total_periodo) ? `${reais(resumo.custo_total_periodo)} · ${reais(resumo.custo_unitario_kg)}/kg` : "Sem custo"}
        />
      </div>
    </div>
  );
}
