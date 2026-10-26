import React from "react";
import { cn } from "@/lib/utils";

/**
 * Sim/Não estilo central de vendas (`ChaveSimNao` — CONTROLE-DE-ESTOQUE).
 *
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(v: boolean) => void} [props.onChange]
 * @param {boolean} [props.disabled]
 * @param {string} [props.id]
 * @param {string} [props.className]
 * @param {string} [props.ariaLabel]
 * @param {boolean} [props.showText] exibe "Sim"/"Não" ao lado (padrão true)
 */
export default function B1Switch({
  checked,
  onChange,
  disabled = false,
  id,
  className,
  ariaLabel,
  showText = true,
}) {
  const readOnly = !onChange;
  return (
    <span className={cn("b1-switch-wrap", className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-readonly={readOnly || undefined}
        disabled={disabled}
        className="b1-switch"
        onClick={() => {
          if (!readOnly && !disabled) onChange(!checked);
        }}
      >
        <span className="b1-switch__thumb" aria-hidden />
      </button>
      {showText ? (
        <span className="b1-switch__text" data-parte="valor">{checked ? "Sim" : "Não"}</span>
      ) : null}
    </span>
  );
}
