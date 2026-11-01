import React from "react";

/** Chave liga/desliga no estilo do iOS (trilho arredondado, bolinha com sombra) — D-PROD-95. */
export default function ToggleSwitch({ checked, disabled = false, onChange, className = "", ariaLabel = undefined }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={`mk-ios-switch ${checked ? "is-on" : ""} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      aria-pressed={checked}>
      <span className="mk-ios-switch__thumb" aria-hidden />
    </button>);

}
