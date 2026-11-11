import React from "react";
import { cadastroAtivoLabel, isCadastroAtivo, readCadastroAtivoValue } from "@/lib/cadastroAtivoStatus";

/** @typedef {'ativo-badge' | 'cor' | 'situacao'} CadastroBase1CellKind */

export const CADASTRO_BASE1_CELL_KIND = Object.freeze({
  ATIVO_BADGE: "ativo-badge",
  COR: "cor",
  /** Situação em texto ("Ativo"/"Inativo"), com o mesmo ponto colorido do `ativo-badge`. */
  SITUACAO: "situacao",
});

/** Ponto da situação na lista (D-PROD-163): verde quando ativo, cinza quando inativo. */
const COR_SITUACAO = Object.freeze({ ativo: "#22c55e", inativo: "#A3A29C" });

/**
 * @param {{ ativo: boolean, rotulo: string }} props
 */
function PontoDaSituacao({ ativo, rotulo }) {
  return (
    <span data-testid="cadastro-ativo-badge" data-ativo={ativo ? "true" : "false"} aria-label={rotulo}>
      <span
        className="b1-cor-dot"
        style={{ backgroundColor: ativo ? COR_SITUACAO.ativo : COR_SITUACAO.inativo }}
        aria-hidden="true"
      />
      {rotulo}
    </span>
  );
}

/** @param {unknown} valor */
const textoDaSituacao = (valor) => {
  const t = String(valor ?? "").trim();
  return t || "Ativo";
};
/** @param {unknown} valor */
const situacaoAtiva = (valor) => textoDaSituacao(valor).toLowerCase() !== "inativo";

/**
 * Texto da célula para título, largura automática e filtros — o que a pessoa lê, não o valor gravado
 * (cor: o nome, não o código; situação: "Ativo"/"Inativo").
 *
 * @param {object} item
 * @param {{ id: string; cellKind?: CadastroBase1CellKind; statusField?: string; corNomes?: Readonly<Record<string, string>> } | undefined} col
 * @returns {string | null} `null` quando a coluna não tem tipo próprio
 */
export function textoDoTipoDeCelulaBase1(item, col) {
  if (!col?.cellKind) return null;
  const bruto = /** @type {Record<string, unknown>} */ (item)?.[col.statusField ?? col.id];
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE) return cadastroAtivoLabel(readCadastroAtivoValue(item, col.statusField ?? col.id));
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.SITUACAO) return textoDaSituacao(bruto);
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.COR) {
    const hex = String(bruto ?? "").trim();
    if (!hex) return "";
    return col.corNomes?.[hex.toLowerCase()] ?? hex;
  }
  return null;
}

/**
 * @param {object} item
 * @param {{ id: string; cellKind?: CadastroBase1CellKind; statusField?: string; corNomes?: Readonly<Record<string, string>> } | undefined} col
 * @returns {import('react').ReactNode | null}
 */
export function renderCadastroBase1CellKind(item, col) {
  if (!col?.cellKind) return null;
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE) {
    const raw = readCadastroAtivoValue(item, col.statusField ?? col.id);
    return <PontoDaSituacao ativo={isCadastroAtivo(raw)} rotulo={cadastroAtivoLabel(raw)} />;
  }
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.SITUACAO) {
    const bruto = /** @type {Record<string, unknown>} */ (item)?.[col.statusField ?? col.id];
    return <PontoDaSituacao ativo={situacaoAtiva(bruto)} rotulo={textoDaSituacao(bruto)} />;
  }
  if (col.cellKind === CADASTRO_BASE1_CELL_KIND.COR) {
    // Amostra + nome da cor (D-PROD-163). A tela informa `corNomes` (hex → nome).
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
