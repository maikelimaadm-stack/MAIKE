import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { ROTULO_NATUREZA } from "@/lib/patrimonioDominio";

/** Colunas da lista de Famílias Patrimoniais (D-PROD-156). */
export const FAMILIAS_COLUNAS = [
  { id: "codigo", label: "Código", default: true, sortable: true, width: 140 },
  { id: "nome", label: "Família", default: true, sortable: true, width: 260 },
  { id: "natureza", label: "Natureza", default: true, sortable: true, width: 130 },
  { id: "vida_util", label: "Vida útil padrão", default: true, sortable: true, width: 140, align: "right" },
  { id: "ordem", label: "Ordem", default: false, sortable: true, width: 80, align: "right" },
  { id: "descricao", label: "Descrição", default: false, sortable: true, width: 260 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/** Cards: nome no título e código no topo; no celular, Natureza, Vida útil e Ativo. */
export const FAMILIAS_CAMPOS_CARD = ["codigo", "nome", "natureza", "vida_util", "ativo", "descricao"];

/** @param {unknown} meses */
export const textoMeses = (meses) => (Number.isInteger(meses) ? `${meses} ${meses === 1 ? "mês" : "meses"}` : "");

/** @param {any} item @param {string} id */
export function getFamiliaFieldValue(item, id) {
  if (id === "codigo") return item.codigo || "";
  if (id === "nome") return item.nome || "";
  if (id === "natureza") return /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[item.natureza] || "";
  if (id === "vida_util") return textoMeses(item.vida_util_meses_padrao);
  if (id === "ordem") return Number.isInteger(item.ordem) ? String(item.ordem) : "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

/** @type {import('./GradePatrimonio').DefinicaoGradePatrimonio} */
export const GRADE_FAMILIAS = Object.freeze({
  colunas: FAMILIAS_COLUNAS,
  storageKey: "colunas_patrimonio_familias_v1",
  droppableId: "colunas-patrimonio-familias",
  getFieldValue: getFamiliaFieldValue,
  testIdPrefix: "familia",
});
