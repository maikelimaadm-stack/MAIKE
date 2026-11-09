import React from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";

/**
 * Peças de formulário de Patrimônio e Frota (D-PROD-157) que não existem em
 * `GestaoFormParts`: filtro em pílula da barra da lista, escolha múltipla
 * (`b1-multi`, botões `role="checkbox"`), texto longo e leitura de número inteiro.
 */

/**
 * Filtro em pílula para a barra da lista (mesmo visual de "Filtrar por situação").
 * @param {{ rotulo: string, value: string, onChange: (v: string) => void, opcoes: Array<{ value: string, label: string }> }} props
 */
export function FiltroOpcoes({ rotulo, value, onChange, opcoes }) {
  return (
    <div className="inline-flex h-8 min-w-[104px] items-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-xs font-medium">
      <B1Select
        aria-label={rotulo}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex w-full items-center justify-between gap-1.5 whitespace-nowrap bg-transparent text-xs"
      >
        {opcoes.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </B1Select>
    </div>
  );
}

/**
 * Escolha múltipla Base1 (`b1-multi`): cada opção é um botão `role="checkbox"`.
 * Opção `travada` fica sempre marcada (ex.: unidade padrão do perfil).
 * @param {{
 *   rotulo: string,
 *   opcoes: Array<{ value: string, label: string, travada?: boolean }>,
 *   valores: string[],
 *   onChange: (valores: string[]) => void,
 *   readOnly?: boolean,
 *   testId?: string,
 *   erro?: string|null,
 *   ajuda?: string|null,
 * }} props
 */
export function EscolhaMultipla({ rotulo, opcoes, valores, onChange, readOnly = false, testId = undefined, erro = null, ajuda = null }) {
  const alternar = (valor) => {
    if (readOnly) return;
    const marcado = valores.includes(valor);
    onChange(marcado ? valores.filter((v) => v !== valor) : [...valores, valor]);
  };
  return (
    <div className="col-span-12 min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">{rotulo}</p>
      <div className="b1-multi" role="group" aria-label={rotulo} data-testid={testId}>
        {opcoes.map((o) => {
          const on = o.travada === true || valores.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-disabled={readOnly || o.travada === true}
              disabled={readOnly || o.travada === true}
              onClick={() => alternar(o.value)}
              className={`b1-multi__op${on ? " is-on" : ""}`}
            >
              {on ? (
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                  <path d="M2 6l3 3 5-6" />
                </svg>
              ) : null}
              {o.label}
            </button>
          );
        })}
      </div>
      {ajuda ? <p className="mt-1 text-[11px] text-[var(--mg-text-2,#475569)]">{ajuda}</p> : null}
      {erro ? (
        <p className="mt-1 text-[11px] text-red-700" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Texto longo (especificações, observações) em `textarea` Base1, com limite de caracteres.
 * @param {{ label: string, value: string, onChange: (v: string) => void, readOnly?: boolean, maxLength: number, span?: number, placeholder?: string }} props
 */
export function CampoTextoLongo({ label, value, onChange, readOnly = false, maxLength, span = 12, placeholder = undefined }) {
  return (
    <B1Field label={label} span={span} hasValue={Boolean(String(value ?? "").trim())} locked={readOnly} disabled={readOnly} multiline>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={readOnly ? undefined : placeholder}
        className={`${B1_FIELD_CTL_CLS.replace(" uppercase", " normal-case")} min-h-[2.5rem] resize-y`}
        rows={2}
        readOnly={readOnly}
        maxLength={maxLength}
      />
    </B1Field>
  );
}

/**
 * Lê um inteiro digitado (vazio = `null`). Fora do intervalo ou não inteiro → `ok: false`.
 * @param {string} texto @param {{ min: number, max: number }} limites
 * @returns {{ ok: true, valor: number|null } | { ok: false }}
 */
export const lerInteiro = (texto, { min, max }) => {
  const t = String(texto ?? "").trim();
  if (!t) return { ok: true, valor: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < min || n > max) return { ok: false };
  return { ok: true, valor: n };
};

/** Inteiro do registro como texto do campo. @param {unknown} v */
export const textoDoInteiro = (v) => (Number.isInteger(v) ? String(v) : "");

/** Código de catálogo digitado: maiúsculas, espaços e hífens viram `_`. @param {string} texto */
export const normalizarCodigoCatalogo = (texto) => String(texto ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
