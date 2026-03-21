import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MoreVertical, Edit, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Settings2 } from "lucide-react";

const TODAS_COLUNAS = [
  { id: "codigo", label: "Código", sortable: false, align: "left" },
  { id: "nome", label: "Nome", sortable: true, align: "left" },
  { id: "cabecas", label: "Cabeças", sortable: true, align: "right" },
  { id: "categoria", label: "Categoria", sortable: true, align: "left" },
  { id: "peso", label: "Peso Médio", sortable: true, align: "right" },
  { id: "area", label: "Área Entrada", sortable: true, align: "left" },
  { id: "motivo", label: "Motivo", sortable: true, align: "left" },
  { id: "status", label: "Status", sortable: true, align: "left" },
  { id: "valor", label: "Valor Total", sortable: true, align: "right" },
];

const COLUNAS_PADRAO = TODAS_COLUNAS.map((coluna) => coluna.id);

export default function TabelaLotes({ lotes, areas, onEdit, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todos");
  const [filtroMotivo, setFiltroMotivo] = useState("todos");
  const [filtroArea, setFiltroArea] = useState("todos");
  const [sortField, setSortField] = useState("nome");
  const [sortDirection, setSortDirection] = useState("asc");
  const [selecionados, setSelecionados] = useState([]);
  const [colunasVisiveis, setColunasVisiveis] = useState(COLUNAS_PADRAO);

  const categorias = useMemo(() => [...new Set(lotes.map((item) => item.categoria_entrada || item.categoria).filter(Boolean))], [lotes]);
  const motivos = useMemo(() => [...new Set(lotes.map((item) => item.motivo_entrada || item.origem).filter(Boolean))], [lotes]);

  const lotesFiltrados = useMemo(() => {
    return lotes.filter((lote) => {
      const termo = searchTerm.toLowerCase();
      const nome = lote.nome?.toLowerCase() || "";
      const categoria = (lote.categoria_entrada || lote.categoria || "").toLowerCase();
      const area = (lote.area_entrada_nome || "").toLowerCase();
      const motivo = (lote.motivo_entrada || lote.origem || "").toLowerCase();
      const status = lote.status || "";

      const matchSearch = !termo || nome.includes(termo) || categoria.includes(termo) || area.includes(termo) || motivo.includes(termo);
      const matchStatus = filtroStatus === "todos" || status === filtroStatus;
      const matchCategoria = filtroCategoria === "todos" || (lote.categoria_entrada || lote.categoria) === filtroCategoria;
      const matchMotivo = filtroMotivo === "todos" || (lote.motivo_entrada || lote.origem) === filtroMotivo;
      const matchArea = filtroArea === "todos" || lote.area_entrada_id === filtroArea;

      return matchSearch && matchStatus && matchCategoria && matchMotivo && matchArea;
    });
  }, [lotes, searchTerm, filtroStatus, filtroCategoria, filtroMotivo, filtroArea]);

  const lotesOrdenados = useMemo(() => {
    const sorted = [...lotesFiltrados];
    sorted.sort((a, b) => {
      const aValue = sortField === "cabecas"
        ? Number(a.quantidade_entrada || a.quantidade_cabecas || 0)
        : sortField === "peso"
        ? Number(a.peso_entrada_kg || a.peso_medio_kg || 0)
        : sortField === "valor"
        ? Number(a.valor_total_compra || 0)
        : String(
            sortField === "categoria"
              ? a.categoria_entrada || a.categoria || ""
              : sortField === "area"
              ? a.area_entrada_nome || ""
              : sortField === "motivo"
              ? a.motivo_entrada || a.origem || ""
              : a[sortField] || ""
          ).toLowerCase();

      const bValue = sortField === "cabecas"
        ? Number(b.quantidade_entrada || b.quantidade_cabecas || 0)
        : sortField === "peso"
        ? Number(b.peso_entrada_kg || b.peso_medio_kg || 0)
        : sortField === "valor"
        ? Number(b.valor_total_compra || 0)
        : String(
            sortField === "categoria"
              ? b.categoria_entrada || b.categoria || ""
              : sortField === "area"
              ? b.area_entrada_nome || ""
              : sortField === "motivo"
              ? b.motivo_entrada || b.origem || ""
              : b[sortField] || ""
          ).toLowerCase();

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [lotesFiltrados, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3" />;
    return sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const handleSelecionarTodos = () => {
    if (selecionados.length === lotesOrdenados.length && lotesOrdenados.length > 0) {
      setSelecionados([]);
      return;
    }
    setSelecionados(lotesOrdenados.map((item) => item.id));
  };

  const handleLimparFiltros = () => {
    setSearchTerm("");
    setFiltroStatus("todos");
    setFiltroCategoria("todos");
    setFiltroMotivo("todos");
    setFiltroArea("todos");
  };

  const toggleColuna = (colunaId) => {
    setColunasVisiveis((prev) => prev.includes(colunaId) ? prev.filter((item) => item !== colunaId) : [...prev, colunaId]);
  };

  const formatarValor = (valor) => {
    if (!valor) return "-";
    return `R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  };

  const renderCell = (lote, colunaId) => {
    if (colunaId === "codigo") return `#${lote.numero_lote}`;
    if (colunaId === "nome") return lote.nome || "-";
    if (colunaId === "cabecas") return lote.quantidade_entrada || lote.quantidade_cabecas || "-";
    if (colunaId === "categoria") return lote.categoria_entrada || lote.categoria || "-";
    if (colunaId === "peso") return lote.peso_entrada_kg || lote.peso_medio_kg ? `${lote.peso_entrada_kg || lote.peso_medio_kg} KG` : "-";
    if (colunaId === "area") return lote.area_entrada_nome || "-";
    if (colunaId === "motivo") return lote.motivo_entrada || lote.origem || "-";
    if (colunaId === "status") return lote.status || "-";
    if (colunaId === "valor") return formatarValor(lote.valor_total_compra);
    return "-";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Buscar lote, categoria, área..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
                  className="h-8 text-xs pl-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
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
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todas</SelectItem>
                  {categorias.map((categoria) => (
                    <SelectItem key={categoria} value={categoria} className="text-xs">{categoria}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Motivo</Label>
              <Select value={filtroMotivo} onValueChange={setFiltroMotivo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Motivo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {motivos.map((motivo) => (
                    <SelectItem key={motivo} value={motivo} className="text-xs">{motivo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Área</Label>
              <Select value={filtroArea} onValueChange={setFiltroArea}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Área" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todas</SelectItem>
                  {areas.map((area) => (
                    <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mt-2">
            <div className="text-xs text-slate-500">
              {lotesOrdenados.length} de {lotes.length} registros
            </div>
            <div className="flex flex-wrap gap-2">
              {selecionados.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => onDelete(selecionados)} className="h-8 text-xs">
                  <Trash2 className="w-3.5 h-3.5" /> Excluir ({selecionados.length})
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <Settings2 className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs">Configurar colunas</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {TODAS_COLUNAS.map((coluna) => (
                    <DropdownMenuCheckboxItem
                      key={coluna.id}
                      checked={colunasVisiveis.includes(coluna.id)}
                      onCheckedChange={() => toggleColuna(coluna.id)}
                      className="text-xs"
                    >
                      {coluna.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={handleLimparFiltros} className="h-8 text-xs">
                Limpar Filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow className="bg-white border-b">
                  <TableHead className="text-xs font-bold py-2 px-2 border border-black w-10">
                    <Checkbox
                      checked={selecionados.length === lotesOrdenados.length && lotesOrdenados.length > 0}
                      onCheckedChange={handleSelecionarTodos}
                    />
                  </TableHead>
                  <TableHead className="text-xs font-bold py-2 px-2 border border-black w-10"></TableHead>
                  {TODAS_COLUNAS.filter((coluna) => colunasVisiveis.includes(coluna.id)).map((coluna) => {
                    const isRight = coluna.align === "right";
                    if (!coluna.sortable) {
                      return (
                        <TableHead key={coluna.id} className={`text-xs font-bold py-2 px-3 border border-black ${isRight ? 'text-right' : ''}`}>
                          {coluna.label}
                        </TableHead>
                      );
                    }

                    return (
                      <TableHead
                        key={coluna.id}
                        className={`text-xs font-bold py-2 px-3 border border-black cursor-pointer hover:bg-gray-50 ${isRight ? 'text-right' : ''}`}
                        onClick={() => handleSort(coluna.id)}
                      >
                        <div className={`flex items-center gap-1 ${isRight ? 'justify-end' : ''}`}>
                          {coluna.label} {getSortIcon(coluna.id)}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lotesOrdenados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasVisiveis.length + 2} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                      Nenhum lote encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  lotesOrdenados.map((lote) => (
                    <TableRow key={lote.id} className="hover:bg-gray-50 border-b">
                      <TableCell className="text-xs py-2 px-2 border border-gray-300">
                        <Checkbox
                          checked={selecionados.includes(lote.id)}
                          onCheckedChange={(checked) => setSelecionados((prev) => checked ? [...prev, lote.id] : prev.filter((id) => id !== lote.id))}
                        />
                      </TableCell>
                      <TableCell className="text-xs py-2 px-2 text-center border border-gray-300">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => onEdit(lote)} className="text-xs">
                              <Edit className="w-3.5 h-3.5" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onDelete(lote.id)} className="text-xs text-red-600">
                              <Trash2 className="w-3.5 h-3.5" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      {TODAS_COLUNAS.filter((coluna) => colunasVisiveis.includes(coluna.id)).map((coluna) => (
                        <TableCell
                          key={`${lote.id}-${coluna.id}`}
                          className={`text-xs py-2 px-3 border border-gray-300 ${coluna.align === 'right' ? 'text-right font-mono' : ''}`}
                        >
                          {renderCell(lote, coluna.id)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}