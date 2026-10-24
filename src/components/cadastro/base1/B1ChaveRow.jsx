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

/**
 * Linha Sim/Não do cadastro Base1 (paridade `ChaveSimNao` / `.chave` — CONTROLE-DE-ESTOQUE).
 * Faixa branca com borda; rótulo à esquerda e switch à direita — sem `mg-field` / rótulo flutuante.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number} [props.span]
 * @param {boolean} props.checked
 * @param {(v: boolean) => void} [props.onChange]
 * @param {boolean} [props.disabled]
 * @param {string} [props.ariaLabel]
 * @param {boolean} [props.showText]
 * @param {string} [props.className]
 * @param {string} [props.controlId]
 */
export default function B1ChaveRow({
  label,
  span = 12,
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  showText = true,
  className,
  controlId,
}) {
  const generated = React.useId();
  const id = controlId ?? generated;

  return (
    <div className={cn("col-span-12", SPAN[span] ?? "md:col-span-12", className)}>
      <div className="b1-chave-row" data-chave-row>
        <span className="b1-chave-row__label" id={`${id}-label`}>{label}</span>
        <div className="b1-chave-row__control">
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
