import React from "react";
import B1Select from "@/components/cadastro/base1/B1Select";
import { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";

/*
 * A mesma interface do Select do shadcn (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`,
 * `SelectItem`), desenhada com o campo de escolha do motor (`B1Select`: janela das listas, "Pesquisar…",
 * MAIÚSCULAS, sem a opção vazia na lista; D-PROD-172). Formulários que já usavam o Select do shadcn
 * passam ao motor trocando só o import (D-PROD-174).
 *
 * A opção "Selecione…" (valor sentinela, ex.: "__none__") vira o campo vazio: não aparece na lista,
 * e o ✕ do campo devolve o valor sentinela, como antes.
 */

/** Texto de um nó React (rótulo da opção, mesmo com ícone ou bolinha de cor ao lado). */
function textoDe(no) {
  if (no == null || typeof no === "boolean") return "";
  if (typeof no === "string" || typeof no === "number") return String(no);
  if (Array.isArray(no)) return no.map(textoDe).join("");
  if (React.isValidElement(no)) return textoDe(/** @type {any} */ (no.props).children);
  return "";
}

/** @param {{ value: string, children?: React.ReactNode, disabled?: boolean, className?: string }} _props */
export function SelectItem(_props) {
  return null;
}

/** @param {{ placeholder?: string, children?: React.ReactNode }} _props */
export function SelectValue(_props) {
  return null;
}

/** @param {{ children?: React.ReactNode, className?: string }} _props */
export function SelectTrigger(_props) {
  return null;
}

/** @param {{ children?: React.ReactNode, className?: string }} _props */
export function SelectContent(_props) {
  return null;
}

const EH_SELECIONE = /^\s*selecione/i;

/**
 * @param {{
 *   value?: string,
 *   onValueChange?: (valor: string) => void,
 *   disabled?: boolean,
 *   children?: React.ReactNode,
 *   "aria-label"?: string,
 * }} props
 */
export function Select({ value, onValueChange, disabled = false, children, ...resto }) {
  /** @type {Array<{ value: string, label: string, disabled?: boolean }>} */
  const itens = [];
  let rotuloAcessivel = resto["aria-label"];
  const visitar = (nos) =>
    React.Children.forEach(nos, (no) => {
      if (!React.isValidElement(no)) return;
      const props = /** @type {any} */ (no.props);
      if (no.type === SelectItem) {
        itens.push({ value: String(props.value), label: textoDe(props.children).trim(), disabled: props.disabled });
        return;
      }
      if (no.type === SelectTrigger && props["aria-label"] && !rotuloAcessivel) rotuloAcessivel = props["aria-label"];
      if (props.children) visitar(props.children);
    });
  visitar(children);

  // "Selecione…" é o campo vazio do motor: valor "" para o B1Select, sentinela de volta para quem usa.
  const sentinela = itens.find((o) => EH_SELECIONE.test(o.label))?.value ?? null;
  const atual = value == null || (sentinela !== null && String(value) === sentinela) ? "" : String(value);

  return (
    <B1Select
      aria-label={rotuloAcessivel}
      value={atual}
      onChange={(e) => {
        const v = /** @type {HTMLSelectElement} */ (e.target).value;
        onValueChange?.(v === "" && sentinela !== null ? sentinela : v);
      }}
      disabled={disabled}
      className={B1_FIELD_CTL_CLS}
      pesquisa="sempre"
      semOpcaoVazia
      maiusculas
    >
      {sentinela !== null ? <option value="" /> : null}
      {itens
        .filter((o) => o.value !== sentinela)
        .map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
    </B1Select>
  );
}
