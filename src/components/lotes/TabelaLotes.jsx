import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Search, MoreVertical, Edit, Trash2, MapPin, ArrowUpDown, ArrowUp, ArrowDown, X, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function TabelaLotes({ lotes, areas, onEdit, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("nome");
  const [sortDirection, setSortDirection] = useState("asc");
  const [selecionados, setSelecionados] = useState([]);

  const lotesFiltered = lotes.filter(lote =>
    lote.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lote.categoria?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lote.area_atual_nome?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const lotesSorted = [...lotesFiltered].sort((a, b) => {
    let aValue = a[sortField] || '';
    let bValue = b[sortField] || '';
    if (typeof aValue === 'string') aValue = aValue.toLowerCase();
    if (typeof bValue === 'string') bValue = bValue.toLowerCase();
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const handleSelecionarTodos = () => {
    if (selecionados.length === lotesSorted.length && lotesSorted.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(lotesSorted.map(l => l.id));
    }
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos um lote!');
      return;
    }
    if (window.confirm(`Excluir ${selecionados.length} lote(s)? Lotes com histórico de movimentações serão ignorados.`)) {
      for (const id of selecionados) {
        await onDelete(id);
      }
      setSelecionados([]);
    }
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900">
            Lista de Lotes ({lotesSorted.length})
          </CardTitle>
          <div className="flex gap-2 items-center">
            {selecionados.length > 0 && (
              <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 rounded px-2 py-1">
                <span className="text-xs font-semibold text-slate-800">
                  {selecionados.length} selecionado(s)
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5">
                      <MoreVertical className="w-4 h-4 text-slate-700" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleExcluirEmMassa} className="text-xs text-red-600">
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Excluir
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSelecionados([])} className="text-xs">
                      <X className="w-3.5 h-3.5 mr-2" />
                      Limpar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input 
                placeholder="Buscar lote..." 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
                className="pl-9 h-8 w-48 text-xs" 
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b">
                <TableHead className="w-8 text-xs border-r border-slate-200">
                  <Checkbox 
                    checked={selecionados.length === lotesSorted.length && lotesSorted.length > 0}
                    onCheckedChange={handleSelecionarTodos}
                  />
                </TableHead>
                <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                <TableHead className="text-xs border-r border-slate-200">Código</TableHead>
                <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('nome')}>
                  <div className="flex items-center">Nome {getSortIcon('nome')}</div>
                </TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-right">Cabeças</TableHead>
                <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('categoria')}>
                  <div className="flex items-center">Categoria {getSortIcon('categoria')}</div>
                </TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-right">Peso Médio</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Área Atual</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Status</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-right">Valor Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {lotesSorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">
                      Nenhum lote encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  lotesSorted.map((lote) => (
                    <motion.tr 
                      key={lote.id}
                      initial={{ opacity: 0 }} 
                      animate={{ opacity: 1 }} 
                      exit={{ opacity: 0 }} 
                      className="hover:bg-slate-50 transition-colors border-b"
                    >
                      <TableCell className="border-r border-slate-200">
                        <Checkbox
                          checked={selecionados.includes(lote.id)}
                          onCheckedChange={() => handleToggleSelecao(lote.id)}
                        />
                      </TableCell>
                      <TableCell className="text-center border-r border-slate-200">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => onEdit(lote)} className="text-xs">
                              <Edit className="w-3.5 h-3.5 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onDelete(lote.id)} className="text-xs text-red-600">
                              <Trash2 className="w-3.5 h-3.5 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="text-xs font-mono border-r border-slate-200">#{lote.numero_lote}</TableCell>
                      <TableCell className="text-xs font-medium border-r border-slate-200">{lote.nome}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold border-r border-slate-200">{lote.quantidade_cabecas}</TableCell>
                      <TableCell className="text-xs border-r border-slate-200">{lote.categoria}</TableCell>
                      <TableCell className="text-xs text-right font-mono border-r border-slate-200">{lote.peso_medio_kg ? `${lote.peso_medio_kg} kg` : '-'}</TableCell>
                      <TableCell className="text-xs border-r border-slate-200">
                        {lote.area_atual_nome ? (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <MapPin className="w-2.5 h-2.5" />
                            {lote.area_atual_nome}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="border-r border-slate-200">
                        <Badge className="text-[10px] bg-slate-100 text-slate-700">{lote.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono border-r border-slate-200">
                        {lote.valor_total_compra ? 
                          `R$ ${lote.valor_total_compra.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` 
                          : '-'}
                      </TableCell>
                    </motion.tr>
                  ))
                )}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}