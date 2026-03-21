import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";

const VALOR_TODOS = "__TODOS__";
const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true },
  { id: "acoes", label: "Ações", default: true, fixo: true },
  { id: "codigo", label: "Código", default: true, sortable: true, align: "left" },
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left" },
  { id: "tipo", label: "Tipo", default: true, sortable: true, align: "left" },
  { id: "coordenadas", label: "Coordenadas", default: true, sortable: false, align: "left" },
  { id: "observacoes", label: "Observações", default: true, sortable: false, align: "left" },
];

export default function TabelaPontosGeo({ pontos, onEdit, onEditDetalhes, onDelete, showConfigColunas, setShowConfigColunas }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroTipo, setFiltroTipo] = useState(VALOR_TODOS);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [selecionados, setSelecionados] = useState([]);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_pontos_geo");
    if (saved) { try { return JSON.parse(saved); } catch { return COLUNAS_DISPONIVEIS.map((c) => c.id); } }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_pontos_geo");
    if (saved) { try { return JSON.parse(saved); } catch { return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id); } }
    return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
  });

  useEffect(() => { setCurrentPage(1); }, [searchTerm, filtroTipo, itemsPerPage]);
  const tipos = useMemo(() => [...new Set(pontos.map((item) => item.tipo).filter(Boolean))].sort(), [pontos]);
  const toggleColuna = (colunaId) => { const novas = colunasVisiveis.includes(colunaId) ? colunasVisiveis.filter((id) => id !== colunaId) : [...colunasVisiveis, colunaId]; setColunasVisiveis(novas); localStorage.setItem("colunas_visiveis_pontos_geo", JSON.stringify(novas)); };
  const handleDragEnd = (result) => { if (!result.destination) return; const items = Array.from(colunasOrdem); const [reordered] = items.splice(result.source.index, 1); items.splice(result.destination.index, 0, reordered); setColunasOrdem(items); localStorage.setItem("colunas_ordem_pontos_geo", JSON.stringify(items)); };
  const colunasOrdenadas = useMemo(() => colunasOrdem.map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).filter((c) => c && colunasVisiveis.includes(c.id)), [colunasOrdem, colunasVisiveis]);

  const pontosFiltrados = useMemo(() => pontos.filter((ponto) => {
    const termo = searchTerm.toLowerCase();
    const matchSearch = !termo || ponto.nome?.toLowerCase().includes(termo) || ponto.tipo?.toLowerCase().includes(termo) || ponto.numero_ponto?.toLowerCase().includes(termo);
    const matchTipo = filtroTipo === VALOR_TODOS || ponto.tipo === filtroTipo;
    return matchSearch && matchTipo;
  }), [pontos, searchTerm, filtroTipo]);

  const pontosOrdenados = useMemo(() => {
    const sorted = [...pontosFiltrados];
    sorted.sort((a, b) => {
      const aValue = String(sortConfig.key === 'codigo' ? a.numero_ponto || '' : sortConfig.key === 'tipo' ? a.tipo || '' : a.nome || '').toLowerCase();
      const bValue = String(sortConfig.key === 'codigo' ? b.numero_ponto || '' : sortConfig.key === 'tipo' ? b.tipo || '' : b.nome || '').toLowerCase();
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [pontosFiltrados, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(pontosOrdenados.length / itemsPerPage));
  const pontosPaginados = pontosOrdenados.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const handleSort = (key) => setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  const getSortLabel = (key) => (sortConfig.key !== key ? '' : sortConfig.direction === 'asc' ? '↑' : '↓');
  const handleSelecionarTodos = () => setSelecionados(selecionados.length === pontosFiltrados.length && pontosFiltrados.length > 0 ? [] : pontosFiltrados.map((p) => p.id));
  const handleToggleSelecao = (id) => setSelecionados((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  const limparFiltros = () => { setSearchTerm(''); setFiltroTipo(VALOR_TODOS); };
  const handleExcluirEmMassa = () => { selecionados.forEach((id) => { const ponto = pontos.find((p) => p.id === id); if (ponto) onDelete(ponto); }); setSelecionados([]); };

  const renderCell = (ponto, colunaId) => {
    if (colunaId === 'codigo') return ponto.numero_ponto || '-';
    if (colunaId === 'nome') return ponto.nome || '-';
    if (colunaId === 'tipo') return ponto.tipo || '-';
    if (colunaId === 'coordenadas') return ponto.coordenadas?.lat && ponto.coordenadas?.lng ? `${ponto.coordenadas.lat.toFixed(6)}, ${ponto.coordenadas.lng.toFixed(6)}` : '-';
    if (colunaId === 'observacoes') return ponto.observacoes || '-';
    return '-';
  };

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <div className="md:col-span-2 space-y-1"><Label className="text-xs">Buscar</Label><Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar pontos..." className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Tipo</Label><Select value={filtroTipo} onValueChange={setFiltroTipo}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>{tipos.map((item) => <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="flex justify-between items-center mt-2 gap-2 flex-wrap"><div className="text-xs text-slate-500">{pontosFiltrados.length} de {pontos.length} registros</div><div className="flex gap-2 flex-wrap">{selecionados.length > 0 && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selecionados.length})</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onClick={handleExcluirEmMassa} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}<Button variant="outline" size="sm" onClick={limparFiltros} className="h-7 text-xs">Limpar Filtros</Button></div></div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[500px]"><Table><TableHeader><TableRow className="bg-white border-b">{colunasOrdenadas.map((coluna) => { if (coluna.id === 'selecao') return <TableHead key="selecao" className="text-xs font-bold py-1 px-2 border border-black w-10"><Checkbox checked={selecionados.length === pontosFiltrados.length && pontosFiltrados.length > 0} onCheckedChange={handleSelecionarTodos} /></TableHead>; if (coluna.id === 'acoes') return <TableHead key="acoes" className="text-xs font-bold py-1 px-2 border border-black w-10"></TableHead>; return <TableHead key={coluna.id} className={`text-xs font-bold py-1 px-3 border border-black ${coluna.sortable ? 'cursor-pointer hover:bg-gray-50' : ''}`} onClick={() => coluna.sortable && handleSort(coluna.id)}><div>{coluna.label} {coluna.sortable ? getSortLabel(coluna.id) : ''}</div></TableHead>; })}</TableRow></TableHeader><TableBody>{pontosPaginados.length === 0 ? <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhum ponto encontrado</TableCell></TableRow> : pontosPaginados.map((ponto) => <TableRow key={ponto.id} className="hover:bg-gray-50 border-b">{colunasOrdenadas.map((coluna) => { if (coluna.id === 'selecao') return <TableCell key={`${ponto.id}-selecao`} className="text-xs py-1 px-2 border border-gray-300"><Checkbox checked={selecionados.includes(ponto.id)} onCheckedChange={() => handleToggleSelecao(ponto.id)} /></TableCell>; if (coluna.id === 'acoes') return <TableCell key={`${ponto.id}-acoes`} className="text-xs py-1 px-2 border border-gray-300 text-center"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => onEdit(ponto)} className="text-xs">Editar Posição</DropdownMenuItem><DropdownMenuItem onClick={() => onEditDetalhes && onEditDetalhes(ponto)} className="text-xs">Editar Detalhes</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => onDelete(ponto)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>; return <TableCell key={`${ponto.id}-${coluna.id}`} className="text-xs py-1 px-3 border border-gray-300">{coluna.id === 'tipo' ? <Badge variant="outline" className="text-[10px]">{renderCell(ponto, coluna.id)}</Badge> : renderCell(ponto, coluna.id)}</TableCell>; })}</TableRow>)}</TableBody></Table></div>
            {totalPages > 1 && <div className="flex items-center justify-between p-3 border-t"><div className="flex items-center gap-2"><span className="text-xs text-slate-500">Itens por página:</span><Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}><SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[25,50,100,200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent></Select></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage===1} onClick={() => setCurrentPage((p) => p-1)} className="h-7 text-xs">Anterior</Button><span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span><Button variant="outline" size="sm" disabled={currentPage===totalPages} onClick={() => setCurrentPage((p) => p+1)} className="h-7 text-xs">Próxima</Button></div></div>}
          </CardContent>
        </Card>
      </div>
      <ConfiguracaoColunasMapaDialog open={showConfigColunas} onOpenChange={setShowConfigColunas} colunasDisponiveis={COLUNAS_DISPONIVEIS} colunasVisiveis={colunasVisiveis} colunasOrdem={colunasOrdem} toggleColuna={toggleColuna} handleDragEnd={handleDragEnd} droppableId="colunas-pontos-geo" />
    </>
  );
}