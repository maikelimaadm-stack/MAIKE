import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Search, ArrowRightLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
};

export default function TabelaMovimentacoes({ movimentacoes, onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredMovimentacoes = movimentacoes.filter(mov => {
    const searchLower = searchTerm.toLowerCase();
    return (
      mov.produto_nome?.toLowerCase().includes(searchLower) ||
      mov.tipo_movimentacao?.toLowerCase().includes(searchLower) ||
      mov.fornecedor_nome?.toLowerCase().includes(searchLower) ||
      mov.cliente_destino?.toLowerCase().includes(searchLower) ||
      mov.numero_nfe?.toLowerCase().includes(searchLower)
    );
  });

  const getTipoBadge = (tipo) => {
    const config = {
      'Entrada': 'bg-blue-100 text-blue-800 border-blue-300',
      'Saída': 'bg-orange-100 text-orange-800 border-orange-300',
      'Transferência': 'bg-purple-100 text-purple-800 border-purple-300',
    };
    return config[tipo] || '';
  };

  return (
    <Card className="shadow-xl border-slate-200 bg-white">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5 text-white" />
            </div>
            Movimentações de Estoque
            <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
              {filteredMovimentacoes.length} {filteredMovimentacoes.length === 1 ? 'movimentação' : 'movimentações'}
            </Badge>
          </CardTitle>
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Buscar por produto, tipo, fornecedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 border-slate-300 focus:border-green-500 focus:ring-green-500"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="font-semibold text-slate-700">Nº</TableHead>
                <TableHead className="font-semibold text-slate-700">Data</TableHead>
                <TableHead className="font-semibold text-slate-700">Tipo</TableHead>
                <TableHead className="font-semibold text-slate-700">Produto</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Quantidade</TableHead>
                <TableHead className="font-semibold text-slate-700">Origem</TableHead>
                <TableHead className="font-semibold text-slate-700">Destino</TableHead>
                <TableHead className="font-semibold text-slate-700">NF-e / Cliente</TableHead>
                <TableHead className="font-semibold text-slate-700">Fornecedor</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="wait">
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 bg-slate-200 rounded w-12"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-16"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-32"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-16"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                    </TableRow>
                  ))
                ) : filteredMovimentacoes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <ArrowRightLeft className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhuma movimentação encontrada</p>
                        <p className="text-sm">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece registrando uma nova movimentação'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMovimentacoes.map((mov) => (
                    <motion.tr
                      key={mov.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <TableCell className="font-bold text-slate-900">
                        {mov.numero_movimentacao || '-'}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {formatarData(mov.data_movimentacao)}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${getTipoBadge(mov.tipo_movimentacao)} border`}>
                          {mov.tipo_movimentacao}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-slate-900">
                        {mov.produto_nome}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-green-700">
                        {formatarNumero(mov.quantidade)} {mov.unidade_medida}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {mov.local_estoque_origem || '-'}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {mov.local_estoque_destino || '-'}
                      </TableCell>
                      <TableCell className="text-slate-700 text-xs">
                        {mov.numero_nfe || mov.cliente_destino || '-'}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {mov.fornecedor_nome || '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(mov)}
                            className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            title="Editar"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(mov.id)}
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