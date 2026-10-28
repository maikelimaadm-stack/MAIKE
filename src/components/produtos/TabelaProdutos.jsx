import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";

export const PRODUTOS_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "nome", label: "Nome do Produto", default: true, sortable: true, width: 260 },
  { id: "tipo_uso", label: "Tipo de Uso", default: true, sortable: true, width: 130 },
  { id: "codigo", label: "Código Interno", default: true, sortable: true, width: 120 },
  { id: "categoria", label: "Categoria", default: true, sortable: true, width: 140 },
  { id: "marca", label: "Marca", default: true, sortable: true, width: 140 },
  { id: "unidade", label: "Unidade", default: true, sortable: true, width: 80 },
  { id: "preco_custo", label: "Preço Custo", default: true, sortable: true, align: "right", width: 110 },
  { id: "preco_venda", label: "Preço Venda", default: true, sortable: true, align: "right", width: 110 },
  { id: "estoque", label: "Estoque Atual", default: true, sortable: true, align: "right", width: 110 },
  { id: "estoque_min", label: "Estoque Mínimo", default: false, sortable: true, align: "right", width: 110 },
  { id: "barras", label: "Cód. Barras", default: false, sortable: true, width: 140 },
  { id: "local", label: "Local Estoque", default: false, sortable: true, width: 140 },
  { id: "tipo_consumo", label: "Tipo Consumo", default: false, sortable: true, width: 120 },
  {
    id: "ativo",
    label: "Ativo",
    default: true,
    sortable: true,
    align: "center",
    width: 80,
    cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE,
  },
];

const formatarNumero = (numero) => {
  if (numero === null || numero === undefined || numero === "") return "0,00";
  return Number(numero).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

export function getProdutoFieldValue(item, colunaId) {
  if (colunaId === "numero") return item.numero_produto || "";
  if (colunaId === "nome") return item.nome_produto || "";
  if (colunaId === "tipo_uso") return item.tipo_uso || "";
  if (colunaId === "codigo") return item.codigo_interno || "";
  if (colunaId === "categoria") return item.categoria || "";
  if (colunaId === "marca") return item.marca || "";
  if (colunaId === "unidade") return item.unidade_medida || "";
  if (colunaId === "preco_custo") return String(item.preco_custo || 0);
  if (colunaId === "preco_venda") return String(item.preco_venda || 0);
  if (colunaId === "estoque") return String(item.estoque_atual || 0);
  if (colunaId === "estoque_min") return String(item.estoque_minimo || 0);
  if (colunaId === "barras") return item.codigo_barras || "";
  if (colunaId === "local") return item.local_estoque || "";
  if (colunaId === "tipo_consumo") return item.tipo_consumo || "";
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

function renderCell(produto, colunaId) {
  const estoqueAbaixoMinimo = Number(produto.estoque_atual || 0) <= Number(produto.estoque_minimo || 0);
  if (colunaId === "numero") return <span className="font-mono">{produto.numero_produto || "–"}</span>;
  if (colunaId === "nome")
    return (
      <span className={`uppercase ${produto.ativo === false ? "text-slate-400 line-through" : ""}`}>
        {produto.nome_produto || "–"}
      </span>
    );
  if (colunaId === "tipo_uso") return produto.tipo_uso || "–";
  if (colunaId === "codigo") return produto.codigo_interno || "–";
  if (colunaId === "categoria") return produto.categoria || "–";
  if (colunaId === "marca") return produto.marca || "–";
  if (colunaId === "unidade") return produto.unidade_medida || "–";
  if (colunaId === "preco_custo") return `R$ ${formatarNumero(produto.preco_custo || 0)}`;
  if (colunaId === "preco_venda") return `R$ ${formatarNumero(produto.preco_venda || 0)}`;
  if (colunaId === "estoque")
    return (
      <span className={estoqueAbaixoMinimo ? "text-red-600 font-semibold" : "font-semibold"}>
        {formatarNumero(produto.estoque_atual || 0)}
      </span>
    );
  if (colunaId === "estoque_min") return formatarNumero(produto.estoque_minimo || 0);
  if (colunaId === "barras") return produto.codigo_barras || "–";
  if (colunaId === "local") return produto.local_estoque || "–";
  if (colunaId === "tipo_consumo") return produto.tipo_consumo || "–";
  return "–";
}

export default function TabelaProdutos(props) {
  return (
    <CadastroBase1Grade
      rows={props.produtos}
      columns={PRODUTOS_COLUNAS}
      storageKey="colunas_produtos_v2"
      droppableId="colunas-produtos"
      getFieldValue={getProdutoFieldValue}
      renderCell={renderCell}
      defaultSortKey="nome"
      emptyText="Nenhum produto encontrado"
      isLoading={props.isLoading}
      onOpen={props.onEdit}
      showConfigColunas={props.showConfigColunas}
      setShowConfigColunas={props.setShowConfigColunas}
      searchQuery={props.searchQuery}
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
