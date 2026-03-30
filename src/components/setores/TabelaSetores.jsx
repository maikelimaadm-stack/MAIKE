import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import ConfiguracaoColunasSetoresDialog from "@/components/setores/ConfiguracaoColunasSetoresDialog";

const VALOR_TODOS = "__TODOS__";

const COLUNAS_DISPONIVEIS = [
{ id: "selecao", label: "Seleção", default: true, fixo: true },
{ id: "acoes", label: "Ações", default: true, fixo: true },
{ id: "sigla", label: "Sigla", default: true, sortable: true, align: "left" },
{ id: "nome", label: "Nome", default: true, sortable: true, align: "left" },
{ id: "tipo", label: "Tipo", default: true, sortable: true, align: "left" },
{ id: "responsavel", label: "Responsável", default: true, sortable: true, align: "left" },
{ id: "cidade", label: "Cidade/UF", default: true, sortable: true, align: "left" },
{ id: "area_total", label: "Área (ha)", default: true, sortable: true, align: "right" },
{ id: "capacidade_animais", label: "Capacidade", default: true, sortable: true, align: "right" },
{ id: "telefone", label: "Telefone", default: false, sortable: true, align: "left" },
{ id: "ativo", label: "Status", default: true, sortable: true, align: "left" }];


export default function TabelaSetores({
  setores,
  isLoading,
  onEdit,
  onDelete,
  showConfigColunas,
  setShowConfigColunas
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroTipo, setFiltroTipo] = useState(VALOR_TODOS);
  const [filtroEstado, setFiltroEstado] = useState(VALOR_TODOS);
  const [filtroStatus, setFiltroStatus] = useState(VALOR_TODOS);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_setores");
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
    const saved = localStorage.getItem("colunas_visiveis_setores");
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
    setSelectedItems((prev) => prev.filter((id) => setores.some((item) => item.id === id)));
  }, [setores]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroTipo, filtroEstado, filtroStatus, itemsPerPage]);

  const tipos = useMemo(() => [...new Set(setores.map((item) => item.tipo).filter(Boolean))].sort(), [setores]);
  const estados = useMemo(() => [...new Set(setores.map((item) => item.estado).filter(Boolean))].sort(), [setores]);

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId) ?
    colunasVisiveis.filter((id) => id !== colunaId) :
    [...colunasVisiveis, colunaId];
    setColunasVisiveis(novasColunas);
    localStorage.setItem("colunas_visiveis_setores", JSON.stringify(novasColunas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_setores", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem.
    map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).
    filter((c) => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  const setoresFiltrados = useMemo(() => {
    return setores.filter((item) => {
      const termo = searchTerm.toLowerCase();
      const matchSearch =
      !termo ||
      item.nome?.toLowerCase().includes(termo) ||
      item.sigla?.toLowerCase().includes(termo) ||
      item.tipo?.toLowerCase().includes(termo) ||
      item.cidade?.toLowerCase().includes(termo);
      const matchTipo = filtroTipo === VALOR_TODOS || item.tipo === filtroTipo;
      const matchEstado = filtroEstado === VALOR_TODOS || item.estado === filtroEstado;
      const matchStatus =
      filtroStatus === VALOR_TODOS ||
      filtroStatus === "Ativo" && item.ativo !== false ||
      filtroStatus === "Inativo" && item.ativo === false;
      return matchSearch && matchTipo && matchEstado && matchStatus;
    });
  }, [setores, searchTerm, filtroTipo, filtroEstado, filtroStatus]);

  const setoresOrdenados = useMemo(() => {
    const sorted = [...setoresFiltrados];
    sorted.sort((a, b) => {
      let aValue;
      let bValue;

      switch (sortConfig.key) {
        case "area_total":
          aValue = Number(a.area_total || 0);
          bValue = Number(b.area_total || 0);
          break;
        case "capacidade_animais":
          aValue = Number(a.capacidade_animais || 0);
          bValue = Number(b.capacidade_animais || 0);
          break;
        case "ativo":
          aValue = a.ativo !== false ? 1 : 0;
          bValue = b.ativo !== false ? 1 : 0;
          break;
        case "cidade":
          aValue = `${a.cidade || ""}/${a.estado || ""}`.toLowerCase();
          bValue = `${b.cidade || ""}/${b.estado || ""}`.toLowerCase();
          break;
        default:
          aValue = String(a[sortConfig.key] || "").toLowerCase();
          bValue = String(b[sortConfig.key] || "").toLowerCase();
          break;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [setoresFiltrados, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(setoresOrdenados.length / itemsPerPage));
  const setoresPaginados = setoresOrdenados.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) {
      return <ArrowUpDown className="lucide lucide-arrow-up-down w-3 h-3 ml-1 opacity-30" />;
    }
    return sortConfig.direction === "asc" ?
    <ArrowUp className="lucide lucide-arrow-up-down w-3 h-3 ml-1 opacity-30" /> :
    <ArrowDown className="lucide lucide-arrow-up-down lucide lucide-arrow-up-down w-3 h-3 ml-1 opacity-30" />;
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === setoresFiltrados.length && setoresFiltrados.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(setoresFiltrados.map((item) => item.id));
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroTipo(VALOR_TODOS);
    setFiltroEstado(VALOR_TODOS);
    setFiltroStatus(VALOR_TODOS);
  };

  const handleExcluirSelecionados = () => {
    selectedItems.forEach((id) => onDelete(id));
    setSelectedItems([]);
  };

  const renderCell = (item, colunaId) => {
    if (colunaId === "sigla") return item.sigla || "-";
    if (colunaId === "nome") return item.nome || "-";
    if (colunaId === "tipo") return item.tipo || "-";
    if (colunaId === "responsavel") return item.responsavel || "-";
    if (colunaId === "cidade") return item.cidade && item.estado ? `${item.cidade}/${item.estado}` : item.cidade || item.estado || "-";
    if (colunaId === "area_total") return item.area_total ? Number(item.area_total).toLocaleString("pt-BR") : "-";
    if (colunaId === "capacidade_animais") return item.capacidade_animais ? Number(item.capacidade_animais).toLocaleString("pt-BR") : "-";
    if (colunaId === "telefone") return item.telefone || "-";
    if (colunaId === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
    return "-";
  };

  return (
    <>
      <div className="space-y-3">
        <Card>
          <CardContent className="p-6 px-1 py-1">
            <div className="grid grid-cols-2 md:grid-cols-8 gap-1">
              <div className="md:col-span-0 space-y-">
                <Label className="text-xs">Buscar</Label>
                <Input
                  placeholder="Buscar setor, sigla, cidade..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)} className="flex min-w-[130px] max-w-[180px]flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs" />
                
                
              </div>

              <div className="min-w-[130px] max-w-[180px] w-full">
                <Label className="text-xs">Tipo</Label>
                <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                  <SelectTrigger className="min-w-[130px] max-w-[180px] bg-transparent px-3 py-2 text-xs rounded-md flex w-full items-center justify-between whitespace-nowrap border border-input shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    {tipos.map((item) =>
                    <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[130px] max-w-[180px] w-full">
                <Label className="text-xs">Estado</Label>
                <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                  <SelectTrigger className="min-w-[130px] max-w-[180px] bg-transparent px-3 py-2 text-xs rounded-md flex w-full items-center justify-between whitespace-nowrap border border-input shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    {estados.map((item) =>
                    <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[130px] max-w-[180px] w-full">
                <Label className="text-xs">Status</Label>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger className="min-w-[130px] max-w-[180px] bg-transparent px-3 py-2 text-xs rounded-md flex w-full items-center justify-between whitespace-nowrap border border-input shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    <SelectItem value="Ativo" className="text-xs">Ativo</SelectItem>
                    <SelectItem value="Inativo" className="text-xs">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-between items-center mt-1 gap-2 flex-wrap">
              <div className="text-xs text-slate-500">
                {setoresFiltrados.length} de {setores.length} registros
              </div>
              <div className="flex gap-2 flex-wrap">
                {selectedItems.length > 0 &&
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        Ações ({selectedItems.length})
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleExcluirSelecionados} className="text-xs text-red-600">
                        Excluir Selecionados
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">
                        Limpar Seleção
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
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
                  <TableRow className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                    {colunasOrdenadas.map((coluna) => {
                      if (coluna.id === "selecao") {
                        return (
                          <TableHead key="selecao" className="h-10 p-2 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0">
                            <Checkbox
                              checked={selectedItems.length === setoresFiltrados.length && setoresFiltrados.length > 0}
                              onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 peer h-4 w-4 rounded-full border-2 border-gray-400 shadow-lg\\n focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400\\n disabled:cursor-not-allowed disabled:opacity-70\\n data-[state=checked]:bg-emerald-500 data-[state=checked]:text-white" />
                            
                          </TableHead>);

                      }

                      if (coluna.id === "acoes") {
                        return <TableHead key="acoes" className="h-10 p-2 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0"></TableHead>;
                      }

                      const isRight = coluna.align === "right";
                      return (
                        <TableHead
                          key={coluna.id} className="h-7 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[0px] text-gray-900 px-0 text-xs font-medium text-center border border-gray-300"

                          onClick={() => coluna.sortable && handleSort(coluna.id)}>
                          
                          <div className="inline-flex items-center gap-1 h-full">
                            {coluna.label} {coluna.sortable && <SortIcon column={coluna.id} />}
                          </div>
                        </TableHead>);

                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ?
                  <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400">
                        Carregando...
                      </TableCell>
                    </TableRow> :
                  setoresPaginados.length === 0 ?
                  <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400">
                        Nenhum setor encontrado
                      </TableCell>
                    </TableRow> :

                  setoresPaginados.map((item) =>
                  <TableRow key={item.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100 hover:text-gray-1000">
                        {colunasOrdenadas.map((coluna) => {
                      if (coluna.id === "selecao") {
                        return (
                          <TableCell key={`${item.id}-selecao`} className="p-0 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0">
                                <Checkbox
                              checked={selectedItems.includes(item.id)}
                              onCheckedChange={() => {
                                setSelectedItems((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]);
                              }} className="peer rounded-full peer shrink-0 data-[state=checked]:text-primary-foreground h-4 w-4 border-2 border-gray-400 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-70 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-center" />
                            
                              </TableCell>);

                      }

                      if (coluna.id === "acoes") {
                        return (
                          <TableCell key={`${item.id}-acoes`} className="p-0 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-9 font-medium text-sm font-medium\\\\\\\\nfocus-visible:outline-none rounded-md transition-colors focus-visible:outline-none focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 hover:bg-accent inline-flex items-center justify-center gap-2 whitespace-nowrap focus-visible:ring-1 focus-visible:ring-ring\\\\\\\\ndisabled:pointer-events-none disabled:opacity-50\\\\\\\\n[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0\\\\\\\\nhover:bg-accent hover:text-accent-foreground w-4">
                                      <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start">
                                    <DropdownMenuItem onClick={() => onEdit(item)} className="text-xs">
                                      Editar
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => onDelete(item.id)} className="text-xs text-red-600">
                                      Excluir
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>);

                      }

                      return (
                        <TableCell
                          key={`${item.id}-${coluna.id}`} className="p-2 text-gray-700 text-xs align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] px-2 h-7 border border-gray-300">
                          
                          
                              {renderCell(item, coluna.id)}
                            </TableCell>);

                    })}
                      </TableRow>
                  )
                  }
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between p-1 border-t">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Itens por página:</span>
                <Select value={String(itemsPerPage)} onValueChange={(value) => {setItemsPerPage(Number(value));setCurrentPage(1);}}>
                  <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[25, 50, 100, 200].map((numero) =>
                    <SelectItem key={numero} value={String(numero)}>{numero}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((prev) => prev - 1)} className="h-7 text-xs">
                  Anterior
                </Button>
                <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
                <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((prev) => prev + 1)} className="h-7 text-xs">
                  Próxima
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfiguracaoColunasSetoresDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd} />
      
    </>);

}