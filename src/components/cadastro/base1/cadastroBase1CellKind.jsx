import React from "react";
import CadastroAtivoBadge from "@/components/cadastro/base1/CadastroAtivoBadge";
import { readCadastroAtivoValue } from "@/lib/cadastroAtivoStatus";

/** @typedef {'ativo-badge'} CadastroBase1CellKind */

export const CADASTRO_BASE1_CELL_KIND = Object.freeze({
  ATIVO_BADGE: "ativo-badge",
});

/**
 * @param {object} item
 * @param {{ id: string; cellKind?: CadastroBase1CellKind; statusField?: string } | undefined} col
 * @returns {import('react').ReactNode | null}
 */
export function renderCadastroBase1CellKind(item, col) {
  if (!col?.cellKind) return null;
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE) {
    const fieldId = col.statusField ?? col.id;
    const raw = readCadastroAtivoValue(item, fieldId);
    return <CadastroAtivoBadge value={raw} />;
  }
  return null;
}

/**
 * Motor primeiro (cellKind), depois adapter (`renderCell` por entidade).
 *
 * @param {Array<{ id: string; cellKind?: CadastroBase1CellKind; statusField?: string }>} columns
 * @param {(item: object, colId: string) => import('react').ReactNode} [customRenderCell]
 */
export function composeCadastroBase1RenderCell(columns, customRenderCell) {
  const byId = new Map((columns || []).map((c) => [c.id, c]));
  return (item, colId) => {
    const col = byId.get(colId);
    const kindNode = col ? renderCadastroBase1CellKind(item, col) : null;
    if (kindNode != null) return kindNode;
    if (customRenderCell) return customRenderCell(item, colId);
    return undefined;
  };
}
