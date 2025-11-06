
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Trash2, Printer, Search, FileText, Settings } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  // Ensure numero is a number before calling toFixed
  const num = typeof numero === 'string' ? parseFloat(numero) : numero;
  if (isNaN(num)) return "0,00"; // Handle cases where conversion fails
  return num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'placa', label: 'Placa', default: true },
  { id: 'motorista', label: 'Motorista', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'fornecedor', label: 'Fornecedor/Destino', default: true },
  { id: 'tara', label: 'Tara (kg)', default: true },
  { id: 'bruto', label: 'Bruto (kg)', default: true },
  { id: 'liquido', label: 'Líquido (kg)', default: true },
  { id: 'observacoes', label: 'Observações', default: false },
];

export default function TabelaPesagens({ pesagens, onEdit, onDelete, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [colunasVisiveis, setColunasVisiveis] = useState(
    COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id)
  );

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => 
      prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId]
    );
  };

  const filteredPesagens = pesagens.filter(pesagem => {
    const searchLower = searchTerm.toLowerCase();
    return (
      pesagem.placa_caminhao?.toLowerCase().includes(searchLower) ||
      pesagem.nome_motorista?.toLowerCase().includes(searchLower) ||
      pesagem.produto?.toLowerCase().includes(searchLower) ||
      pesagem.fornecedor_destino?.toLowerCase().includes(searchLower)
    );
  });

  const formatarData = (dataString) => {
    if (!dataString) return '-';
    try {
      // Ensure dataString is parsed correctly, especially if it includes time and timezone info
      // new Date(dataString) might interpret 'YYYY-MM-DD' as UTC. To ensure local time interpretation,
      // it's sometimes better to parse it manually or ensure the string format is consistent.
      // For simplicity, assuming `data_pesagem` is in a format `new Date()` can handle.
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '-';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return '-';
    }
  };

  const getTipoBadgeColor = (tipo) => {
    const colors = {
      'Entrada': 'bg-green-100 text-green-800 border-green-300',
      'Saída': 'bg-red-100 text-red-800 border-red-300',
      'Ambos': 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[tipo] || 'bg-slate-100 text-slate-800 border-slate-300';
  };

  return (
    <Card className="shadow-xl border-slate-200 bg-white">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            Registros de Pesagens
            <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
              {filteredPesagens.length} {filteredPesagens.length === 1 ? 'registro' : 'registros'}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-80">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar por placa, motorista, produto..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 border-slate-300 focus:border-green-500 focus:ring-green-500"
              />
            </div>
            
            {/* Seletor de Colunas */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 border-slate-300">
                  <Settings className="w-4 h-4" />
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUNAS_DISPONIVEIS.map((coluna) => (
                  <DropdownMenuCheckboxItem
                    key={coluna.id}
                    checked={colunasVisiveis.includes(coluna.id)}
                    onCheckedChange={() => toggleColuna(coluna.id)}
                  >
                    {coluna.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                {colunasVisiveis.includes('data') && <TableHead className="font-semibold text-slate-700">Data</TableHead>}
                {colunasVisiveis.includes('tipo') && <TableHead className="font-semibold text-slate-700">Tipo</TableHead>}
                {colunasVisiveis.includes('placa') && <TableHead className="font-semibold text-slate-700">Placa</TableHead>}
                {colunasVisiveis.includes('motorista') && <TableHead className="font-semibold text-slate-700">Motorista</TableHead>}
                {colunasVisiveis.includes('produto') && <TableHead className="font-semibold text-slate-700">Produto</TableHead>}
                {colunasVisiveis.includes('fornecedor') && <TableHead className="font-semibold text-slate-700">Fornecedor/Destino</TableHead>}
                {colunasVisiveis.includes('tara') && <TableHead className="font-semibold text-slate-700 text-right">Tara (kg)</TableHead>}
                {colunasVisiveis.includes('bruto') && <TableHead className="font-semibold text-slate-700 text-right">Bruto (kg)</TableHead>}
                {colunasVisiveis.includes('liquido') && <TableHead className="font-semibold text-slate-700 text-right">Líquido (kg)</TableHead>}
                {colunasVisiveis.includes('observacoes') && <TableHead className="font-semibold text-slate-700">Observações</TableHead>}
                <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="wait">
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      {colunasVisiveis.map((col, idx) => (
                        <TableCell key={idx}><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      ))}
                      <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                    </TableRow>
                  ))
                ) : filteredPesagens.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasVisiveis.length + 1} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <FileText className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhum registro encontrado</p>
                        <p className="text-sm">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando uma nova pesagem'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPesagens.map((pesagem) => (
                    <motion.tr
                      key={pesagem.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      {colunasVisiveis.includes('data') && (
                        <TableCell className="font-medium text-slate-700">
                          {formatarData(pesagem.data_pesagem)}
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('tipo') && (
                        <TableCell>
                          <Badge className={`${getTipoBadgeColor(pesagem.tipo_pesagem)} border`}>
                            {pesagem.tipo_pesagem}
                          </Badge>
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('placa') && (
                        <TableCell className="font-semibold text-slate-900 uppercase">
                          {pesagem.placa_caminhao}
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('motorista') && (
                        <TableCell className="text-slate-700">{pesagem.nome_motorista}</TableCell>
                      )}
                      {colunasVisiveis.includes('produto') && (
                        <TableCell className="text-slate-700">{pesagem.produto}</TableCell>
                      )}
                      {colunasVisiveis.includes('fornecedor') && (
                        <TableCell className="text-slate-600">{pesagem.fornecedor_destino || '-'}</TableCell>
                      )}
                      {colunasVisiveis.includes('tara') && (
                        <TableCell className="text-right font-mono text-slate-700">
                          {formatarNumero(pesagem.peso_tara)}
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('bruto') && (
                        <TableCell className="text-right font-mono text-slate-700">
                          {formatarNumero(pesagem.peso_bruto)}
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('liquido') && (
                        <TableCell className="text-right font-mono font-bold text-green-700">
                          {formatarNumero(pesagem.peso_liquido)}
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('observacoes') && (
                        <TableCell className="text-slate-600 max-w-xs truncate">
                          {pesagem.observacoes || '-'}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(pesagem)}
                            className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            title="Editar"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onPrint(pesagem)}
                            className="hover:bg-green-50 hover:text-green-700 transition-colors"
                            title="Imprimir Ticket"
                          >
                            <Printer className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(pesagem.id)}
                            className="hover:bg-red-50 hover:text-red-700 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
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
