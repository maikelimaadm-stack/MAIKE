import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, Download, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

const ITEMS_PER_PAGE = 50;

const formatDate = (d) => {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '-'; }
};

const motivoColors = {
  'Compra': 'bg-emerald-100 text-emerald-800',
  'Venda': 'bg-blue-100 text-blue-800',
  'Nascimento': 'bg-purple-100 text-purple-800',
  'Morte': 'bg-red-100 text-red-800',
  'Transferência': 'bg-amber-100 text-amber-800',
  'Transferência de Área': 'bg-amber-100 text-amber-800',
  'Mudança de Categoria': 'bg-indigo-100 text-indigo-800',
  'Abate': 'bg-orange-100 text-orange-800',
  'Pesagem': 'bg-cyan-100 text-cyan-800',
  'Cadastro': 'bg-slate-100 text-slate-800',
  'Renomear Lote': 'bg-teal-100 text-teal-800',
  'Junção de Lotes': 'bg-pink-100 text-pink-800',
};

const tipoColors = {
  'Entrada': 'bg-green-100 text-green-800 border-green-300',
  'Saída': 'bg-red-100 text-red-800 border-red-300',
  'Transferência de Área': 'bg-amber-100 text-amber-800 border-amber-300',
  'Morte': 'bg-red-100 text-red-800 border-red-300',
  'Nascimento': 'bg-purple-100 text-purple-800 border-purple-300',
  'Abate': 'bg-orange-100 text-orange-800 border-orange-300',
  'Mudança de Categoria': 'bg-indigo-100 text-indigo-800 border-indigo-300',
  'Pesagem': 'bg-cyan-100 text-cyan-800 border-cyan-300',
};

export default function MovimentacoesLote() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("__all__");
  const [filtroMotivo, setFiltroMotivo] = useState("__all__");
  const [filtroLote, setFiltroLote] = useState("__all__");
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [sortField, setSortField] = useState("data");
  const [sortDirection, setSortDirection] = useState("desc");
  const [currentPage, setCurrentPage] = useState(1);

  const { data: movMapa = [], isLoading: loadingMapa } = useQuery({
    queryKey: ['mov-mapa-lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoMapa.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId && (m.lote_id || m.lote));
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: movPec = [], isLoading: loadingPec } = useQuery({
    queryKey: ['mov-pec-lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId && (m.lote_id || m.lote));
    },
    enabled: !!empresaSelecionadaId,
  });

  const movimentacoes = useMemo(() => {
    const items = [];
    const seenIds = new Set();

    movMapa.forEach(m => {
      const key = `mapa-${m.id}`;
      if (seenIds.has(key)) return;
      seenIds.add(key);
      items.push({
        id: m.id, fonte: 'mapa', data: m.data_movimentacao,
        tipo: m.tipo || '-', motivo: m.motivo || m.tipo || '-',
        lote: m.lote || '-', lote_id: m.lote_id,
        quantidade: m.quantidade_animais || 0,
        area_origem: m.area_origem_nome || '', area_destino: m.area_destino_nome || '',
        categoria: m.categoria_animal || '', sexo: m.sexo || '',
        peso_medio: m.peso_medio || null, observacoes: m.observacoes || '',
      });
    });

    movPec.forEach(m => {
      const key = `pec-${m.id}`;
      if (seenIds.has(key)) return;
      seenIds.add(key);
      items.push({
        id: m.id, fonte: 'pecuaria', data: m.data_movimentacao,
        tipo: m.tipo || '-', motivo: m.motivo || m.tipo || '-',
        lote: m.lote || '-', lote_id: m.lote_id,
        quantidade: m.quantidade_animais || 0,
        area_origem: m.area_origem_nome || '', area_destino: m.area_destino_nome || '',
        categoria: m.categoria_animal || '', sexo: m.sexo || '',
        peso_medio: m.peso_medio || null,
        valor_total: m.valor_total || null,
        fornecedor: m.fornecedor_origem || m.destino_venda || '',
        nota_fiscal: m.nota_fiscal || '', gta: m.gta || '',
        causa_morte: m.causa_morte || '', observacoes: m.observacoes || '',
      });
    });

    return items;
  }, [movMapa, movPec]);

  const motivosUnicos = useMemo(() => [...new Set(movimentacoes.map(m => m.motivo).filter(m => m && m !== '-'))].sort(), [movimentacoes]);
  const tiposUnicos = useMemo(() => [...new Set(movimentacoes.map(m => m.tipo).filter(t => t && t !== '-'))].sort(), [movimentacoes]);
  const lotesUnicos = useMemo(() => [...new Set(movimentacoes.map(m => m.lote).filter(l => l && l !== '-'))].sort(), [movimentacoes]);

  const filtered = useMemo(() => {
    return movimentacoes.filter(m => {
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        if (!(m.lote?.toLowerCase().includes(s) || m.motivo?.toLowerCase().includes(s) ||
          m.area_origem?.toLowerCase().includes(s) || m.area_destino?.toLowerCase().includes(s) ||
          m.observacoes?.toLowerCase().includes(s) || m.fornecedor?.toLowerCase().includes(s)))
          return false;
      }
      if (filtroTipo !== "__all__" && m.tipo !== filtroTipo) return false;
      if (filtroMotivo !== "__all__" && m.motivo !== filtroMotivo) return false;
      if (filtroLote !== "__all__" && m.lote !== filtroLote) return false;
      if (filtroDataInicio && m.data?.split('T')[0] < filtroDataInicio) return false;
      if (filtroDataFim && m.data?.split('T')[0] > filtroDataFim) return false;
      return true;
    });
  }, [movimentacoes, searchTerm, filtroTipo, filtroMotivo, filtroLote, filtroDataInicio, filtroDataFim]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aV, bV;
      switch (sortField) {
        case 'data': aV = new Date(a.data).getTime() || 0; bV = new Date(b.data).getTime() || 0; break;
        case 'lote': aV = (a.lote || '').toLowerCase(); bV = (b.lote || '').toLowerCase(); break;
        case 'quantidade': aV = a.quantidade; bV = b.quantidade; break;
        case 'motivo': aV = (a.motivo || '').toLowerCase(); bV = (b.motivo || '').toLowerCase(); break;
        default: return 0;
      }
      if (aV < bV) return sortDirection === 'asc' ? -1 : 1;
      if (aV > bV) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDirection]);

  const totalPages = Math.ceil(sorted.length / ITEMS_PER_PAGE);
  const paginated = sorted.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleSort = (field) => {
    if (sortField === field) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const limparFiltros = () => {
    setSearchTerm(""); setFiltroTipo("__all__"); setFiltroMotivo("__all__"); setFiltroLote("__all__");
    setFiltroDataInicio(""); setFiltroDataFim(""); setCurrentPage(1);
  };

  const handleExport = () => {
    const csv = [
      ['Data', 'Tipo', 'Motivo', 'Lote', 'Quantidade', 'Área Origem', 'Área Destino', 'Categoria', 'Peso Médio', 'Observações'].join(';'),
      ...filtered.map(m => [
        formatDate(m.data), m.tipo, m.motivo, m.lote, m.quantidade,
        m.area_origem, m.area_destino, m.categoria || '', m.peso_medio || '', m.observacoes
      ].join(';'))
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `movimentacoes_lotes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  const isLoading = loadingMapa || loadingPec;
  const totalEntradas = filtered.filter(m => m.tipo === 'Entrada').reduce((s, m) => s + m.quantidade, 0);
  const totalSaidas = filtered.filter(m => m.tipo === 'Saída').reduce((s, m) => s + m.quantidade, 0);

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Movimentações de Lotes</h1>
          <p className="text-xs text-slate-600">Todas as movimentações vinculadas a lotes (transferências, mortes, nascimentos, pesagens, etc.)</p>
        </div>
        <Button onClick={handleExport} variant="outline" size="sm" className="h-8 text-xs">
          <Download className="w-3.5 h-3.5 mr-1" /> Exportar
        </Button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="border-slate-200">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-slate-500">Total Registros</p>
            <p className="text-lg font-bold text-slate-900">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card className="border-green-200">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-green-600">Entradas</p>
            <p className="text-lg font-bold text-green-700">{totalEntradas} cab</p>
          </CardContent>
        </Card>
        <Card className="border-red-200">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-red-600">Saídas</p>
            <p className="text-lg font-bold text-red-700">{totalSaidas} cab</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-blue-600">Saldo</p>
            <p className="text-lg font-bold text-blue-700">{totalEntradas - totalSaidas} cab</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 relative">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Lote, motivo, área..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="h-8 text-xs pl-8" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={filtroTipo} onValueChange={(v) => { setFiltroTipo(v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">Todos</SelectItem>
                  {tiposUnicos.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Motivo</Label>
              <Select value={filtroMotivo} onValueChange={(v) => { setFiltroMotivo(v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">Todos</SelectItem>
                  {motivosUnicos.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Lote</Label>
              <Select value={filtroLote} onValueChange={(v) => { setFiltroLote(v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">Todos</SelectItem>
                  {lotesUnicos.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end">
              <Button variant="outline" size="sm" onClick={limparFiltros} className="h-8 text-xs w-full">
                <X className="w-3 h-3 mr-1" /> Limpar
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={filtroDataInicio} onChange={(e) => { setFiltroDataInicio(e.target.value); setCurrentPage(1); }} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={filtroDataFim} onChange={(e) => { setFiltroDataFim(e.target.value); setCurrentPage(1); }} className="h-8 text-xs" />
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">{filtered.length} de {movimentacoes.length} registros</div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="shadow-sm border-slate-300">
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs font-bold py-1 border border-black cursor-pointer hover:bg-slate-100" onClick={() => handleSort('data')}>
                    <div className="flex items-center">Data{getSortIcon('data')}</div>
                  </TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black cursor-pointer hover:bg-slate-100" onClick={() => handleSort('motivo')}>
                    <div className="flex items-center">Motivo{getSortIcon('motivo')}</div>
                  </TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black cursor-pointer hover:bg-slate-100" onClick={() => handleSort('lote')}>
                    <div className="flex items-center">Lote{getSortIcon('lote')}</div>
                  </TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('quantidade')}>
                    <div className="flex items-center justify-end">Qtd{getSortIcon('quantidade')}</div>
                  </TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Área Origem</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Área Destino</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Categoria</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Peso Médio</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Observações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell></TableRow>
                ) : paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">Nenhuma movimentação encontrada</TableCell></TableRow>
                ) : (
                  <AnimatePresence>
                    {paginated.map((m) => (
                      <motion.tr key={`${m.fonte}-${m.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hover:bg-gray-50 border-b">
                        <TableCell className="text-xs py-1 border border-gray-300 whitespace-nowrap">{formatDate(m.data)}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">
                          <Badge variant="outline" className={`text-[10px] ${tipoColors[m.tipo] || ''}`}>{m.tipo}</Badge>
                        </TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">
                          <Badge className={`text-[10px] ${motivoColors[m.motivo] || 'bg-slate-100 text-slate-700'}`}>{m.motivo}</Badge>
                        </TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{m.lote}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{m.quantidade}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{m.area_origem || '-'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{m.area_destino || '-'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{m.categoria || '-'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{m.peso_medio ? `${m.peso_medio} kg` : '-'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 max-w-[200px] truncate" title={m.observacoes}>{m.observacoes || '-'}</TableCell>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end px-4 py-3 border-t">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-7 text-xs">
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-7 text-xs">
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}