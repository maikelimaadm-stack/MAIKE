import React from "react";
import { cn } from "@/lib/utils";

/**
 * Campo dos formulários de lançamento (pesagem, nascimento, morte, abate,
 * movimentação, tarefa, bebedouro, suplementação…) no padrão `.mg-field` do
 * Base1: rótulo dentro do campo, que sobe ao focar ou quando há valor.
 *
 * Aceita qualquer controle como filho (Input, SelectTrigger, Textarea,
 * autocomplete). Como o valor vive no controle, "tem valor" é lido do DOM a
 * cada render e a cada digitação.
 *
 * @param {{
 *   label: React.ReactNode,
 *   required?: boolean,
 *   error?: boolean | string,
 *   dataField?: string,
 *   className?: string,
 *   children: React.ReactNode,
 * }} props
 */
export default function LancField({ label, required = false, error = false, dataField, className, children }) {
  const ref = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const [temValor, setTemValor] = React.useState(false);
  const [multilinha, setMultilinha] = React.useState(false);
  const idGerado = React.useId();
  const [alvoId, setAlvoId] = React.useState(/** @type {string | undefined} */ (undefined));

  const ler = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const campo = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (el.querySelector("input:not([type=hidden]), textarea"));
    const combo = el.querySelector('button[role="combobox"]');
    let valor = false;
    if (campo) {
      const tipo = campo.getAttribute("type") || "";
      valor = /^(date|time|datetime-local|month)$/.test(tipo) || String(campo.value ?? "").trim() !== "";
    }
    if (!valor && combo) valor = !combo.hasAttribute("data-placeholder") && (combo.textContent ?? "").trim() !== "";
    if (!valor && !campo && !combo) valor = (el.querySelector(".mg-field__control")?.textContent ?? "").trim() !== "";
    setTemValor(valor);
    setMultilinha(Boolean(el.querySelector("textarea")));
    // Nome acessível: o rótulo aponta para o controle (input, textarea ou combobox).
    const alvo = campo ?? combo;
    if (alvo) {
      if (!alvo.id) alvo.id = idGerado;
      setAlvoId(alvo.id);
    }
  }, [idGerado]);

  React.useLayoutEffect(ler);

  return (
    <div data-field={dataField} className={cn("cadastro-b1 mk-lanc", className)} ref={ref} onInput={ler} onChange={ler} onBlur={ler}>
      <div
        className={cn(
          "mg-field",
          temValor && "mg-has-value",
          multilinha && "mg-field--multiline",
          error && "is-invalid",
        )}
      >
        <label className="mg-field__label" htmlFor={alvoId}>
          {label}
          {required ? <span className="req"> *</span> : null}
        </label>
        <div className="mg-field__control">{children}</div>
      </div>
      {typeof error === "string" && error ? (
        <p className="mg-b1-field-msg" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
