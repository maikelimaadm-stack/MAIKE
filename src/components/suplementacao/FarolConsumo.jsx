import React from "react";
import { FAROL_CONSUMO } from "@/domain/suplementacao/fechamentoConsumo";
import { LinhaHistorico } from "@/components/lotes/CartaoHistorico";

/**
 * D-PROD-206 — exibição do fechamento do consumo: o farol (sempre com o texto,
 * não só a cor), consumo g/cab/dia, %PV real × esperado, custo e a marca
 * "Aproximado" quando a sobra final não foi medida.
 * D-PROD-210: na base g/cab/dia a meta é em gramas ("g/cab/dia real × meta") e o
 * %PV real aparece só como informação, sem %PV esperado.
 * D-PROD-212: o peso médio do período (base do esperado na base %PV; marcado
 * aproximado quando não houve curva ou peso) e a sobra herdada que saiu primeiro
 * no custo do período.
 */

/** Por que o peso médio do período é aproximado; exportado para o detalhe do cocho v12 (D-PROD-220). */
export const MOTIVO_PESO = Object.freeze({
  sem_data: "sem data do lançamento",
  sem_lotes: "sem os lotes do período",
  sem_curva: "lote sem curva de ganho gravada",
  sem_peso: "lote sem peso próprio",
});

const COR_SELO = Object.freeze({
  vermelho: "border-red-200 bg-red-50 text-red-700",
  verde: "border-emerald-200 bg-emerald-50 text-emerald-700",
  azul: "border-sky-200 bg-sky-50 text-sky-700",
  neutro: "border-slate-200 bg-slate-50 text-slate-600",
});

/** Por que o farol ficou sem referência; exportado para o detalhe do cocho v12 (D-PROD-220). */
export const MOTIVO_SEM_REFERENCIA = Object.freeze({
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
    ? (motivo && MOTIVO_SEM_REFERENCIA[motivo] ? ` — ${MOTIVO_SEM_REFERENCIA[motivo]}` : "")
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

/** @typedef {"caixas" | "linhas" | "kpis"} DesenhoDoResumo */

/** Desenho de cada célula: o da grade de caixinhas (padrão) e os dois sem caixa dentro de caixa (D-PROD-222). */
const DesenhoCtx = React.createContext(/** @type {DesenhoDoResumo} */ ("caixas"));

/** @param {{ label: string, value: React.ReactNode }} props */
function Celula({ label, value }) {
  const desenho = React.useContext(DesenhoCtx);
  // No cartão do histórico: uma linha "Rótulo: valor" do Histórico de Movimentação.
  if (desenho === "linhas") return <LinhaHistorico rotulo={label}>{value}</LinhaHistorico>;
  // No aviso do lançamento: a célula sem borda dos números ao lado (Fornecido, Consumido…).
  if (desenho === "kpis") {
    return (
      <div className="min-w-0">
        <dt className="text-[11px] text-slate-500">{label}</dt>
        <dd className="font-semibold text-slate-800">{value}</dd>
      </div>
    );
  }
  return (
    <div className="rounded border border-slate-200 bg-white px-1 py-1">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}

/** Onde as células ficam, por desenho. @type {Record<DesenhoDoResumo, string>} */
const GRADE_DO_DESENHO = {
  caixas: "grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]",
  linhas: "space-y-0.5",
  kpis: "grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4",
};

/**
 * Resumo do fechamento do consumo (`resumoDoFechamento` / `calcularFechamentoConsumo`).
 * `desenho` (D-PROD-222): "caixas" (padrão) é a grade de caixinhas; "linhas" põe cada número numa linha
 * "Rótulo: valor", como os cartões do Histórico de Movimentação (cartão do histórico do cocho); "kpis" usa
 * as células sem borda dos números do aviso do lançamento. Os números e os textos são os mesmos.
 * @param {{ resumo: ReturnType<typeof import("@/domain/suplementacao/fechamentoConsumo").calcularFechamentoConsumo> | null, previa?: boolean, desenho?: DesenhoDoResumo }} props
 */
export function ResumoFechamentoConsumo({ resumo, previa = false, desenho = "caixas" }) {
  if (!resumo) return null;
  const relacaoPct = typeof resumo.consumo_relacao_esperado === "number" ? resumo.consumo_relacao_esperado * 100 : null;
  const pvReal = fmt(resumo.consumo_real_pv_percentual, 3);
  const pvEsperado = fmt(resumo.consumo_esperado_pv_percentual, 3);
  const emGramas = resumo.base_consumo_aplicada === "G_CAB_DIA";
  const gReal = fmt(resumo.consumo_g_cab_dia, 0);
  const gMeta = fmt(resumo.consumo_esperado_g_cab_dia, 0);
  // "kpis" fica numa lista de definições (<dl>), como os números do aviso; os outros, num <div>.
  const Grade = desenho === "kpis" ? "dl" : "div";
  return (
    <div className="space-y-1" data-testid={previa ? "fechamento-consumo-previa" : "fechamento-consumo"}>
      <div className="flex flex-wrap items-center gap-1">
        <FarolConsumoSelo farol={resumo.farol_consumo} motivo={resumo.farol_consumo_motivo} faixa={resumo.faixa_tolerancia_aplicada} />
        {relacaoPct !== null && <span className="text-[10px] text-slate-600">{fmt(relacaoPct, 0)}% do esperado</span>}
        {resumo.sobra_informada === false && (
          <span className="text-[10px] font-semibold text-amber-700" data-testid="fechamento-aproximado">Aproximado — sobra não informada</span>
        )}
      </div>
      <DesenhoCtx.Provider value={desenho}>
        <Grade className={GRADE_DO_DESENHO[desenho] || GRADE_DO_DESENHO.caixas} data-desenho={desenho}>
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
          {typeof resumo.peso_medio_periodo_kg === "number" && (
            <Celula
              label="Peso médio do período"
              value={
                <span data-testid="peso-medio-periodo">
                  {fmt(resumo.peso_medio_periodo_kg, 0)} kg
                  {resumo.peso_medio_periodo_aproximado ? (
                    <span className="ml-1 font-normal text-amber-700" title={MOTIVO_PESO[resumo.peso_medio_periodo_motivo] ?? ""}>
                      (aproximado{MOTIVO_PESO[resumo.peso_medio_periodo_motivo] ? `: ${MOTIVO_PESO[resumo.peso_medio_periodo_motivo]}` : ""})
                    </span>
                  ) : null}
                </span>
              }
            />
          )}
          <Celula label="Custo R$/cab/dia" value={reais(resumo.custo_cab_dia) ?? "Sem custo"} />
          <Celula
            label="Custo do período"
            value={reais(resumo.custo_total_periodo) ? `${reais(resumo.custo_total_periodo)} · ${reais(resumo.custo_unitario_kg)}/kg` : "Sem custo"}
          />
        </Grade>
      </DesenhoCtx.Provider>
      {typeof resumo.sobra_herdada_kg === "number" && resumo.sobra_herdada_kg > 0 && typeof resumo.custo_sobra_herdada_kg === "number" && (
        <div className="text-[10px] text-slate-600" data-testid="custo-sobra-herdada">
          Sobra antiga primeiro: {fmt(resumo.sobra_herdada_kg, 2)} kg a {reais(resumo.custo_sobra_herdada_kg)}/kg
          {resumo.custo_sobra_aproximado ? <span className="ml-1 font-semibold text-amber-700">(custo da sobra aproximado)</span> : null}
        </div>
      )}
    </div>
  );
}
