import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfiguracaoColunasGruposAtividadesDialog from "@/components/grupos-atividades/ConfiguracaoColunasGruposAtividadesDialog";
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true },
  { id: "acoes", label: "Ações", default: true, fixo: true },
  { id: "nome_grupo", label: "Nome", default: true, sortable: true, align: "left" },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "left" },
  { id: "descricao", label: "Descrição", default: true, sortable: true, align: "left" },
  { id: "observacoes", label: "Observações", default: false, sortable: false, align: "left" },
  { id: "created_date", label: "Criado em", default: true, sortable: true, align: "left" },
  { id: "updated_date", label: "Atualizado em", default: true, sortable: true, align: "left" },
];

const VALOR_TODOS = "__TODOS__";

const formatarDataHora = (data) => {
  if (!data) return "-";
  return new Date(data).toLocaleString("pt-BR");
};

export default function TabelaGruposAtividades({ grupos, onEdit, onDelete, showConfigColunas, setShowConfigColunas }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState(VALOR_TODOS);
  const [sortConfig, setSortConfig] = useState({ key: "nome_grupo", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_grupos_atividades");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_grupos_atividades");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
  });

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => grupos.some((item) => item.id === id)));
  }, [grupos]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroAtivo, itemsPerPage]);

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novasColunas);
    localStorage.setItem("colunas_visiveis_grupos_atividades", JSON.stringify(novasColunas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_grupos_atividades", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((coluna) => coluna.id === id))
      .filter((coluna) => coluna && colunasVisiveis.includes(coluna.id));
  }, [colunasOrdem, colunasVisiveis]);

  const gruposFiltrados = useMemo(() => {
    return grupos.filter((grupo) => {
      const termo = searchTerm.toLowerCase();
      const matchSearch =
        !termo ||
        String(grupo.nome_grupo || "").toLowerCase().includes(termo) ||
        String(grupo.descricao || "").toLowerCase().includes(termo) ||
        String(grupo.observacoes || "").toLowerCase().includes(termo);
      const matchAtivo =
        filtroAtivo === VALOR_TODOS ||
        (filtroAtivo === "true" ? grupo.ativo === true : grupo.ativo === false);
      return matchSearch && matchAtivo;
    });
  }, [grupos, searchTerm, filtroAtivo]);

  const gruposOrdenados = useMemo(() => {
    const sorted = [...gruposFiltrados];
    sorted.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortConfig.key === "ativo") {
        aVal = a.ativo ? 1 : 0;
        bVal = b.ativo ? 1 : 0;
      } else if (["created_date", "updated_date"].includes(sortConfig.key)) {
        aVal = String(a[sortConfig.key] || "");
        bVal = String(b[sortConfig.key] || "");
      } else {
        aVal = String(a[sortConfig.key] || "").toLowerCase();
        bVal = String(b[sortConfig.key] || "").toLowerCase();
      }

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [gruposFiltrados, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(gruposOrdenados.length / itemsPerPage));
  const gruposPaginados = gruposOrdenados.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    }
    return sortConfig.direction === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === gruposFiltrados.length && gruposFiltrados.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(gruposFiltrados.map((item) => item.id));
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroAtivo(VALOR_TODOS);
  };

  const renderCell = (grupo, colunaId) => {
    if (colunaId === "nome_grupo") return grupo.nome_grupo || "-";
    if (colunaId === "ativo") return grupo.ativo ? "Sim" : "Não";
    if (colunaId === "descricao") return grupo.descricao || "-";
    if (colunaId === "observacoes") return grupo.observacoes || "-";
    if (colunaId === "created_date") return formatarDataHora(grupo.created_date);
    if (colunaId === "updated_date") return formatarDataHora(grupo.updated_date);
    return "-";
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-1">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Buscar</Label>
              <Input
                placeholder="Buscar grupo, descrição, observações..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Ativo</Label>
              <Select value={filtroAtivo} onValueChange={setFiltroAtivo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                  <SelectItem value="true" className="text-xs">Sim</SelectItem>
                  <SelectItem value="false" className="text-xs">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-between items-center mt-2 gap-2 flex-wrap">
            <div className="text-xs text-slate-500">
              {gruposFiltrados.length} de {grupos.length} registros
            </div>
            <div className="flex gap-2 flex-wrap">
              {selectedItems.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      Ações ({selectedItems.length})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDelete(selectedItems)} className="text-xs text-red-600">
                      Excluir Selecionados
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">
                      Limpar Seleção
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" size="sm" onClick={limparFiltros} className="h-7 text-xs">
                Limpar Filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow className="bg-white border-b">
                  {colunasOrdenadas.map((coluna) => {
                    if (coluna.id === "selecao") {
                      return (
                        <TableHead key="selecao" className="text-xs py-2 px-2">
                          <Checkbox
                            checked={selectedItems.length === gruposFiltrados.length && gruposFiltrados.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                      );
                    }
                    if (coluna.id === "acoes") {
                      return <TableHead key="acoes" className="text-xs py-2 px-2"></TableHead>;
                    }
                    const isRight = coluna.align === "right";
                    return (
                      <TableHead
                        key={coluna.id}
                        className={`text-xs py-2 px-3 ${coluna.sortable ? "cursor-pointer hover:bg-gray-50" : ""} ${isRight ? "text-right" : ""}`}
                        onClick={() => coluna.sortable && handleSort(coluna.id)}
                      >
                        <div className={`flex items-center gap-1 ${isRight ? "justify-end" : ""}`}>
                          {coluna.label} {coluna.sortable && <SortIcon column={coluna.id} />}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {gruposPaginados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                      Nenhum grupo encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  gruposPaginados.map((grupo) => (
                    <TableRow key={grupo.id} className="hover:bg-gray-50 border-b">
                      {colunasOrdenadas.map((coluna) => {
                        if (coluna.id === "selecao") {
                          return (
                            <TableCell key={`${grupo.id}-selecao`} className="text-xs py-2 px-2">
                              <Checkbox
                                checked={selectedItems.includes(grupo.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedItems((prev) => checked ? [...prev, grupo.id] : prev.filter((id) => id !== grupo.id));
                                }}
                              />
                            </TableCell>
                          );
                        }

                        if (coluna.id === "acoes") {
                          return (
                            <TableCell key={`${grupo.id}-acoes`} className="text-xs py-2 px-2 text-center">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem onClick={() => onEdit(grupo)} className="text-xs">
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => onDelete(grupo.id)} className="text-xs text-red-600">
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell
                            key={`${grupo.id}-${coluna.id}`}
                            className={`text-xs py-2 px-3 ${coluna.align === "right" ? "text-right font-mono" : ""}`}
                          >
                            {renderCell(grupo, coluna.id)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between p-3 border-t">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Itens por página:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)} className="h-7 text-xs">
                Anterior
              </Button>
              <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="h-7 text-xs">
                Próxima
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfiguracaoColunasGruposAtividadesDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd}
      />
    </div>
  );
}