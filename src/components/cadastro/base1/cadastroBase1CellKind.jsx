import React from "react";
import CadastroAtivoBadge from "@/components/cadastro/base1/CadastroAtivoBadge";
import { readCadastroAtivoValue } from "@/lib/cadastroAtivoStatus";

/** @typedef {'ativo-badge' | 'cor'} CadastroBase1CellKind */

export const CADASTRO_BASE1_CELL_KIND = Object.freeze({
  ATIVO_BADGE: "ativo-badge",
  COR: "cor",
});

/**
 * @param {object} item
 * @param {{ id: string; cellKind?: CadastroBase1CellKind; statusField?: string; corNomes?: Record<string, string> } | undefined} col
 * @returns {import('react').ReactNode | null}
 */
export function renderCadastroBase1CellKind(item, col) {
  if (!col?.cellKind) return null;
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE) {
    const fieldId = col.statusField ?? col.id;
    const raw = readCadastroAtivoValue(item, fieldId);
    return <CadastroAtivoBadge value={raw} />;
  }
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.COR) {
    // Amostra + nome da cor (D-PROD-161). A tela informa `corNomes` (hex → nome).
    const hex = String(/** @type {Record<string, unknown>} */ (item)?.[col.statusField ?? col.id] ?? "").trim();
    if (!/^#[0-9a-fA-F]{3,8}$/.test(hex)) return null;
    const nome = col.corNomes?.[hex.toLowerCase()] ?? hex;
    return (
      <>
        <span className="b1-cor-dot" style={{ backgroundColor: hex }} aria-hidden="true" />
        {nome}
      </>
    );
  }
  return null;
}

/**
 * Coluna de título e coluna de código de uma lista — a mesma regra para a tabela e para os cards.
 *
 * @template {{ id: string }} C
 * @param {C[]} columns
 * @param {string} [titleColId]
 * @param {string} [codeColId]
 * @returns {{ titleCol: C | undefined, codeCol: C | undefined }}
 */
export function papeisDasColunasBase1(columns, titleColId, codeColId) {
  const byKey = new Map((columns || []).map((c) => [c.id, c]));
  const titleCol =
    (titleColId && byKey.get(titleColId)) ||
    byKey.get("nome") ||
    byKey.get("name") ||
    byKey.get("descricao") ||
    (columns || []).find((c) => c.id !== codeColId) ||
    (columns || [])[0];
  const codeCol = (codeColId && byKey.get(codeColId)) || byKey.get("numero") || byKey.get("code");
  return { titleCol, codeCol };
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
