import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { textoMeses } from "@/components/patrimonio/TabelaFamilias";

/** Colunas da lista de Tipos Patrimoniais (D-PROD-157; D-PROD-161: sem "Perfis sugeridos"). */
export const TIPOS_COLUNAS = [
  { id: "codigo", label: "Código", default: true, sortable: true, width: 140 },
  { id: "nome", label: "Tipo", default: true, sortable: true, width: 240 },
  { id: "familia", label: "Família", default: true, sortable: true, width: 220 },
  { id: "natureza", label: "Natureza", default: false, sortable: true, width: 130 },
  { id: "vida_util", label: "Vida útil sugerida", default: false, sortable: true, width: 140, align: "right" },
  { id: "descricao", label: "Descrição", default: false, sortable: true, width: 260 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/** Cards: no celular, Família e Ativo. */
export const TIPOS_CAMPOS_CARD = ["codigo", "nome", "familia", "ativo", "descricao"];

/** Nome da família do tipo (objeto `familia` ou campo plano). @param {any} item */
export const nomeDaFamiliaDoTipo = (item) => String(item?.familia?.nome ?? item?.familia_nome ?? "");

/** Natureza da família do tipo, quando o servidor a manda. @param {any} item @returns {string|null} */
export const naturezaDaFamiliaDoTipo = (item) => {
  const n = item?.familia?.natureza ?? item?.familia_natureza ?? item?.natureza;
  return typeof n === "string" ? n : null;
};

/** @param {any} item @param {string} id */
export function getTipoFieldValue(item, id) {
  if (id === "codigo") return item.codigo || "";
  if (id === "nome") return item.nome || "";
  if (id === "familia") return nomeDaFamiliaDoTipo(item);
  if (id === "natureza") return /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[naturezaDaFamiliaDoTipo(item) ?? ""] || "";
  if (id === "vida_util") return textoMeses(item.vida_util_meses_sugerida);
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

/** @type {import('./GradePatrimonio').DefinicaoGradePatrimonio} */
export const GRADE_TIPOS = Object.freeze({
  colunas: TIPOS_COLUNAS,
  storageKey: "colunas_patrimonio_tipos_v1",
  droppableId: "colunas-patrimonio-tipos",
  getFieldValue: getTipoFieldValue,
  testIdPrefix: "tipo",
});
