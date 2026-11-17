import React from "react";
import { ArrowRightLeft, LayoutGrid, Scale } from "lucide-react";
import { RodapePilulas } from "./blocos";

/*
 * Rodapé padrão do Detalhes do Lote v12 (D-PROD-218, especificação §E): três
 * pílulas fixas embaixo do corpo.
 * - pasto (abas Detalhes, Lotes, Histórico; Supl. sem cocho): "Mover lotes" ·
 *   "Pesar" · "Manejos", as três desabilitadas quando o pasto não tem lote;
 * - tela do lote: "Mover" · "Pesar" · "Manejos", sempre ativas.
 * Sem a permissão de mover ou de pesar, a pílula some. Quem decide quais lotes
 * cada ação leva (lote da tela › marcados › todos) é a casca (`onAlvo`).
 */

/**
 * @param {{
 *   tela: "pasto" | "lote",
 *   temLote: boolean,
 *   podeMover: boolean,
 *   podePesar: boolean,
 *   onMover?: () => void,
 *   onPesar?: () => void,
 *   onManejos: () => void,
 *   className?: string,
 * }} props
 */
export default function RodapePasto({ tela, temLote, podeMover, podePesar, onMover, onPesar, onManejos, className }) {
  const doPasto = tela !== "lote";
  const desabilitado = doPasto && !temLote;
  /** @type {import("./blocos").Pilula[]} */
  const itens = [];
  if (podeMover) itens.push({ chave: "mover", rotulo: doPasto ? "Mover lotes" : "Mover", icone: ArrowRightLeft, onClick: onMover, desabilitado });
  if (podePesar) itens.push({ chave: "pesar", rotulo: "Pesar", icone: Scale, onClick: onPesar, desabilitado });
  itens.push({ chave: "manejos", rotulo: "Manejos", icone: LayoutGrid, onClick: onManejos, desabilitado });
  return <RodapePilulas itens={itens} className={className} />;
}
