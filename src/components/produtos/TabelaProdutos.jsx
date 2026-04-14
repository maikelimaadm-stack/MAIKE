import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import ConfiguracaoColunasProdutosDialog from "@/components/produtos/ConfiguracaoColunasProdutosDialog";
import { MoreVertical, Loader2, Search, Settings, X, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";

const VALOR_TODOS = "__TODOS__";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true },
  { id: "acoes", label: "Ações", default: true, fixo: true },
  { id: "numero", label: "Nº", default: true, sortable: true, align: "left" },
  { id: "nome", label: "Nome do Produto", default: true, sortable: true, align: "left" },
  { id: "codigo", label: "Código Interno", default: true, sortable: true, align: "left" },
  { id: "categoria", label: "Categoria", default: true, sortable: true, align: "left" },
  { id: "unidade", label: "Unidade", default: true, sortable: true, align: "left" },
  { id: "preco_custo", label: "Preço Custo", default: true, sortable: true, align: "right" },
  { id: "preco_venda", label: "Preço Venda", default: true, sortable: true, align: "right" },
  { id: "estoque", label: "Estoque Atual", default: true, sortable: true, align: "right" },
  { id: "estoque_min", label: "Estoque Mínimo", default: false, sortable: true, align: "right" },
  { id: "barras", label: "Cód. Barras", default: false, sortable: true, align: "left" },
  { id: "local", label: "Local Estoque", default: false, sortable: true, align: "left" },
  { id: "tipo_consumo", label: "Tipo Consumo", default: false, sortable: true, align: "left" },
];

const formatarNumero = (numero) => {
  if (numero === null || numero === undefined || numero === "") return "0,00";
  return Number(numero).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

export default function TabelaProdutos({
  produtos = [],
  onEdit,
  onDelete,
  onPrint,
  isLoading,
  showConfigColunas,
  setShowConfigColunas,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState(VALOR_TODOS);
  const [filtroUnidade, setFiltroUnidade] = useState(VALOR_TODOS);
  const [filtroLocal, setFiltroLocal] = useState(VALOR_TODOS);
  const [filtroTipoConsumo, setFiltroTipoConsumo] = useState(VALOR_TODOS);
  const [filtroEstoque, setFiltroEstoque] = useState(VALOR_TODOS);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_produtos");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
  });
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_produtos");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => produtos.some((item) => item.id === id)));
  }, [produtos]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroCategoria, filtroUnidade, filtroLocal, filtroTipoConsumo, filtroEstoque, itemsPerPage]);

  const categorias = useMemo(() => [...new Set(produtos.map((item) => item.categoria).filter(Boolean))].sort(), [produtos]);
  const unidades = useMemo(() => [...new Set(produtos.map((item) => item.unidade_medida).filter(Boolean))].sort(), [produtos]);
  const locais = useMemo(() => [...new Set(produtos.map((item) => item.local_estoque).filter(Boolean))].sort(), [produtos]);
  const tiposConsumo = useMemo(() => [...new Set(produtos.map((item) => item.tipo_consumo).filter(Boolean))].sort(), [produtos]);

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];

    setColunasVisiveis(novasColunas);
    localStorage.setItem("colunas_produtos", JSON.stringify(novasColunas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_produtos", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id))
      .filter((c) => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  const produtosFiltrados = useMemo(() => {
    return produtos.filter((produto) => {
      const termo = searchTerm.toLowerCase();
      const estoqueAtual = Number(produto.estoque_atual || 0);
      const estoqueMinimo = Number(produto.estoque_minimo || 0);
      const matchSearch =
        !termo ||
        produto.nome_produto?.toLowerCase().includes(termo) ||
        produto.categoria?.toLowerCase().includes(termo) ||
        produto.codigo_interno?.toLowerCase().includes(termo) ||
        produto.codigo_barras?.toLowerCase().includes(termo) ||
        produto.numero_produto?.toLowerCase().includes(termo);
      const matchCategoria = filtroCategoria === VALOR_TODOS || produto.categoria === filtroCategoria;
      const matchUnidade = filtroUnidade === VALOR_TODOS || produto.unidade_medida === filtroUnidade;
      const matchLocal = filtroLocal === VALOR_TODOS || produto.local_estoque === filtroLocal;
      const matchTipoConsumo = filtroTipoConsumo === VALOR_TODOS || produto.tipo_consumo === filtroTipoConsumo;
      const matchEstoque =
        filtroEstoque === VALOR_TODOS ||
        (filtroEstoque === "baixo" && estoqueAtual <= estoqueMinimo) ||
        (filtroEstoque === "ok" && estoqueAtual > estoqueMinimo);

      return matchSearch && matchCategoria && matchUnidade && matchLocal && matchTipoConsumo && matchEstoque;
    });
  }, [produtos, searchTerm, filtroCategoria, filtroUnidade, filtroLocal, filtroTipoConsumo, filtroEstoque]);

  const produtosOrdenados = useMemo(() => {
    const sorted = [...produtosFiltrados];
    sorted.sort((a, b) => {
      let aValue;
      let bValue;

      switch (sortConfig.key) {
        case "numero":
          aValue = parseInt(a.numero_produto) || 0;
          bValue = parseInt(b.numero_produto) || 0;
          break;
        case "preco_custo":
          aValue = Number(a.preco_custo || 0);
          bValue = Number(b.preco_custo || 0);
          break;
        case "preco_venda":
          aValue = Number(a.preco_venda || 0);
          bValue = Number(b.preco_venda || 0);
          break;
        case "estoque":
          aValue = Number(a.estoque_atual || 0);
          bValue = Number(b.estoque_atual || 0);
          break;
        case "estoque_min":
          aValue = Number(a.estoque_minimo || 0);
          bValue = Number(b.estoque_minimo || 0);
          break;
        case "codigo":
          aValue = String(a.codigo_interno || "").toLowerCase();
          bValue = String(b.codigo_interno || "").toLowerCase();
          break;
        case "categoria":
          aValue = String(a.categoria || "").toLowerCase();
          bValue = String(b.categoria || "").toLowerCase();
          break;
        case "unidade":
          aValue = String(a.unidade_medida || "").toLowerCase();
          bValue = String(b.unidade_medida || "").toLowerCase();
          break;
        case "barras":
          aValue = String(a.codigo_barras || "").toLowerCase();
          bValue = String(b.codigo_barras || "").toLowerCase();
          break;
        case "local":
          aValue = String(a.local_estoque || "").toLowerCase();
          bValue = String(b.local_estoque || "").toLowerCase();
          break;
        case "tipo_consumo":
          aValue = String(a.tipo_consumo || "").toLowerCase();
          bValue = String(b.tipo_consumo || "").toLowerCase();
          break;
        case "nome":
        default:
          aValue = String(a.nome_produto || "").toLowerCase();
          bValue = String(b.nome_produto || "").toLowerCase();
          break;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [produtosFiltrados, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(produtosOrdenados.length / itemsPerPage));
  const paginatedProdutos = produtosOrdenados.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const getSortLabel = (key) => {
    if (sortConfig.key !== key) return "";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === produtosFiltrados.length && produtosFiltrados.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(produtosFiltrados.map((item) => item.id));
  };

  const toggleSelectItem = (id) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroCategoria(VALOR_TODOS);
    setFiltroUnidade(VALOR_TODOS);
    setFiltroLocal(VALOR_TODOS);
    setFiltroTipoConsumo(VALOR_TODOS);
    setFiltroEstoque(VALOR_TODOS);
  };

  const handleBulkDelete = async () => {
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
      } catch {
      }
    }

    setTimeout(() => {
      setIsDeletingBulk(false);
      setSelectedItems([]);
    }, 500);
  };

  const handleBulkPrint = () => {
    selectedItems.forEach((id) => {
      const produto = produtos.find((item) => item.id === id);
      if (produto) onPrint(produto);
    });
  };

  const deleteProgressPercentage = deleteProgress.total > 0
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100)
    : 0;

  const renderCell = (produto, colunaId) => {
    const estoqueAbaixoMinimo = Number(produto.estoque_atual || 0) <= Number(produto.estoque_minimo || 0);

    if (colunaId === "numero") return produto.numero_produto || "-";
    if (colunaId === "nome") return produto.nome_produto || "-";
    if (colunaId === "codigo") return produto.codigo_interno || "-";
    if (colunaId === "categoria") return produto.categoria || "-";
    if (colunaId === "unidade") return produto.unidade_medida || "-";
    if (colunaId === "preco_custo") return `R$ ${formatarNumero(produto.preco_custo || 0)}`;
    if (colunaId === "preco_venda") return `R$ ${formatarNumero(produto.preco_venda || 0)}`;
    if (colunaId === "estoque") {
      return (
        <span className={estoqueAbaixoMinimo ? "text-red-600 font-semibold" : "font-semibold"}>
          {formatarNumero(produto.estoque_atual || 0)}
        </span>
      );
    }
    if (colunaId === "estoque_min") return formatarNumero(produto.estoque_minimo || 0);
    if (colunaId === "barras") return produto.codigo_barras || "-";
    if (colunaId === "local") return produto.local_estoque || "-";
    if (colunaId === "tipo_consumo") return produto.tipo_consumo || "-";
    return "-";
  };

  return (
    <>
      <div className="space-y-1">
        <Card className="shadow-sm border-slate-300">
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-1">
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs uppercase">Buscar</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    placeholder="Buscar produto, código, categoria..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-8 text-xs"
                  />
                  {searchTerm && (
                    <button onClick={() => setSearchTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-3 h-3 text-slate-400" /></button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase">Categoria</Label>
                <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todas</SelectItem>
                    {categorias.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase">Unidade</Label>
                <Select value={filtroUnidade} onValueChange={setFiltroUnidade}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todas</SelectItem>
                    {unidades.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase">Local</Label>
                <Select value={filtroLocal} onValueChange={setFiltroLocal}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    {locais.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase">Tipo Consumo</Label>
                <Select value={filtroTipoConsumo} onValueChange={setFiltroTipoConsumo}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    {tiposConsumo.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-1 mt-2">
              <div className="space-y-1">
                <Label className="text-xs uppercase">Estoque</Label>
                <Select value={filtroEstoque} onValueChange={setFiltroEstoque}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    <SelectItem value="baixo" className="text-xs">Estoque Baixo</SelectItem>
                    <SelectItem value="ok" className="text-xs">Estoque OK</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-between items-center mt-2 gap-2 flex-wrap">
              <div className="text-xs text-slate-500">
                {produtosFiltrados.length} de {produtos.length} registros
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
                      <DropdownMenuItem onClick={handleBulkPrint} className="text-xs">
                        Imprimir Todos
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleBulkDelete} className="text-xs text-red-600">
                        Excluir Selecionados
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

        <Card className="shadow-sm border-slate-300">
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 border-b">
                    {colunasOrdenadas.map((coluna) => {
                      if (coluna.id === "selecao") {
                        return (
                          <TableHead key="selecao" className="text-xs font-bold py-2 px-2 border-r border-slate-200 w-10">
                            <Checkbox
                              checked={selectedItems.length === produtosFiltrados.length && produtosFiltrados.length > 0}
                              onCheckedChange={toggleSelectAll}
                            />
                          </TableHead>
                        );
                      }

                      if (coluna.id === "acoes") {
                        return <TableHead key="acoes" className="text-xs font-bold py-2 px-2 border-r border-slate-200 w-10"></TableHead>;
                      }

                      const isRight = coluna.align === "right";
                      return (
                        <TableHead
                          key={coluna.id}
                          className={`text-xs font-bold py-2 px-3 border-r border-slate-200 ${coluna.sortable ? "cursor-pointer hover:bg-slate-100" : ""} ${isRight ? "text-right" : ""}`}
                          onClick={() => coluna.sortable && handleSort(coluna.id)}
                        >
                          <div className={`${isRight ? "text-right" : ""}`}>
                            {coluna.label} {coluna.sortable ? getSortLabel(coluna.id) : ""}
                          </div>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : paginatedProdutos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400">
                        Nenhum produto encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedProdutos.map((produto) => {
                      const estoqueAbaixoMinimo = Number(produto.estoque_atual || 0) <= Number(produto.estoque_minimo || 0);

                      return (
                        <TableRow key={produto.id} className={`hover:bg-slate-50 transition-colors border-b ${estoqueAbaixoMinimo ? "bg-red-50/40" : ""}`}>
                          {colunasOrdenadas.map((coluna) => {
                            if (coluna.id === "selecao") {
                              return (
                                <TableCell key={`${produto.id}-selecao`} className="text-xs py-2 px-2 border-r border-slate-200">
                                  <Checkbox
                                    checked={selectedItems.includes(produto.id)}
                                    onCheckedChange={() => toggleSelectItem(produto.id)}
                                  />
                                </TableCell>
                              );
                            }

                            if (coluna.id === "acoes") {
                              return (
                                <TableCell key={`${produto.id}-acoes`} className="text-xs py-2 px-2 border-r border-slate-200 text-center">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-6 w-6">
                                        <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                      <DropdownMenuItem onClick={() => onEdit(produto)} className="text-xs">
                                        Editar
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => onPrint(produto)} className="text-xs">
                                        Imprimir Ficha
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => setDeleteConfirm(produto)} className="text-xs text-red-600">
                                        Excluir
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              );
                            }

                            return (
                              <TableCell
                                key={`${produto.id}-${coluna.id}`}
                                className={`text-xs py-2 px-3 border-r border-slate-200 ${coluna.align === "right" ? "text-right font-mono" : ""}`}
                              >
                                {renderCell(produto, coluna.id)}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Itens por página:</span>
                  <Select value={String(itemsPerPage)} onValueChange={(value) => { setItemsPerPage(Number(value)); setCurrentPage(1); }}>
                    <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[25, 50, 100, 200].map((numero) => (
                        <SelectItem key={numero} value={String(numero)}>{numero}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((prev) => prev - 1)} className="h-7 text-xs">
                    Anterior
                  </Button>
                  <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((prev) => prev + 1)} className="h-7 text-xs">
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfiguracaoColunasProdutosDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Confirmar exclusão"
        description="Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita."
        onConfirm={() => {
          onDelete(deleteConfirm.id);
          setDeleteConfirm(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={() => setBulkDeleteConfirm(false)}
        title="Confirmar exclusão"
        description={`Tem certeza que deseja excluir ${selectedItems.length} item(ns)? Esta ação não pode ser desfeita.`}
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
            <DialogDescription>
              Aguarde enquanto excluímos os produtos selecionados...
            </DialogDescription>
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
              <p className="text-center text-sm font-medium text-red-600">
                {deleteProgressPercentage}%
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}