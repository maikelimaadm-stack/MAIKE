import React, { useEffect, useState } from "react";
import { CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Settings, Building2, MoreVertical, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";

export const EMPRESAS_COLUNAS = [
  { id: "logotipo", label: "Logo", default: true, sortable: false, width: 72 },
  { id: "apelido", label: "Apelido", default: true, sortable: true, width: 140 },
  { id: "nome", label: "Nome/Razão Social", default: true, sortable: true, width: 220 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 100 },
  { id: "documento", label: "CPF/CNPJ", default: true, sortable: false, width: 140 },
  { id: "telefone", label: "Telefone", default: false, sortable: false, width: 130 },
  { id: "cidade", label: "Cidade", default: true, sortable: true, width: 160 },
];

/**
 * @param {object} empresa
 * @param {string} colId
 */
export function getEmpresaFieldValue(empresa, colId) {
  if (colId === "logotipo") return empresa.logotipo_url ? "Com logo" : "";
  if (colId === "apelido") return empresa.apelido || "";
  if (colId === "nome") return empresa.nome || "";
  if (colId === "tipo") return empresa.tipo_pessoa || "";
  if (colId === "documento") {
    return empresa.tipo_pessoa === "Física" ? empresa.cpf || "" : empresa.cnpj || "";
  }
  if (colId === "telefone") return empresa.telefone || "";
  if (colId === "cidade") {
    return empresa.cidade ? `${empresa.cidade} - ${empresa.estado || ""}`.trim() : "";
  }
  return "";
}

/**
 * @param {object} empresa
 * @param {string} colId
 */
function renderCell(empresa, colId) {
  if (colId === "logotipo") {
    return empresa.logotipo_url ? (
      <img src={empresa.logotipo_url} alt={empresa.apelido || ""} className="h-10 w-10 object-contain border rounded" />
    ) : (
      <div className="h-10 w-10 bg-slate-100 rounded flex items-center justify-center">
        <Building2 className="w-5 h-5 text-slate-400" />
      </div>
    );
  }
  if (colId === "apelido") return <span className="font-semibold">{empresa.apelido || "–"}</span>;
  if (colId === "nome") return empresa.nome || "–";
  if (colId === "tipo") {
    return (
      <Badge
        variant="outline"
        className={`text-xs ${empresa.tipo_pessoa === "Física" ? "bg-blue-50 text-blue-700 border-blue-300" : "bg-purple-50 text-purple-700 border-purple-300"}`}
      >
        {empresa.tipo_pessoa || "–"}
      </Badge>
    );
  }
  if (colId === "documento") {
    return (
      <span className="font-mono">
        {empresa.tipo_pessoa === "Física" ? empresa.cpf || "–" : empresa.cnpj || "–"}
      </span>
    );
  }
  if (colId === "telefone") return empresa.telefone || "–";
  if (colId === "cidade") {
    return empresa.cidade ? `${empresa.cidade} - ${empresa.estado || ""}` : "–";
  }
  return "–";
}

export default function TabelaEmpresas({
  empresas = [],
  onEdit,
  onDelete,
  isLoading,
  chromeLayout = false,
  showConfigColunas: showConfigColunasProp,
  setShowConfigColunas: setShowConfigColunasProp,
  searchQuery = "",
  resetFiltersKey = 0,
  onSelectionChange,
  onFiltersActiveChange,
  viewMode,
  displayLimit,
  onListMetrics,
  cardFields,
  cardsPerRow,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showConfigColunasInternal, setShowConfigColunasInternal] = useState(false);
  const showConfigColunas = showConfigColunasProp ?? showConfigColunasInternal;
  const setShowConfigColunas = setShowConfigColunasProp ?? setShowConfigColunasInternal;

  const [selectedItems, setSelectedItems] = useState([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  const effectiveSearch = chromeLayout ? searchQuery : searchTerm;

  useEffect(() => {
    if (!chromeLayout) return;
    setSelectedItems([]);
    setSearchTerm("");
  }, [resetFiltersKey, chromeLayout]);

  const handleSelection = (ids) => {
    setSelectedItems(ids);
    onSelectionChange?.(ids);
  };

  const handleBulkDelete = () => {
    setBulkDeleteConfirm(true);
  };

  const executeBulkDelete = async () => {
    setBulkDeleteConfirm(false);
    setIsDeletingBulk(true);
    setDeleteProgress({ current: 0, total: selectedItems.length });

    let deleted = 0;
    for (const id of selectedItems) {
      try {
        await onDelete(id, true);
        deleted += 1;
        setDeleteProgress({ current: deleted, total: selectedItems.length });
      } catch (error) {
        console.error("Erro ao excluir:", error);
      }
    }

    setTimeout(() => {
      setIsDeletingBulk(false);
      setSelectedItems([]);
      onSelectionChange?.([]);
    }, 500);
  };

  const deleteProgressPercentage =
    deleteProgress.total > 0 ? Math.round((deleteProgress.current / deleteProgress.total) * 100) : 0;

  const grade = (
    <CadastroBase1Grade
      rows={empresas}
      columns={EMPRESAS_COLUNAS}
      storageKey="colunas_empresas_v1"
      droppableId="colunas-empresas"
      getFieldValue={getEmpresaFieldValue}
      renderCell={renderCell}
      defaultSortKey="apelido"
      emptyText="Nenhuma empresa"
      isLoading={isLoading}
      onOpen={onEdit}
      showConfigColunas={showConfigColunas}
      setShowConfigColunas={setShowConfigColunas}
      searchQuery={effectiveSearch}
      resetFiltersKey={resetFiltersKey}
      onSelectionChange={handleSelection}
      onFiltersActiveChange={onFiltersActiveChange}
      viewMode={viewMode}
      displayLimit={displayLimit}
      onListMetrics={onListMetrics}
      cardFields={cardFields}
      cardsPerRow={cardsPerRow}
      cardsTitleColId="nome"
      cardsCodeColId="numero"
      matchesSearch={(empresa, q) => {
        const searchLower = q.toLowerCase();
        return (
          empresa.nome?.toLowerCase().includes(searchLower) ||
          empresa.apelido?.toLowerCase().includes(searchLower) ||
          empresa.cidade?.toLowerCase().includes(searchLower) ||
          empresa.cpf?.includes(searchLower) ||
          empresa.cnpj?.includes(searchLower) ||
          empresa.email?.toLowerCase().includes(searchLower)
        );
      }}
    />
  );

  return (
    <>
      {chromeLayout ? (
        grade
      ) : (
        <div className="shadow-sm border border-slate-300 rounded-lg bg-white">
          <div className="bg-white border-b border-slate-200 py-2 px-4">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-sm font-semibold text-slate-900">Empresas ({empresas.length})</CardTitle>
              <div className="flex gap-2 items-center">
                {selectedItems.length > 0 && (
                  <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 rounded px-2 py-1">
                    <span className="text-xs font-semibold text-slate-800">{selectedItems.length} selecionado(s)</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5">
                          <MoreVertical className="w-4 h-4 text-slate-700" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleBulkDelete} className="text-xs text-red-600">
                          Excluir Todos
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleSelection([])} className="text-xs">
                          Limpar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    placeholder="Buscar..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-8 w-48 text-xs"
                  />
                </div>
                <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setShowConfigColunas(true)}>
                  <Settings className="w-3.5 h-3.5" />
                  Colunas
                </Button>
              </div>
            </div>
          </div>
          <div className="p-0">{grade}</div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
        title="Confirmar exclusão"
        description="Tem certeza que deseja excluir esta empresa? Esta ação não pode ser desfeita."
        onConfirm={() => {
          onDelete(deleteConfirmId, true);
          setDeleteConfirmId(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={() => setBulkDeleteConfirm(false)}
        title="Confirmar exclusão"
        description={`Tem certeza que deseja excluir ${selectedItems.length} empresa(s)? Esta ação não pode ser desfeita.`}
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
              Excluindo Registros
            </DialogTitle>
            <DialogDescription>Aguarde enquanto excluímos os registros selecionados...</DialogDescription>
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
