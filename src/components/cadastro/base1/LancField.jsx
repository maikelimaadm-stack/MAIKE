import React from "react";
import { cn } from "@/lib/utils";

/** Quantos campos de lançamento cada `<form>` tem (o atributo sai quando o último sai). */
const camposPorForm = new WeakMap();

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
  // Dentro de um <fieldset disabled> (registro em leitura do motor, D-PROD-174) o campo fica travado, como o B1Field `locked`.
  const [travado, setTravado] = React.useState(false);
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
    if (!valor && combo) {
      // Select do Radix (`aria-autocomplete="none"` + `data-state`): sem `data-placeholder` há valor
      // escolhido, mesmo antes de o texto do item chegar ao SelectValue — ele só chega depois de montar,
      // e nada re-renderiza o campo. Sem isso, o campo que monta já com valor (ex.: um Select do Radix que
      // remonta ao trocar outro campo) ficava com o rótulo por cima do valor (D-PROD-220).
      const selectRadix = combo.getAttribute("aria-autocomplete") === "none" && combo.hasAttribute("data-state");
      valor = !combo.hasAttribute("data-placeholder") && (selectRadix || (combo.textContent ?? "").trim() !== "");
    }
    if (!valor && !campo && !combo) valor = (el.querySelector(".mg-field__control")?.textContent ?? "").trim() !== "";
    setTemValor(valor);
    setMultilinha(Boolean(el.querySelector("textarea")));
    setTravado(Boolean(el.closest("fieldset:disabled")));
    // Nome acessível: o rótulo aponta para o controle (input, textarea ou combobox).
    const alvo = campo ?? combo;
    if (alvo) {
      if (!alvo.id) alvo.id = idGerado;
      setAlvoId(alvo.id);
    }
  }, [idGerado]);

  React.useLayoutEffect(ler);

  // Marca o <form> que tem campo de lançamento (`form[data-mk-lanc]`): o CSS dos botões desses formulários usava
  // `form:has(.mk-lanc)`, e esse `:has()` com descendente fazia o Chrome recalcular o estilo da página inteira a
  // cada mudança no DOM, em qualquer tela (D-PROD-166). Atributo, não classe: o React não mexe nele.
  React.useLayoutEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return undefined;
    camposPorForm.set(form, (camposPorForm.get(form) || 0) + 1);
    form.setAttribute("data-mk-lanc", "");
    return () => {
      const resta = (camposPorForm.get(form) || 1) - 1;
      if (resta > 0) {
        camposPorForm.set(form, resta);
        return;
      }
      camposPorForm.delete(form);
      form.removeAttribute("data-mk-lanc");
    };
  }, []);

  return (
    <div data-field={dataField} className={cn("cadastro-b1 mk-lanc", className)} ref={ref} onInput={ler} onChange={ler} onBlur={ler}>
      <div
        className={cn(
          "mg-field",
          temValor && "mg-has-value",
          multilinha && "mg-field--multiline",
          travado && "mg-field--locked",
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
