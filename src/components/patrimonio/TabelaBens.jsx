import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { ROTULO_MEDIDOR, ROTULO_NATUREZA, ROTULO_PROPRIEDADE } from "@/lib/patrimonioDominio";

/** Colunas da lista de Bens Patrimoniais (D-PROD-156) — resumo da listagem do servidor. */
export const BENS_COLUNAS = [
  { id: "numero", label: "Nº patrimonial", default: true, sortable: true, width: 110 },
  { id: "codigo_frota", label: "Código de frota", default: true, sortable: true, width: 130 },
  { id: "nome", label: "Bem", default: true, sortable: true, width: 260 },
  { id: "natureza", label: "Natureza", default: true, sortable: true, width: 120 },
  { id: "familia", label: "Família", default: false, sortable: true, width: 200 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 200 },
  { id: "propriedade", label: "Propriedade", default: false, sortable: true, width: 120 },
  { id: "medidor", label: "Medidor", default: false, sortable: true, width: 140 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/** Cards: nome no título e número no topo; no celular, Código de frota, Tipo e Ativo. */
export const BENS_CAMPOS_CARD = ["numero", "nome", "codigo_frota", "tipo", "ativo", "natureza"];

/** @param {Record<string, string>} mapa @param {unknown} chave */
const rotulo = (mapa, chave) => (typeof chave === "string" ? mapa[chave] ?? "" : "");

/** @param {any} item @param {string} id */
export function getBemFieldValue(item, id) {
  if (id === "numero") return item.numero != null ? String(item.numero) : "";
  if (id === "codigo_frota") return item.codigo_frota || "";
  if (id === "nome") return item.nome || "";
  if (id === "natureza") return rotulo(ROTULO_NATUREZA, item.natureza);
  if (id === "familia") return String(item.familia?.nome ?? "");
  if (id === "tipo") return String(item.tipo?.nome ?? "");
  if (id === "propriedade") return rotulo(ROTULO_PROPRIEDADE, item.propriedade);
  if (id === "medidor") return rotulo(ROTULO_MEDIDOR, item.medidor_tipo ?? item.medidor?.tipo);
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

/** @type {import('./GradePatrimonio').DefinicaoGradePatrimonio} */
export const GRADE_BENS = Object.freeze({
  colunas: BENS_COLUNAS,
  storageKey: "colunas_bens_patrimoniais_v1",
  droppableId: "colunas-bens-patrimoniais",
  getFieldValue: getBemFieldValue,
  testIdPrefix: "bem",
  defaultSortKey: "numero",
});
