import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Copy, Printer, Search, FileText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

export default function TabelaPesagens({ pesagens, onEdit, onDelete, onDuplicate, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredPesagens = pesagens.filter(pesagem => {
    const searchLower = searchTerm.toLowerCase();
    return (
      pesagem.placa_caminhao?.toLowerCase().includes(searchLower) ||
      pesagem.nome_motorista?.toLowerCase().includes(searchLower) ||
      pesagem.produto?.toLowerCase().includes(searchLower) ||
      pesagem.fornecedor_destino?.toLowerCase().includes(searchLower)
    );
  });

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
      <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            Registros de Pesagens
            <Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-700 border-blue-300">
              {filteredPesagens.length} {filteredPesagens.length === 1 ? 'registro' : 'registros'}
            </Badge>
          </CardTitle>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Buscar por placa, motorista, produto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 border-slate-300 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="font-semibold text-slate-700">Data</TableHead>
                <TableHead className="font-semibold text-slate-700">Tipo</TableHead>
                <TableHead className="font-semibold text-slate-700">Placa</TableHead>
                <TableHead className="font-semibold text-slate-700">Motorista</TableHead>
                <TableHead className="font-semibold text-slate-700">Produto</TableHead>
                <TableHead className="font-semibold text-slate-700">Fornecedor/Destino</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Tara (kg)</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Bruto (kg)</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Líquido (kg)</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="wait">
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      <TableCell><div className="h-6 bg-slate-200 rounded-full w-16"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-32"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-28"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></TableCell>
                      <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                    </TableRow>
                  ))
                ) : filteredPesagens.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12">
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
                      <TableCell className="font-medium text-slate-700">
                        {format(new Date(pesagem.data_pesagem), "dd/MM/yyyy", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${getTipoBadgeColor(pesagem.tipo_pesagem)} border`}>
                          {pesagem.tipo_pesagem}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-slate-900 uppercase">
                        {pesagem.placa_caminhao}
                      </TableCell>
                      <TableCell className="text-slate-700">{pesagem.nome_motorista}</TableCell>
                      <TableCell className="text-slate-700">{pesagem.produto}</TableCell>
                      <TableCell className="text-slate-600">{pesagem.fornecedor_destino || '-'}</TableCell>
                      <TableCell className="text-right font-mono text-slate-700">
                        {pesagem.peso_tara?.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-slate-700">
                        {pesagem.peso_bruto?.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-green-700">
                        {pesagem.peso_liquido?.toFixed(2)}
                      </TableCell>
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
                            onClick={() => onDuplicate(pesagem)}
                            className="hover:bg-purple-50 hover:text-purple-700 transition-colors"
                            title="Duplicar"
                          >
                            <Copy className="w-4 h-4" />
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