import React from "react";
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
 * Linha Sim/Não do cadastro Base1 (paridade `ChaveSimNao` / `data-chave` — CONTROLE-DE-ESTOQUE).
 * Desde a D-PROD-164 é a "chave em caixa" do design "Cadastro de Lote" em todas as telas: rótulo e chave
 * dentro da mesma caixa do campo (`mg-field mg-field--switch`), como o "Ativo" do Lote.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number} [props.span]
 * @param {number} [props.spanLg] largura no desktop (≥ 1024px); sem ela vale `span`
 * @param {boolean} props.checked
 * @param {(v: boolean) => void} [props.onChange]
 * @param {boolean} [props.disabled]
 * @param {string} [props.ariaLabel]
 * @param {boolean} [props.showText]
 * @param {string} [props.className]
 * @param {string} [props.controlId]
 * @param {string} [props.dataField] atributo data-field para scroll/validação
 */
export default function B1ChaveRow({
  label,
  span = 12,
  spanLg = undefined,
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  showText = false,
  className,
  controlId,
  dataField,
}) {
  const generated = React.useId();
  const id = controlId ?? generated;

  return (
    <div
      className={cn("col-span-12", SPAN[span] ?? "md:col-span-12", spanLg ? SPAN_LG[spanLg] : null, className)}
      data-field={dataField}
    >
      <div className={cn("mg-field mg-field--switch mg-has-value", disabled && "mg-field--disabled")} data-chave-row="">
        <span className="mg-field__label" id={`${id}-label`}>
          {label}
        </span>
        <div className="mg-field__control">
          <B1Switch
            id={id}
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            ariaLabel={ariaLabel ?? label}
            showText={showText}
          />
        </div>
      </div>
    </div>
  );
}
