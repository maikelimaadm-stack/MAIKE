import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { ROTULO_UNIDADE_COMBUSTIVEL } from "@/lib/patrimonioDominio";

/** Colunas da lista de Combustíveis (D-PROD-156) — catálogo classificatório: sem preço, custo ou saldo. */
export const COMBUSTIVEIS_COLUNAS = [
  { id: "codigo", label: "Código", default: true, sortable: true, width: 160 },
  { id: "nome", label: "Combustível", default: true, sortable: true, width: 240 },
  { id: "unidade", label: "Unidade", default: true, sortable: true, width: 180 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 280 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/** Cards: no celular, Unidade, Ativo e Descrição. */
export const COMBUSTIVEIS_CAMPOS_CARD = ["codigo", "nome", "unidade", "ativo", "descricao"];

/** @param {any} item @param {string} id */
export function getCombustivelFieldValue(item, id) {
  if (id === "codigo") return item.codigo || "";
  if (id === "nome") return item.nome || "";
  if (id === "unidade") return /** @type {Record<string, string>} */ (ROTULO_UNIDADE_COMBUSTIVEL)[item.unidade] || item.unidade || "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

/** @type {import('./GradePatrimonio').DefinicaoGradePatrimonio} */
export const GRADE_COMBUSTIVEIS = Object.freeze({
  colunas: COMBUSTIVEIS_COLUNAS,
  storageKey: "colunas_patrimonio_combustiveis_v1",
  droppableId: "colunas-patrimonio-combustiveis",
  getFieldValue: getCombustivelFieldValue,
  testIdPrefix: "combustivel",
});
