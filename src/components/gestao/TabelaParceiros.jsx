import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { rotuloPapel } from "@/services/parceiroService";

export const PARCEIROS_STORAGE_KEY = "colunas_parceiros_v1";

export const PARCEIROS_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 260 },
  { id: "tipo_pessoa", label: "Tipo", default: true, sortable: true, width: 90 },
  { id: "documento", label: "CPF/CNPJ", default: true, sortable: true, width: 150 },
  { id: "papeis", label: "Papéis", default: true, sortable: false, width: 220 },
  { id: "cidade", label: "Cidade/UF", default: true, sortable: true, width: 160 },
  { id: "telefone", label: "Telefone", default: false, sortable: true, width: 130 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/** @param {any} item */
const documentoDe = (item) => (item?.tipo_pessoa === "Física" ? item?.cpf : item?.cnpj) || item?.cnpj || item?.cpf || "";
/** @param {any} item */
const papeisTexto = (item) => (Array.isArray(item?.papeis) ? item.papeis.map(rotuloPapel).join(", ") : "");

export function getParceiroFieldValue(item, id) {
  if (id === "numero") return item.numero_cadastro || "";
  if (id === "nome") return item.nome || "";
  if (id === "tipo_pessoa") return item.tipo_pessoa || "";
  if (id === "documento") return documentoDe(item);
  if (id === "papeis") return papeisTexto(item);
  if (id === "cidade") return [item.cidade, item.estado].filter(Boolean).join("/");
  if (id === "telefone") return item.telefone || "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

function renderCell(item, colId) {
  if (colId === "numero") return <span className="font-mono">{item.numero_cadastro || "–"}</span>;
  if (colId === "nome") return <span className="uppercase">{item.nome || "–"}</span>;
  if (colId === "papeis") return papeisTexto(item) || "–";
  const v = getParceiroFieldValue(item, colId);
  return v || "–";
}

export default function TabelaParceiros(props) {
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={PARCEIROS_COLUNAS}
      storageKey={PARCEIROS_STORAGE_KEY}
      droppableId="colunas-parceiros"
      getFieldValue={getParceiroFieldValue}
      renderCell={renderCell}
      defaultSortKey="nome"
      emptyText={props.emptyText || "Nenhum parceiro encontrado"}
      isLoading={props.isLoading}
      onOpen={props.onEdit}
      showConfigColunas={props.showConfigColunas}
      setShowConfigColunas={props.setShowConfigColunas}
      searchQuery=""
      matchesSearch={props.matchesSearch}
      resetFiltersKey={props.resetFiltersKey}
      onSelectionChange={props.onSelectionChange}
      onFiltersActiveChange={props.onFiltersActiveChange}
      viewMode={props.viewMode}
      cardFields={props.cardFields}
      cardsPerRow={props.cardsPerRow}
      cardsTitleColId="nome"
      cardsCodeColId="numero"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}
