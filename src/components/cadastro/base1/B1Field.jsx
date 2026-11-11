import React from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import B1Switch from "./B1Switch";

const SPAN = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
  5: "md:col-span-5",
  6: "md:col-span-6",
  7: "md:col-span-7",
  8: "md:col-span-8",
  9: "md:col-span-9",
  10: "md:col-span-10",
  11: "md:col-span-11",
  12: "md:col-span-12",
};

/** Largura própria do desktop (≥ 1024px), quando difere da do tablet. */
const SPAN_LG = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  9: "lg:col-span-9",
  10: "lg:col-span-10",
  11: "lg:col-span-11",
  12: "lg:col-span-12",
};

/**
 * Campo flutuante Modelo Base1 (paridade CONTROLE-DE-ESTOQUE / B1Field).
 *
 * @param {object} props
 * @param {string} props.label
 * @param {boolean} [props.required]
 * @param {string | boolean} [props.error] texto do erro; `true` mostra "Campo obrigatório"
 * @param {number} [props.span]
 * @param {number} [props.spanLg] largura no desktop (≥ 1024px); sem ela vale `span`
 * @param {boolean} [props.hasValue]
 * @param {boolean} [props.multiline]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.locked]
 * @param {boolean} [props.open] seletor aberto (`is-open`)
 * @param {'default'|'switch'} [props.variant] `switch` para Sim/Não (B1Switch)
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.className] classe da coluna (div externa)
 * @param {string} [props.fieldClassName] classe extra do `.mg-field` (ex.: `b1-campo--num`)
 * @param {import('react').ReactNode} [props.dica] linha de apoio sob o campo (some quando há erro)
 * @param {string} [props.controlId]
 */
export default function B1Field({
  label,
  required = false,
  error,
  span = 6,
  spanLg = undefined,
  hasValue = true,
  multiline = false,
  disabled = false,
  locked = false,
  open = false,
  variant = "default",
  children,
  className,
  fieldClassName = undefined,
  dica = undefined,
  controlId,
}) {
  const generated = React.useId();
  const id = controlId ?? generated;
  const errId = `${id}-error`;
  const childExistingId =
    React.isValidElement(children) ? /** @type {{ id?: string }} */ (children.props).id : undefined;
  const child = React.isValidElement(children)
    ? React.cloneElement(children, {
        ...(childExistingId ? {} : { id }),
        ...(error
          ? {
              "aria-invalid": true,
              "aria-describedby": errId,
            }
          : {}),
      })
    : children;

  return (
    <div className={cn("col-span-12", SPAN[span] ?? "md:col-span-6", spanLg ? SPAN_LG[spanLg] : null, className)}>
      <div
        className={cn(
          "mg-field",
          variant === "switch" && "mg-field--switch",
          disabled && "mg-field--disabled",
          locked && !disabled && "mg-field--locked",
          (hasValue || variant === "switch") && "mg-has-value",
          multiline && "mg-field--multiline",
          open && "is-open",
          error && "is-invalid",
          fieldClassName,
        )}
      >
        <label htmlFor={id} className="mg-field__label">
          {label}
          {required ? <span className="req"> *</span> : null}
        </label>
        <div className="mg-field__control">{child}</div>
      </div>
      {error ? (
        <p id={errId} className="mg-b1-field-msg" role="alert">
          <CircleAlert className="b1-msg-ic" size={12} aria-hidden />
          {error === true || error === "true" ? "Campo obrigatório" : String(error)}
        </p>
      ) : null}
      {!error && dica ? dica : null}
    </div>
  );
}

/**
 * Chave Sim/Não em caixa, na mesma linha de base dos campos (D-PROD-163: "chave (Ativo) em caixa").
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number} [props.span]
 * @param {number} [props.spanLg]
 * @param {boolean} props.checked
 * @param {(v: boolean) => void} [props.onChange]
 * @param {boolean} [props.disabled]
 * @param {string} [props.dataField]
 * @param {string} [props.controlId]
 */
export function B1CampoChave({ label, span = 6, spanLg = undefined, checked, onChange, disabled = false, dataField, controlId }) {
  const generated = React.useId();
  const id = controlId ?? generated;
  return (
    <div className={cn("col-span-12", SPAN[span] ?? "md:col-span-6", spanLg ? SPAN_LG[spanLg] : null)} data-field={dataField}>
      <div className={cn("mg-field mg-field--switch mg-has-value", disabled && "mg-field--disabled")} data-chave-row="">
        <span className="mg-field__label" id={`${id}-label`}>
          {label}
        </span>
        <div className="mg-field__control">
          <B1Switch id={id} checked={checked} onChange={onChange} disabled={disabled} ariaLabel={label} />
        </div>
      </div>
    </div>
  );
}

/**
 * Controle dentro de `.mg-field` — paridade `ctl` do ResourceForm (CONTROLE-DE-ESTOQUE).
 * Preferir esta classe em formulários Base1 novos; `B1_FIELD_INPUT_CLS` permanece para legado.
 */
export const B1_FIELD_CTL_CLS =
  "h-5 w-full rounded-none border-0 bg-transparent px-0 text-[13px] font-medium uppercase text-[var(--mg-text-1)] shadow-none focus:ring-0 focus:outline-none read-only:bg-transparent disabled:bg-transparent disabled:text-[var(--mg-text-1)]";

/** @deprecated Use `B1_FIELD_CTL_CLS` em cadastros Base1 alinhados ao MG. */
export const B1_FIELD_INPUT_CLS = "mg-input uppercase";
