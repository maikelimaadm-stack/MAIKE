import React from "react";
import { B1_FIELD_INPUT_CLS } from "./B1Field";

/**
 * Seletor simples dentro de `.mg-field` (piloto Marcas; opções fixas).
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(v: string) => void} props.onChange
 * @param {{ value: string; label: string }[]} props.options
 * @param {boolean} [props.disabled]
 * @param {string} [props.id]
 */
export function MgSelect({ value, onChange, options, disabled, id }) {
  return (
    <select
      id={id}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${B1_FIELD_INPUT_CLS} cursor-pointer appearance-none`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
