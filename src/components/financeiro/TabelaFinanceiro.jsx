import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, DollarSign, Search, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    return format(new Date(dataString), 'dd/MM/yyyy');
  } catch {
    return '--/--/----';
  }
};

const getStatusBadge = (status) => {
  const config = {
    'Pendente': 'bg-yellow-100 text-yellow-800 border-yellow-300',
    'Pago Parcial': 'bg-blue-100 text-blue-800 border-blue-300',
    'Pago': 'bg-green-100 text-green-800 border-green-300',
    'Vencido': 'bg-red-100 text-red-800 border-red-300',
    'Cancelado': 'bg-gray-100 text-gray-800 border-gray-300',
  };
  return config[status] || '';
};

export default function TabelaFinanceiro({ lancamentos = [], tipo, onEdit, onDelete, onBaixa, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredLancamentos = lancamentos.filter(l => {
    const searchLower = searchTerm.toLowerCase();
    return (
      l.numero_lancamento?.includes(searchLower) ||
      l.fornecedor_nome?.toLowerCase().includes(searchLower) ||
      l.cliente_nome?.toLowerCase().includes(searchLower) ||
      l.numero_documento?.toLowerCase().includes(searchLower) ||
      l.centro_custo_nome?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <Card className="shadow-xl border-slate-200 bg-white">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className={`w-10 h-10 bg-gradient-to-br ${tipo === 'Pagar' ? 'from-red-600 to-red-700' : 'from-green-600 to-green-700'} rounded-xl flex items-center justify-center`}>
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            Contas a {tipo}
            <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
              {filteredLancamentos.length} {filteredLancamentos.length === 1 ? 'lançamento' : 'lançamentos'}
            </Badge>
          </CardTitle>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
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
                <TableHead className="font-semibold text-slate-700">Emissão</TableHead>
                <TableHead className="font-semibold text-slate-700">Vencimento</TableHead>
                <TableHead className="font-semibold text-slate-700">{tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'}</TableHead>
                <TableHead className="font-semibold text-slate-700">Documento</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Valor Total</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Pago</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Saldo</TableHead>
                <TableHead className="font-semibold text-slate-700">Status</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="wait">
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 bg-slate-200 rounded w-16"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-32"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                    </TableRow>
                  ))
                ) : filteredLancamentos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <DollarSign className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhum lançamento encontrado</p>
                        <p className="text-sm">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando um novo lançamento'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLancamentos.map((lancamento) => {
                    const isVencido = new Date(lancamento.data_vencimento) < new Date() && lancamento.status === 'Pendente';
                    
                    return (
                      <motion.tr
                        key={lancamento.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isVencido ? 'bg-red-50' : ''}`}
                      >
                        <TableCell className="font-bold text-slate-900">
                          {lancamento.numero_lancamento}
                          {lancamento.numero_parcela && (
                            <span className="text-xs text-slate-500 ml-1">
                              ({lancamento.numero_parcela}/{lancamento.total_parcelas})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-700 text-sm">{formatarData(lancamento.data_emissao)}</TableCell>
                        <TableCell className={`text-sm ${isVencido ? 'font-bold text-red-600' : 'text-slate-700'}`}>
                          {formatarData(lancamento.data_vencimento)}
                        </TableCell>
                        <TableCell className="font-semibold text-slate-900">
                          {lancamento.fornecedor_nome || lancamento.cliente_nome || '-'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-700">{lancamento.numero_documento || '-'}</TableCell>
                        <TableCell className="text-right font-mono font-bold text-slate-900">
                          {formatarMoeda(lancamento.valor_total)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-green-700">
                          {formatarMoeda(lancamento.valor_pago || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-blue-700">
                          {formatarMoeda(lancamento.valor_saldo || lancamento.valor_total)}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${getStatusBadge(lancamento.status)} border`}>
                            {lancamento.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            {lancamento.status !== 'Pago' && lancamento.status !== 'Cancelado' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onBaixa && onBaixa(lancamento)}
                                className="hover:bg-green-50 hover:text-green-700 transition-colors"
                                title="Dar Baixa"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onEdit && onEdit(lancamento)}
                              className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                              title="Editar"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onDelete && onDelete(lancamento.id)}
                              className="hover:bg-red-50 hover:text-red-700 transition-colors"
                              title="Excluir"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </motion.tr>
                    );
                  })
                )}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}