import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";

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
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
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
  if (colunaId === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
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
  if (colunaId === "ativo")
    return produto.ativo !== false ? (
      <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 border-0">
        Ativo
      </Badge>
    ) : (
      <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-500 border-0">
        Inativo
      </Badge>
    );
  return "–";
}

export default function TabelaProdutos({
  produtos = [],
  onEdit,
  onDelete,
  onPrint: _onPrint,
  isLoading,
  showConfigColunas,
  setShowConfigColunas,
  searchQuery = "",
  resetFiltersKey = 0,
  onSelectionChange,
  onFiltersActiveChange,
  bulkDeleteSignal = 0,
}) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (bulkDeleteSignal > 0 && selectedIds.length > 0) setBulkDeleteConfirm(true);
  }, [bulkDeleteSignal, selectedIds.length]);

  const handleSelection = (ids) => {
    setSelectedIds(ids);
    onSelectionChange?.(ids);
  };

  const executeBulkDelete = async () => {
    setBulkDeleteConfirm(false);
    setIsDeletingBulk(true);
    setDeleteProgress({ current: 0, total: selectedIds.length });
    let deleted = 0;
    for (const id of selectedIds) {
      try {
        await onDelete(id, true);
        deleted += 1;
      } catch {
        /* skip */
      }
      setDeleteProgress({ current: deleted, total: selectedIds.length });
    }
    setTimeout(() => {
      setIsDeletingBulk(false);
      setSelectedIds([]);
      onSelectionChange?.([]);
    }, 500);
  };

  const deleteProgressPercentage =
    deleteProgress.total > 0 ? Math.round((deleteProgress.current / deleteProgress.total) * 100) : 0;

  return (
    <>
      <CadastroBase1Grade
        rows={produtos}
        columns={PRODUTOS_COLUNAS}
        storageKey="colunas_produtos_v2"
        droppableId="colunas-produtos"
        getFieldValue={getProdutoFieldValue}
        renderCell={renderCell}
        defaultSortKey="nome"
        emptyText="Nenhum produto encontrado"
        isLoading={isLoading}
        onOpen={onEdit}
        showConfigColunas={showConfigColunas}
        setShowConfigColunas={setShowConfigColunas}
        searchQuery={searchQuery}
        resetFiltersKey={resetFiltersKey}
        onSelectionChange={handleSelection}
        onFiltersActiveChange={onFiltersActiveChange}
        matchesSearch={(p, q) => {
          const hay = [p.nome_produto, p.codigo_interno, p.categoria, p.marca, p.numero_produto]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        }}
      />
      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={() => setBulkDeleteConfirm(false)}
        title="Confirmar exclusão"
        description={`Tem certeza que deseja excluir ${selectedIds.length} item(ns)? Esta ação não pode ser desfeita.`}
        onConfirm={executeBulkDelete}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
      <Dialog open={isDeletingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-red-600" />
              Excluindo Produtos
            </DialogTitle>
            <DialogDescription>Aguarde enquanto excluímos os produtos selecionados…</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {deleteProgress.current} de {deleteProgress.total}
                </span>
              </div>
              <Progress value={deleteProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-red-600">{deleteProgressPercentage}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
