
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Copy, Printer, Search, Package, Settings, AlertTriangle } from "lucide-react";
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
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'nome', label: 'Nome do Produto', default: true },
  { id: 'codigo', label: 'Código Interno', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'unidade', label: 'Unidade', default: true },
  { id: 'preco_custo', label: 'Preço Custo', default: true },
  { id: 'preco_venda', label: 'Preço Venda', default: true },
  { id: 'estoque', label: 'Estoque Atual', default: true },
  { id: 'estoque_min', label: 'Estoque Mínimo', default: false },
  { id: 'barras', label: 'Cód. Barras', default: false },
];

export default function TabelaProdutos({ produtos, onEdit, onDelete, onPrint, isLoading }) {
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

  const filteredProdutos = produtos.filter(produto => {
    const searchLower = searchTerm.toLowerCase();
    return (
      produto.nome_produto?.toLowerCase().includes(searchLower) ||
      produto.categoria?.toLowerCase().includes(searchLower) ||
      produto.codigo_interno?.toLowerCase().includes(searchLower) ||
      produto.codigo_barras?.includes(searchLower)
    );
  });

  return (
    <Card className="shadow-xl border-slate-200 bg-white">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            Lista de Produtos
            <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
              {filteredProdutos.length} {filteredProdutos.length === 1 ? 'produto' : 'produtos'}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-80">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar por nome, código, categoria..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 border-slate-300 focus:border-green-500 focus:ring-green-500"
              />
            </div>
            
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
                {colunasVisiveis.includes('nome') && <TableHead className="font-semibold text-slate-700">Nome</TableHead>}
                {colunasVisiveis.includes('codigo') && <TableHead className="font-semibold text-slate-700">Código</TableHead>}
                {colunasVisiveis.includes('barras') && <TableHead className="font-semibold text-slate-700">Cód. Barras</TableHead>}
                {colunasVisiveis.includes('categoria') && <TableHead className="font-semibold text-slate-700">Categoria</TableHead>}
                {colunasVisiveis.includes('unidade') && <TableHead className="font-semibold text-slate-700">UN</TableHead>}
                {colunasVisiveis.includes('preco_custo') && <TableHead className="font-semibold text-slate-700 text-right">Custo</TableHead>}
                {colunasVisiveis.includes('preco_venda') && <TableHead className="font-semibold text-slate-700 text-right">Venda</TableHead>}
                {colunasVisiveis.includes('estoque') && <TableHead className="font-semibold text-slate-700 text-right">Estoque</TableHead>}
                {colunasVisiveis.includes('estoque_min') && <TableHead className="font-semibold text-slate-700 text-right">Est. Mín.</TableHead>}
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
                ) : filteredProdutos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasVisiveis.length + 1} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Package className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhum produto encontrado</p>
                        <p className="text-sm">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando um novo produto'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProdutos.map((produto) => {
                    const estoqueAbaixoMinimo = (produto.estoque_atual || 0) <= (produto.estoque_minimo || 0);
                    
                    return (
                      <motion.tr
                        key={produto.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${estoqueAbaixoMinimo ? 'bg-orange-50' : ''}`}
                      >
                        {colunasVisiveis.includes('nome') && (
                          <TableCell className="font-semibold text-slate-900">
                            {produto.nome_produto}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('codigo') && (
                          <TableCell className="font-mono text-slate-700">
                            {produto.codigo_interno || '-'}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('barras') && (
                          <TableCell className="font-mono text-slate-700">
                            {produto.codigo_barras || '-'}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('categoria') && (
                          <TableCell>
                            <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">
                              {produto.categoria || 'Sem categoria'}
                            </Badge>
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('unidade') && (
                          <TableCell className="text-slate-700">{produto.unidade_medida}</TableCell>
                        )}
                        {colunasVisiveis.includes('preco_custo') && (
                          <TableCell className="text-right font-mono text-slate-700">
                            R$ {formatarNumero(produto.preco_custo || 0)}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('preco_venda') && (
                          <TableCell className="text-right font-mono font-semibold text-green-700">
                            R$ {formatarNumero(produto.preco_venda || 0)}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('estoque') && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {estoqueAbaixoMinimo && <AlertTriangle className="w-4 h-4 text-orange-600" />}
                              <span className={`font-bold ${estoqueAbaixoMinimo ? 'text-orange-700' : 'text-slate-900'}`}>
                                {formatarNumero(produto.estoque_atual || 0)}
                              </span>
                            </div>
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('estoque_min') && (
                          <TableCell className="text-right text-slate-700">
                            {formatarNumero(produto.estoque_minimo || 0)}
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onEdit(produto)}
                              className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                              title="Editar"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onPrint(produto)}
                              className="hover:bg-green-50 hover:text-green-700 transition-colors"
                              title="Imprimir Ficha"
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onDelete(produto.id)}
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
