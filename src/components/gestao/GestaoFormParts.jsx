import React from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";

/** Título de seção do formulário Base1 (ocupa a linha inteira). */
export function SecaoForm({ titulo, children = null }) {
  return (
    <div className="col-span-12 mt-1 border-b border-[var(--mg-divider)] pb-0.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">{titulo}</h3>
      {children}
    </div>
  );
}

/**
 * Campo de texto Base1.
 * @param {{ label: string, value: string, onChange: (v: string) => void, readOnly?: boolean, required?: boolean,
 *   error?: string, span?: number, type?: string, placeholder?: string, maxLength?: number, inputMode?: string, keepCase?: boolean }} props
 */
export function CampoTexto({
  label,
  value,
  onChange,
  readOnly = false,
  required = false,
  error = undefined,
  span = 6,
  type = "text",
  placeholder = undefined,
  maxLength = undefined,
  inputMode = undefined,
  keepCase = false,
}) {
  return (
    <B1Field label={label} required={required} span={span} hasValue={Boolean(String(value ?? "").trim())} locked={readOnly} disabled={readOnly} error={error}>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={keepCase ? B1_FIELD_CTL_CLS.replace(" uppercase", " normal-case") : B1_FIELD_CTL_CLS}
        autoComplete="off"
        readOnly={readOnly}
        maxLength={maxLength}
        inputMode={/** @type {any} */ (inputMode)}
      />
    </B1Field>
  );
}

/**
 * Seletor Base1 (`B1Select`: painel no desktop, folha no celular).
 * @param {{ label: string, value: string, onChange: (v: string) => void, options: Array<{ value: string, label: string }>,
 *   readOnly?: boolean, required?: boolean, error?: string, span?: number, placeholder?: string }} props
 */
export function CampoSelect({ label, value, onChange, options, readOnly = false, required = false, error = undefined, span = 6, placeholder = undefined }) {
  return (
    <B1Field label={label} required={required} span={span} hasValue={Boolean(value)} locked={readOnly} disabled={readOnly} error={error}>
      <B1Select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={readOnly} className={B1_FIELD_CTL_CLS}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </B1Select>
    </B1Field>
  );
}

/** Aviso fixo da tela (empresa ausente, sem permissão…). */
export function AvisoGestao({ children, tone = "amber", testId = undefined }) {
  const cls =
    tone === "blue"
      ? "text-blue-900 bg-blue-50 border-blue-200"
      : "text-amber-800 bg-amber-50 border-amber-200";
  return (
    <div role="status" data-testid={testId} className={`cadastro-b1 mg-card p-3 text-xs border mb-2 ${cls}`}>
      {children}
    </div>
  );
}

/** Filtro de situação (ativos / inativos / todos) para a barra da lista. */
export function FiltroSituacao({ value, onChange }) {
  return (
    <div className="inline-flex h-8 min-w-[104px] items-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-xs font-medium">
      <B1Select
        aria-label="Filtrar por situação"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex w-full items-center justify-between gap-1.5 whitespace-nowrap bg-transparent text-xs"
      >
        <option value="ativos">Ativos</option>
        <option value="inativos">Inativos</option>
        <option value="todos">Todos</option>
      </B1Select>
    </div>
  );
}

/** @param {string} situacao @returns {boolean|undefined} */
export const ativoDoFiltro = (situacao) => (situacao === "ativos" ? true : situacao === "inativos" ? false : undefined);
