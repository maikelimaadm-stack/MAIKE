import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { ROTULO_DIMENSAO, ROTULO_FINALIDADE, SIMBOLO_UNIDADE } from "@/lib/patrimonioDominio";

/** Colunas da lista de Perfis de Medição (D-PROD-156). */
export const PERFIS_COLUNAS = [
  { id: "codigo", label: "Código", default: true, sortable: true, width: 160 },
  { id: "nome", label: "Perfil", default: true, sortable: true, width: 220 },
  { id: "dimensao", label: "Dimensão", default: true, sortable: true, width: 130 },
  { id: "finalidade", label: "Finalidade", default: true, sortable: true, width: 200 },
  { id: "unidades", label: "Unidades permitidas", default: true, sortable: false, width: 180 },
  { id: "unidade_canonica", label: "Unidade padrão", default: false, sortable: true, width: 120 },
  { id: "descricao", label: "Descrição", default: false, sortable: true, width: 260 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/** Cards: no celular, Dimensão, Unidades e Ativo. */
export const PERFIS_CAMPOS_CARD = ["codigo", "nome", "dimensao", "unidades", "ativo", "finalidade"];

/** @param {unknown} u */
const simbolo = (u) => /** @type {Record<string, string>} */ (SIMBOLO_UNIDADE)[String(u)] ?? String(u);

/** @param {any} item @param {string} id */
export function getPerfilFieldValue(item, id) {
  if (id === "codigo") return item.codigo || "";
  if (id === "nome") return item.nome || "";
  if (id === "dimensao") return /** @type {Record<string, string>} */ (ROTULO_DIMENSAO)[item.dimensao] || "";
  if (id === "finalidade") return /** @type {Record<string, string>} */ (ROTULO_FINALIDADE)[item.finalidade] || "";
  if (id === "unidades") return (Array.isArray(item.unidades_permitidas) ? item.unidades_permitidas : []).map(simbolo).join(", ");
  if (id === "unidade_canonica") return item.unidade_canonica ? simbolo(item.unidade_canonica) : "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

/** @type {import('./GradePatrimonio').DefinicaoGradePatrimonio} */
export const GRADE_PERFIS = Object.freeze({
  colunas: PERFIS_COLUNAS,
  storageKey: "colunas_patrimonio_perfis_medicao_v1",
  droppableId: "colunas-patrimonio-perfis-medicao",
  getFieldValue: getPerfilFieldValue,
  testIdPrefix: "perfil",
});
