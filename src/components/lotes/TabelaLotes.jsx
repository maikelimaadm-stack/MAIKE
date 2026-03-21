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
import ConfiguracaoColunasLotesDialog from "@/components/lotes/ConfiguracaoColunasLotesDialog";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true },
  { id: "acoes", label: "Ações", default: true, fixo: true },
  { id: "codigo", label: "Código", default: true, sortable: true, align: "left" },
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left" },
  { id: "cabecas", label: "Cabeças", default: true, sortable: true, align: "right" },
  { id: "categoria", label: "Categoria", default: true, sortable: true, align: "left" },
  { id: "sexo", label: "Sexo", default: true, sortable: true, align: "left" },
  { id: "peso", label: "Peso Médio", default: true, sortable: true, align: "right" },
  { id: "area", label: "Área Entrada", default: true, sortable: true, align: "left" },
  { id: "motivo", label: "Motivo", default: true, sortable: true, align: "left" },
  { id: "data", label: "Data Entrada", default: true, sortable: true, align: "left" },
  { id: "status", label: "Status", default: true, sortable: true, align: "left" },
  { id: "valor", label: "Valor Total", default: false, sortable: true, align: "right" },
  { id: "fornecedor", label: "Fornecedor", default: false, sortable: true, align: "left" },
  { id: "observacoes", label: "Observações", default: false, sortable: false, align: "left" },
];

const VALOR_TODOS = "__TODOS__";

const formatarData = (data) => {
  if (!data) return "-";
  const [ano, mes, dia] = String(data).split("T")[0].split("-");
  if (!ano || !mes || !dia) return "-";
  return `${dia}/${mes}/${ano}`;
};

export default function TabelaLotes({
  lotes,
  areas,
  onEdit,
  onDelete,
  showConfigColunas,
  setShowConfigColunas,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroStatus, setFiltroStatus] = useState(VALOR_TODOS);
  const [filtroCategoria, setFiltroCategoria] = useState(VALOR_TODOS);
  const [filtroMotivo, setFiltroMotivo] = useState(VALOR_TODOS);
  const [filtroArea, setFiltroArea] = useState(VALOR_TODOS);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_cadastro_lotes");
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
    const saved = localStorage.getItem("colunas_visiveis_cadastro_lotes");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
  });

  const categorias = useMemo(() => [...new Set(lotes.map((item) => item.categoria_entrada || item.categoria).filter(Boolean))].sort(), [lotes]);
  const motivos = useMemo(() => [...new Set(lotes.map((item) => item.motivo_entrada || item.origem).filter(Boolean))].sort(), [lotes]);

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => lotes.some((item) => item.id === id)));
  }, [lotes]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroStatus, filtroCategoria, filtroMotivo, filtroArea, itemsPerPage]);

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novasColunas);
    localStorage.setItem("colunas_visiveis_cadastro_lotes", JSON.stringify(novasColunas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_cadastro_lotes", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((coluna) => coluna.id === id))
      .filter((coluna) => coluna && colunasVisiveis.includes(coluna.id));
  }, [colunasOrdem, colunasVisiveis]);

  const lotesFiltrados = useMemo(() => {
    return lotes.filter((lote) => {
      const termo = searchTerm.toLowerCase();
      const nome = lote.nome?.toLowerCase() || "";
      const codigo = String(lote.numero_lote || "").toLowerCase();
      const categoria = (lote.categoria_entrada || lote.categoria || "").toLowerCase();
      const area = (lote.area_entrada_nome || "").toLowerCase();
      const motivo = (lote.motivo_entrada || lote.origem || "").toLowerCase();

      const matchSearch = !termo || nome.includes(termo) || codigo.includes(termo) || categoria.includes(termo) || area.includes(termo) || motivo.includes(termo);
      const matchStatus = filtroStatus === VALOR_TODOS || lote.status === filtroStatus;
      const matchCategoria = filtroCategoria === VALOR_TODOS || (lote.categoria_entrada || lote.categoria) === filtroCategoria;
      const matchMotivo = filtroMotivo === VALOR_TODOS || (lote.motivo_entrada || lote.origem) === filtroMotivo;
      const matchArea = filtroArea === VALOR_TODOS || lote.area_entrada_id === filtroArea;

      return matchSearch && matchStatus && matchCategoria && matchMotivo && matchArea;
    });
  }, [lotes, searchTerm, filtroStatus, filtroCategoria, filtroMotivo, filtroArea]);

  const lotesOrdenados = useMemo(() => {
    const sorted = [...lotesFiltrados];
    sorted.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortConfig.key === "codigo") {
        aVal = Number(a.numero_lote || 0);
        bVal = Number(b.numero_lote || 0);
      } else if (sortConfig.key === "cabecas") {
        aVal = Number(a.quantidade_entrada || a.quantidade_cabecas || 0);
        bVal = Number(b.quantidade_entrada || b.quantidade_cabecas || 0);
      } else if (sortConfig.key === "peso") {
        aVal = Number(a.peso_entrada_kg || a.peso_medio_kg || 0);
        bVal = Number(b.peso_entrada_kg || b.peso_medio_kg || 0);
      } else if (sortConfig.key === "valor") {
        aVal = Number(a.valor_total_compra || 0);
        bVal = Number(b.valor_total_compra || 0);
      } else if (sortConfig.key === "data") {
        aVal = String(a.data_entrada || "");
        bVal = String(b.data_entrada || "");
      } else {
        aVal = String(
          sortConfig.key === "categoria"
            ? a.categoria_entrada || a.categoria || ""
            : sortConfig.key === "area"
            ? a.area_entrada_nome || ""
            : sortConfig.key === "motivo"
            ? a.motivo_entrada || a.origem || ""
            : sortConfig.key === "fornecedor"
            ? a.fornecedor_nome || ""
            : a[sortConfig.key] || ""
        ).toLowerCase();
        bVal = String(
          sortConfig.key === "categoria"
            ? b.categoria_entrada || b.categoria || ""
            : sortConfig.key === "area"
            ? b.area_entrada_nome || ""
            : sortConfig.key === "motivo"
            ? b.motivo_entrada || b.origem || ""
            : sortConfig.key === "fornecedor"
            ? b.fornecedor_nome || ""
            : b[sortConfig.key] || ""
        ).toLowerCase();
      }

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [lotesFiltrados, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(lotesOrdenados.length / itemsPerPage));
  const lotesPaginados = lotesOrdenados.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
    if (selectedItems.length === lotesFiltrados.length && lotesFiltrados.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(lotesFiltrados.map((item) => item.id));
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroStatus(VALOR_TODOS);
    setFiltroCategoria(VALOR_TODOS);
    setFiltroMotivo(VALOR_TODOS);
    setFiltroArea(VALOR_TODOS);
  };

  const formatarValor = (valor) => {
    if (!valor) return "-";
    return `R$ ${Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  };

  const renderCell = (lote, colunaId) => {
    if (colunaId === "codigo") return lote.numero_lote || "-";
    if (colunaId === "nome") return lote.nome || "-";
    if (colunaId === "cabecas") return lote.quantidade_entrada || lote.quantidade_cabecas || "-";
    if (colunaId === "categoria") return lote.categoria_entrada || lote.categoria || "-";
    if (colunaId === "sexo") return lote.sexo || "-";
    if (colunaId === "peso") return lote.peso_entrada_kg || lote.peso_medio_kg ? `${lote.peso_entrada_kg || lote.peso_medio_kg} kg` : "-";
    if (colunaId === "area") return lote.area_entrada_nome || "-";
    if (colunaId === "motivo") return lote.motivo_entrada || lote.origem || "-";
    if (colunaId === "data") return formatarData(lote.data_entrada);
    if (colunaId === "status") return lote.status || "-";
    if (colunaId === "valor") return formatarValor(lote.valor_total_compra);
    if (colunaId === "fornecedor") return lote.fornecedor_nome || "-";
    if (colunaId === "observacoes") return lote.observacoes || "-";
    return "-";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Buscar</Label>
              <Input
                placeholder="Buscar lote, código, categoria..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                  <SelectItem value="Ativo" className="text-xs">Ativo</SelectItem>
                  <SelectItem value="Inativo" className="text-xs">Inativo</SelectItem>
                  <SelectItem value="Vendido" className="text-xs">Vendido</SelectItem>
                  <SelectItem value="Abatido" className="text-xs">Abatido</SelectItem>
                  <SelectItem value="Transferido" className="text-xs">Transferido</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={VALOR_TODOS} className="text-xs">Todas</SelectItem>
                  {categorias.map((categoria) => (
                    <SelectItem key={categoria} value={categoria} className="text-xs">{categoria}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Motivo</Label>
              <Select value={filtroMotivo} onValueChange={setFiltroMotivo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null} className="text-xs">Todos</SelectItem>
                  {motivos.map((motivo) => (
                    <SelectItem key={motivo} value={motivo} className="text-xs">{motivo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Área</Label>
              <Select value={filtroArea} onValueChange={setFiltroArea}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={VALOR_TODOS} className="text-xs">Todas</SelectItem>
                  {areas.map((area) => (
                    <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-between items-center mt-2 gap-2 flex-wrap">
            <div className="text-xs text-slate-500">
              {lotesFiltrados.length} de {lotes.length} registros
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
                        <TableHead key="selecao" className="text-xs font-bold py-1 px-2 border border-black w-10">
                          <Checkbox
                            checked={selectedItems.length === lotesFiltrados.length && lotesFiltrados.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                      );
                    }

                    if (coluna.id === "acoes") {
                      return <TableHead key="acoes" className="text-xs font-bold py-1 px-2 border border-black w-16"></TableHead>;
                    }

                    const isRight = coluna.align === "right";
                    return (
                      <TableHead
                        key={coluna.id}
                        className={`text-xs font-bold py-1 px-3 border border-black ${coluna.sortable ? "cursor-pointer hover:bg-gray-50" : ""} ${isRight ? "text-right" : ""}`}
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
                {lotesPaginados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                      Nenhum lote encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  lotesPaginados.map((lote) => (
                    <TableRow key={lote.id} className="hover:bg-gray-50 border-b">
                      {colunasOrdenadas.map((coluna) => {
                        if (coluna.id === "selecao") {
                          return (
                            <TableCell key={`${lote.id}-selecao`} className="text-xs py-1 px-2 border border-gray-300">
                              <Checkbox
                                checked={selectedItems.includes(lote.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedItems((prev) => checked ? [...prev, lote.id] : prev.filter((id) => id !== lote.id));
                                }}
                              />
                            </TableCell>
                          );
                        }

                        if (coluna.id === "acoes") {
                          return (
                            <TableCell key={`${lote.id}-acoes`} className="text-xs py-1 px-2 border border-gray-300 text-center">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2">
                                    Ações
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem onClick={() => onEdit(lote)} className="text-xs">
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => onDelete(lote.id)} className="text-xs text-red-600">
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell
                            key={`${lote.id}-${coluna.id}`}
                            className={`text-xs py-1 px-3 border border-gray-300 ${coluna.align === "right" ? "text-right font-mono" : ""}`}
                          >
                            {renderCell(lote, coluna.id)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Itens por página:</span>
                <Select value={String(itemsPerPage)} onValueChange={(value) => setItemsPerPage(Number(value))}>
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

      <ConfiguracaoColunasLotesDialog
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