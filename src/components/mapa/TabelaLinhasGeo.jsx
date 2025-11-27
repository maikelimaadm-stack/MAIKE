import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { MoreVertical, Pencil, Trash2, Search, Route, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

export default function TabelaLinhasGeo({ linhas, onEdit, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("nome");
  const [sortDirection, setSortDirection] = useState("asc");
  const [selecionados, setSelecionados] = useState([]);

  const filteredLinhas = linhas.filter(linha =>
    linha.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    linha.tipo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    linha.numero_linha?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const linhasSorted = [...filteredLinhas].sort((a, b) => {
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
    if (selecionados.length === linhasSorted.length && linhasSorted.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(linhasSorted.map(l => l.id));
    }
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos uma linha!');
      return;
    }
    if (window.confirm(`Excluir ${selecionados.length} linha(s)?`)) {
      for (const id of selecionados) {
        const linha = linhas.find(l => l.id === id);
        if (linha) onDelete(linha);
      }
      setSelecionados([]);
    }
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Route className="w-4 h-4 text-slate-600" />
            Linhas Cadastradas ({linhasSorted.length})
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
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar linhas..."
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
                    checked={selecionados.length === linhasSorted.length && linhasSorted.length > 0}
                    onCheckedChange={handleSelecionarTodos}
                  />
                </TableHead>
                <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                <TableHead className="text-xs border-r border-slate-200">Código</TableHead>
                <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('nome')}>
                  <div className="flex items-center">Nome {getSortIcon('nome')}</div>
                </TableHead>
                <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('tipo')}>
                  <div className="flex items-center">Tipo {getSortIcon('tipo')}</div>
                </TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-right">Comprimento</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Observações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {linhasSorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">
                      Nenhuma linha encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  linhasSorted.map((linha) => (
                    <motion.tr 
                      key={linha.id}
                      initial={{ opacity: 0 }} 
                      animate={{ opacity: 1 }} 
                      exit={{ opacity: 0 }} 
                      className="hover:bg-slate-50 transition-colors border-b"
                    >
                      <TableCell className="border-r border-slate-200">
                        <Checkbox
                          checked={selecionados.includes(linha.id)}
                          onCheckedChange={() => handleToggleSelecao(linha.id)}
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
                            <DropdownMenuItem onClick={() => onEdit(linha)} className="text-xs">
                              <Pencil className="w-3.5 h-3.5 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onDelete(linha)} className="text-xs text-red-600">
                              <Trash2 className="w-3.5 h-3.5 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="text-xs font-mono border-r border-slate-200">{linha.numero_linha || '-'}</TableCell>
                      <TableCell className="text-xs font-medium border-r border-slate-200">{linha.nome}</TableCell>
                      <TableCell className="border-r border-slate-200">
                        <Badge variant="outline" className="text-[10px]">{linha.tipo}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono border-r border-slate-200">
                        {linha.comprimento_metros 
                          ? `${(linha.comprimento_metros / 1000).toFixed(2)} km`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 border-r border-slate-200 max-w-[200px] truncate">
                        {linha.observacoes || '-'}
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