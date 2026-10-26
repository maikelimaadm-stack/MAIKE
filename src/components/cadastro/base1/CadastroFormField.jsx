import React from "react";
import {
  CADASTRO_AC_INPUT_CLS,
  CADASTRO_INPUT_CLS,
  CADASTRO_SELECT_CLS,
  CADASTRO_TEXTAREA_CLS,
} from "./cadastroBase1Form.js";

/**
 * Campo de formulário padrão controle de estoque (label acima, borda slate, foco emerald).
 *
 * @param {object} props
 * @param {string} props.label
 * @param {boolean} [props.required]
 * @param {boolean} [props.error]
 * @param {import("react").ReactNode} props.children
 * @param {string|undefined} [props.dataField]
 * @param {string} [props.className]
 */
export default function CadastroFormField({
  label,
  required = false,
  error = false,
  children,
  dataField = undefined,
  className = "",
}) {
  return (
    <div data-field={dataField} className={`cadastro-b1-form-field ${className}`.trim()}>
      <label className="cadastro-b1-form-field__label">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className={error ? "border-red-500 bg-red-50" : undefined}>{children}</div>
    </div>
  );
}

export {
  CADASTRO_INPUT_CLS,
  CADASTRO_SELECT_CLS,
  CADASTRO_AC_INPUT_CLS,
  CADASTRO_TEXTAREA_CLS,
};
