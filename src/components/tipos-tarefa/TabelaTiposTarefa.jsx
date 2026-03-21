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
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true },
  { id: "acoes", label: "Ações", default: true, fixo: true },
  { id: "nome_tipo", label: "Tipo", default: true, sortable: true, align: "left" },
  { id: "grupo_atividade_nome", label: "Grupo", default: true, sortable: true, align: "left" },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "left" },
  { id: "descricao", label: "Descrição", default: true, sortable: true, align: "left" },
  { id: "created_date", label: "Criado em", default: true, sortable: true, align: "left" },
  { id: "updated_date", label: "Atualizado em", default: true, sortable: true, align: "left" },
];

export default function TabelaTiposTarefa({ tipos, grupos, onEdit, onDelete, showConfigColunas, setShowConfigColunas }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("__TODOS__");
  const [sortConfig, setSortConfig] = useState({ key: "nome_tipo", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_tipos_tarefa");
    if (saved) {
      try { return JSON.parse(saved); } catch { return COLUNAS_DISPONIVEIS.map((c) => c.id); }
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_tipos_tarefa");
    if (saved) {
      try { return JSON.parse(saved); } catch { return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id); }
    }
    return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
  });

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => tipos.some((item) => item.id === id)));
  }, [tipos]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroGrupo, itemsPerPage]);

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem("colunas_visiveis_tipos_tarefa", JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_tipos_tarefa", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((coluna) => coluna.id === id))
      .filter((coluna) => coluna && colunasVisiveis.includes(coluna.id));
  }, [colunasOrdem, colunasVisiveis]);

  const tiposFiltrados = useMemo(() => {
    return tipos.filter((tipo) => {
      const termo = searchTerm.toLowerCase();
      const matchSearch = !termo || [tipo.nome_tipo, tipo.grupo_atividade_nome, tipo.descricao].some((value) => String(value || "").toLowerCase().includes(termo));
      const matchGrupo = filtroGrupo === "__TODOS__" || tipo.grupo_atividade_id === filtroGrupo;
      return matchSearch && matchGrupo;
    });
  }, [tipos, searchTerm, filtroGrupo]);

  const tiposOrdenados = useMemo(() => {
    const sorted = [...tiposFiltrados];
    sorted.sort((a, b) => {
      const aVal = sortConfig.key === "ativo" ? (a.ativo ? 1 : 0) : String(a[sortConfig.key] || "").toLowerCase();
      const bVal = sortConfig.key === "ativo" ? (b.ativo ? 1 : 0) : String(b[sortConfig.key] || "").toLowerCase();
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [tiposFiltrados, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(tiposOrdenados.length / itemsPerPage));
  const tiposPaginados = tiposOrdenados.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortConfig.direction === "asc" ? <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" /> : <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === tiposFiltrados.length && tiposFiltrados.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(tiposFiltrados.map((item) => item.id));
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroGrupo("__TODOS__");
  };

  const renderCell = (tipo, colunaId) => {
    if (colunaId === "nome_tipo") return tipo.nome_tipo || "-";
    if (colunaId === "grupo_atividade_nome") return tipo.grupo_atividade_nome || grupos.find((g) => g.id === tipo.grupo_atividade_id)?.nome_grupo || "-";
    if (colunaId === "ativo") return tipo.ativo ? "Sim" : "Não";
    if (colunaId === "descricao") return tipo.descricao || "-";
    if (colunaId === "created_date") return tipo.created_date ? new Date(tipo.created_date).toLocaleString("pt-BR") : "-";
    if (colunaId === "updated_date") return tipo.updated_date ? new Date(tipo.updated_date).toLocaleString("pt-BR") : "-";
    return "-";
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-1">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Buscar</Label>
              <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar tipo, grupo, descrição..." className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Grupo</Label>
              <Select value={filtroGrupo} onValueChange={setFiltroGrupo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__TODOS__" className="text-xs">Todos</SelectItem>
                  {grupos.map((grupo) => <SelectItem key={grupo.id} value={grupo.id} className="text-xs">{grupo.nome_grupo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-between items-center mt-2 gap-2 flex-wrap">
            <div className="text-xs text-slate-500">{tiposFiltrados.length} de {tipos.length} registros</div>
            <div className="flex gap-2 flex-wrap">
              {selectedItems.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDelete(selectedItems)} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">Limpar Seleção</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" size="sm" onClick={limparFiltros} className="h-7 text-xs">Limpar Filtros</Button>
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
                    if (coluna.id === "selecao") return <TableHead key="selecao" className="text-xs py-2 px-2"><Checkbox checked={selectedItems.length === tiposFiltrados.length && tiposFiltrados.length > 0} onCheckedChange={toggleSelectAll} /></TableHead>;
                    if (coluna.id === "acoes") return <TableHead key="acoes" className="text-xs py-2 px-2"></TableHead>;
                    const isRight = coluna.align === "right";
                    return <TableHead key={coluna.id} className={`text-xs py-2 px-3 ${coluna.sortable ? "cursor-pointer hover:bg-gray-50" : ""} ${isRight ? "text-right" : ""}`} onClick={() => coluna.sortable && handleSort(coluna.id)}><div className={`flex items-center gap-1 ${isRight ? "justify-end" : ""}`}>{coluna.label} {coluna.sortable && <SortIcon column={coluna.id} />}</div></TableHead>;
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiposPaginados.length === 0 ? (
                  <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhum tipo encontrado</TableCell></TableRow>
                ) : tiposPaginados.map((tipo) => (
                  <TableRow key={tipo.id} className="hover:bg-gray-50 border-b">
                    {colunasOrdenadas.map((coluna) => {
                      if (coluna.id === "selecao") return <TableCell key={`${tipo.id}-selecao`} className="text-xs py-2 px-2"><Checkbox checked={selectedItems.includes(tipo.id)} onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, tipo.id] : prev.filter((id) => id !== tipo.id))} /></TableCell>;
                      if (coluna.id === "acoes") return <TableCell key={`${tipo.id}-acoes`} className="text-xs py-2 px-2 text-center"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => onEdit(tipo)} className="text-xs">Editar</DropdownMenuItem><DropdownMenuItem onClick={() => onDelete(tipo.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>;
                      return <TableCell key={`${tipo.id}-${coluna.id}`} className={`text-xs py-2 px-3 ${coluna.align === "right" ? "text-right font-mono" : ""}`}>{renderCell(tipo, coluna.id)}</TableCell>;
                    })}
                  </TableRow>
                ))}
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
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)} className="h-7 text-xs">Anterior</Button>
              <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="h-7 text-xs">Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfiguracaoColunasMapaDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd}
        droppableId="colunas-tipos-tarefa"
      />
    </div>
  );
}