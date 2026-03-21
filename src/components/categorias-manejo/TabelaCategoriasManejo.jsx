import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import ConfiguracaoColunasCategoriasManejoDialog from "@/components/categorias-manejo/ConfiguracaoColunasCategoriasManejoDialog";

const VALOR_TODOS = "__TODOS__";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true },
  { id: "acoes", label: "Ações", default: true, fixo: true },
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left" },
  { id: "sigla", label: "Sigla", default: true, sortable: true, align: "left" },
  { id: "sexo", label: "Sexo", default: true, sortable: true, align: "left" },
  { id: "raca", label: "Raça", default: true, sortable: true, align: "left" },
  { id: "idade", label: "Faixa Idade", default: true, sortable: true, align: "left" },
  { id: "especie", label: "Espécie", default: false, sortable: true, align: "left" },
  { id: "categoria_oficial", label: "Categoria Oficial", default: true, sortable: true, align: "left" },
  { id: "ganho_anual", label: "Ganho Anual (kg)", default: false, sortable: true, align: "right" },
  { id: "gmd_jan", label: "GMD Jan", default: false, sortable: true, align: "right" },
  { id: "gmd_fev", label: "GMD Fev", default: false, sortable: true, align: "right" },
  { id: "gmd_mar", label: "GMD Mar", default: false, sortable: true, align: "right" },
  { id: "gmd_abr", label: "GMD Abr", default: false, sortable: true, align: "right" },
  { id: "gmd_mai", label: "GMD Mai", default: false, sortable: true, align: "right" },
  { id: "gmd_jun", label: "GMD Jun", default: false, sortable: true, align: "right" },
  { id: "gmd_jul", label: "GMD Jul", default: false, sortable: true, align: "right" },
  { id: "gmd_ago", label: "GMD Ago", default: false, sortable: true, align: "right" },
  { id: "gmd_set", label: "GMD Set", default: false, sortable: true, align: "right" },
  { id: "gmd_out", label: "GMD Out", default: false, sortable: true, align: "right" },
  { id: "gmd_nov", label: "GMD Nov", default: false, sortable: true, align: "right" },
  { id: "gmd_dez", label: "GMD Dez", default: false, sortable: true, align: "right" },
];

export default function TabelaCategoriasManejo({
  categorias,
  onEdit,
  onDelete,
  showConfigColunas,
  setShowConfigColunas,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroSexo, setFiltroSexo] = useState(VALOR_TODOS);
  const [filtroEspecie, setFiltroEspecie] = useState(VALOR_TODOS);
  const [filtroCategoriaOficial, setFiltroCategoriaOficial] = useState(VALOR_TODOS);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_categorias_manejo");
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
    const saved = localStorage.getItem("colunas_visiveis_categorias_manejo");
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
    setSelectedItems((prev) => prev.filter((id) => categorias.some((item) => item.id === id)));
  }, [categorias]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroSexo, filtroEspecie, filtroCategoriaOficial, itemsPerPage]);

  const especies = useMemo(() => [...new Set(categorias.map((item) => item.especie).filter(Boolean))].sort(), [categorias]);
  const categoriasOficiais = useMemo(() => [...new Set(categorias.map((item) => item.categoria_oficial).filter(Boolean))].sort(), [categorias]);

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];

    setColunasVisiveis(novasColunas);
    localStorage.setItem("colunas_visiveis_categorias_manejo", JSON.stringify(novasColunas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_categorias_manejo", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id))
      .filter((c) => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  const categoriasFiltradas = useMemo(() => {
    return categorias.filter((item) => {
      const termo = searchTerm.toLowerCase();
      const matchSearch =
        !termo ||
        item.nome?.toLowerCase().includes(termo) ||
        item.sigla?.toLowerCase().includes(termo) ||
        item.raca?.toLowerCase().includes(termo) ||
        item.categoria_oficial?.toLowerCase().includes(termo);
      const matchSexo = filtroSexo === VALOR_TODOS || item.sexo === filtroSexo;
      const matchEspecie = filtroEspecie === VALOR_TODOS || item.especie === filtroEspecie;
      const matchCategoriaOficial = filtroCategoriaOficial === VALOR_TODOS || item.categoria_oficial === filtroCategoriaOficial;
      return matchSearch && matchSexo && matchEspecie && matchCategoriaOficial;
    });
  }, [categorias, searchTerm, filtroSexo, filtroEspecie, filtroCategoriaOficial]);

  const categoriasOrdenadas = useMemo(() => {
    const sorted = [...categoriasFiltradas];
    sorted.sort((a, b) => {
      let aValue;
      let bValue;

      switch (sortConfig.key) {
        case "ganho_anual":
          aValue = Number(a.ganho_peso_anual_kg || 0);
          bValue = Number(b.ganho_peso_anual_kg || 0);
          break;
        case "gmd_jan":
          aValue = Number(a.gmd_janeiro || 0);
          bValue = Number(b.gmd_janeiro || 0);
          break;
        case "gmd_fev":
          aValue = Number(a.gmd_fevereiro || 0);
          bValue = Number(b.gmd_fevereiro || 0);
          break;
        case "gmd_mar":
          aValue = Number(a.gmd_marco || 0);
          bValue = Number(b.gmd_marco || 0);
          break;
        case "gmd_abr":
          aValue = Number(a.gmd_abril || 0);
          bValue = Number(b.gmd_abril || 0);
          break;
        case "gmd_mai":
          aValue = Number(a.gmd_maio || 0);
          bValue = Number(b.gmd_maio || 0);
          break;
        case "gmd_jun":
          aValue = Number(a.gmd_junho || 0);
          bValue = Number(b.gmd_junho || 0);
          break;
        case "gmd_jul":
          aValue = Number(a.gmd_julho || 0);
          bValue = Number(b.gmd_julho || 0);
          break;
        case "gmd_ago":
          aValue = Number(a.gmd_agosto || 0);
          bValue = Number(b.gmd_agosto || 0);
          break;
        case "gmd_set":
          aValue = Number(a.gmd_setembro || 0);
          bValue = Number(b.gmd_setembro || 0);
          break;
        case "gmd_out":
          aValue = Number(a.gmd_outubro || 0);
          bValue = Number(b.gmd_outubro || 0);
          break;
        case "gmd_nov":
          aValue = Number(a.gmd_novembro || 0);
          bValue = Number(b.gmd_novembro || 0);
          break;
        case "gmd_dez":
          aValue = Number(a.gmd_dezembro || 0);
          bValue = Number(b.gmd_dezembro || 0);
          break;
        case "idade":
          aValue = Number(a.idade_minima_meses || 0);
          bValue = Number(b.idade_minima_meses || 0);
          break;
        default:
          aValue = String(
            sortConfig.key === "nome" ? a.nome || "" :
            sortConfig.key === "sigla" ? a.sigla || "" :
            sortConfig.key === "sexo" ? a.sexo || "" :
            sortConfig.key === "raca" ? a.raca || "" :
            sortConfig.key === "especie" ? a.especie || "" :
            sortConfig.key === "categoria_oficial" ? a.categoria_oficial || "" : ""
          ).toLowerCase();
          bValue = String(
            sortConfig.key === "nome" ? b.nome || "" :
            sortConfig.key === "sigla" ? b.sigla || "" :
            sortConfig.key === "sexo" ? b.sexo || "" :
            sortConfig.key === "raca" ? b.raca || "" :
            sortConfig.key === "especie" ? b.especie || "" :
            sortConfig.key === "categoria_oficial" ? b.categoria_oficial || "" : ""
          ).toLowerCase();
          break;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [categoriasFiltradas, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(categoriasOrdenadas.length / itemsPerPage));
  const categoriasPaginadas = categoriasOrdenadas.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
    return sortConfig.direction === "asc" ?
      <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" /> :
      <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === categoriasFiltradas.length && categoriasFiltradas.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(categoriasFiltradas.map((item) => item.id));
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroSexo(VALOR_TODOS);
    setFiltroEspecie(VALOR_TODOS);
    setFiltroCategoriaOficial(VALOR_TODOS);
  };

  const handleExcluirSelecionados = () => {
    selectedItems.forEach((id) => onDelete(id));
    setSelectedItems([]);
  };

  const renderCell = (item, colunaId) => {
    if (colunaId === "nome") return item.nome || "-";
    if (colunaId === "sigla") return item.sigla || "-";
    if (colunaId === "sexo") return item.sexo || "-";
    if (colunaId === "raca") return item.raca || "-";
    if (colunaId === "idade") {
      if (!item.idade_minima_meses && !item.idade_maxima_meses) return "-";
      return `${item.idade_minima_meses || 0} - ${item.idade_maxima_meses || "∞"} meses`;
    }
    if (colunaId === "especie") return item.especie || "-";
    if (colunaId === "categoria_oficial") return item.categoria_oficial || "-";
    if (colunaId === "ganho_anual") return item.ganho_peso_anual_kg ?? "-";
    if (colunaId === "gmd_jan") return item.gmd_janeiro ?? "-";
    if (colunaId === "gmd_fev") return item.gmd_fevereiro ?? "-";
    if (colunaId === "gmd_mar") return item.gmd_marco ?? "-";
    if (colunaId === "gmd_abr") return item.gmd_abril ?? "-";
    if (colunaId === "gmd_mai") return item.gmd_maio ?? "-";
    if (colunaId === "gmd_jun") return item.gmd_junho ?? "-";
    if (colunaId === "gmd_jul") return item.gmd_julho ?? "-";
    if (colunaId === "gmd_ago") return item.gmd_agosto ?? "-";
    if (colunaId === "gmd_set") return item.gmd_setembro ?? "-";
    if (colunaId === "gmd_out") return item.gmd_outubro ?? "-";
    if (colunaId === "gmd_nov") return item.gmd_novembro ?? "-";
    if (colunaId === "gmd_dez") return item.gmd_dezembro ?? "-";
    return "-";
  };

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs">Buscar</Label>
                <Input
                  placeholder="Buscar categoria, sigla, raça..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sexo</Label>
                <Select value={filtroSexo} onValueChange={setFiltroSexo}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                    <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Espécie</Label>
                <Select value={filtroEspecie} onValueChange={setFiltroEspecie}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todas</SelectItem>
                    {especies.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Categoria Oficial</Label>
                <Select value={filtroCategoriaOficial} onValueChange={setFiltroCategoriaOficial}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todas</SelectItem>
                    {categoriasOficiais.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-between items-center mt-2 gap-2 flex-wrap">
              <div className="text-xs text-slate-500">
                {categoriasFiltradas.length} de {categorias.length} registros
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
                      <DropdownMenuItem onClick={handleExcluirSelecionados} className="text-xs text-red-600">
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
                              checked={selectedItems.length === categoriasFiltradas.length && categoriasFiltradas.length > 0}
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
                  {categoriasPaginadas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                        Nenhuma categoria encontrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    categoriasPaginadas.map((item) => (
                      <TableRow key={item.id} className="hover:bg-gray-50 border-b">
                        {colunasOrdenadas.map((coluna) => {
                          if (coluna.id === "selecao") {
                            return (
                              <TableCell key={`${item.id}-selecao`} className="text-xs py-2 px-2">
                                <Checkbox
                                  checked={selectedItems.includes(item.id)}
                                  onCheckedChange={() => {
                                    setSelectedItems((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]);
                                  }}
                                />
                              </TableCell>
                            );
                          }

                          if (coluna.id === "acoes") {
                            return (
                              <TableCell key={`${item.id}-acoes`} className="text-xs py-2 px-2 text-center">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6">
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
                              </TableCell>
                            );
                          }

                          return (
                            <TableCell
                              key={`${item.id}-${coluna.id}`}
                              className={`text-xs py-2 px-3 ${coluna.align === "right" ? "text-right font-mono" : ""}`}
                            >
                              {renderCell(item, coluna.id)}
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
                    {[25, 50, 100, 200].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="h-7 text-xs">
                  Anterior
                </Button>
                <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
                <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="h-7 text-xs">
                  Próxima
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfiguracaoColunasCategoriasManejoDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd}
      />
    </>
  );
}