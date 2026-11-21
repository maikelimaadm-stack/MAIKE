import React from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { exemploDoLocale, lerNumeroLocal, paraTextoDeEdicao } from "@/lib/dinheiroDecimal";

const CTL_NUMERO = B1_FIELD_CTL_CLS.replace(" uppercase", " normal-case tabular-nums");

/**
 * Escolha exclusiva em botões (rádio acessível). Quebra linha no celular.
 * @param {{ rotulo: string, opcoes: Array<{ value: string, label: string }>, value: string, onChange: (v: string) => void,
 *   readOnly?: boolean, testId?: string, span?: 6 | 12 }} props
 */
export function EscolhaSegmentada({ rotulo, opcoes, value, onChange, readOnly = false, testId = undefined, span = 12 }) {
  return (
    <div className={`col-span-12 min-w-0 ${span === 6 ? "md:col-span-6" : ""}`}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">{rotulo}</p>
      <div role="radiogroup" aria-label={rotulo} data-testid={testId} className="flex flex-wrap gap-2">
        {opcoes.map((o) => {
          const ativo = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={ativo}
              disabled={readOnly && !ativo}
              onClick={() => (readOnly || ativo ? undefined : onChange(o.value))}
              className={`min-h-10 rounded-full border px-4 text-[13px] font-medium transition-colors ${
                ativo
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-[var(--mg-divider,#cbd5e1)] bg-white text-[var(--mg-text-1,#0f172a)] hover:bg-slate-50 disabled:opacity-50"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Campo numérico localizado (dinheiro, quantidade, preço, percentual): guarda o
 * TEXTO digitado; ao sair do campo, reescreve no formato do locale quando o
 * texto é válido. A conta é feita por quem usa (sem float).
 * @param {{ label: string, value: string, onChange: (v: string) => void, locale: string,
 *   limites: { casas: number, inteiros: number }, casasMin?: number, readOnly?: boolean, required?: boolean,
 *   error?: string|null, span?: number, ajuda?: string|null, testId?: string, sufixo?: string|null }} props
 */
export function CampoNumero({
  label,
  value,
  onChange,
  locale,
  limites,
  casasMin = 0,
  readOnly = false,
  required = false,
  error = null,
  span = 4,
  ajuda = null,
  testId = undefined,
  sufixo = null,
}) {
  const aoSair = () => {
    const r = lerNumeroLocal(value, locale, limites);
    if (r.ok) {
      const formatado = paraTextoDeEdicao(r.valor, locale, { casasMin, casasMax: limites.casas });
      if (formatado !== value) onChange(formatado);
    }
  };
  return (
    <B1Field label={label} required={required} span={span} hasValue={Boolean(String(value ?? "").trim())} locked={readOnly} disabled={readOnly} error={error || undefined}>
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={readOnly ? undefined : aoSair}
        placeholder={readOnly ? undefined : ajuda ?? exemploDoLocale(locale, Math.min(limites.casas, 2))}
        className={CTL_NUMERO}
        autoComplete="off"
        readOnly={readOnly}
        maxLength={32}
        data-testid={testId}
        aria-label={sufixo ? `${label} (${sufixo})` : undefined}
      />
    </B1Field>
  );
}

/**
 * Campo de dia (AAAA-MM-DD, `<input type="date">`): o valor é o TEXTO do dia,
 * sem `Date` local.
 * @param {{ label: string, value: string, onChange: (v: string) => void, readOnly?: boolean, required?: boolean,
 *   error?: string|null, span?: number, min?: string, max?: string, testId?: string }} props
 */
export function CampoDia({ label, value, onChange, readOnly = false, required = false, error = null, span = 4, min = undefined, max = undefined, testId = undefined }) {
  return (
    <B1Field label={label} required={required} span={span} hasValue locked={readOnly} disabled={readOnly} error={error || undefined}>
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={CTL_NUMERO}
        readOnly={readOnly}
        disabled={readOnly}
        min={min || undefined}
        max={max || undefined}
        data-testid={testId}
      />
    </B1Field>
  );
}

/**
 * Valor calculado (somente leitura) dentro da grade do formulário.
 * @param {{ label: string, valor: string, span?: number, testId?: string, destaque?: boolean, dica?: React.ReactNode }} props
 *   `dica` (D-PROD-271): a linha de ajuda embaixo do campo.
 */
export function ValorCalculado({ label, valor, span = 4, testId = undefined, destaque = false, dica = undefined }) {
  return (
    <B1Field label={label} span={span} hasValue locked dica={dica}>
      <output data-testid={testId} className={`${CTL_NUMERO} mg-input min-w-0 ${destaque ? "font-semibold" : ""}`} aria-label={label}>
        <span className="block min-w-0 truncate">{valor}</span>
      </output>
    </B1Field>
  );
}

/**
 * Indicador de diferença ao centavo (falta/sobra/fechado), lido por leitor de tela.
 * @param {{ testId: string, estado: 'fechado'|'falta'|'sobra'|'pendente', texto: string }} props
 */
export function IndicadorDiferenca({ testId, estado, texto }) {
  const cor =
    estado === "fechado"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : estado === "pendente"
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className="col-span-12 min-w-0">
      <p role="status" aria-live="polite" data-testid={testId} data-estado={estado} className={`rounded-md border px-3 py-2 text-[13px] font-medium ${cor}`}>
        {texto}
      </p>
    </div>
  );
}
