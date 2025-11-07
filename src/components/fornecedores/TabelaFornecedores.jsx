import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Trash2, Printer, Search, Users, Settings, CheckSquare } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true },
  { id: 'nome', label: 'Nome', default: true },
  { id: 'tipo', label: 'Tipo Pessoa', default: true },
  { id: 'documento', label: 'CPF/CNPJ', default: true },
  { id: 'telefone', label: 'Telefone', default: true },
  { id: 'email', label: 'E-mail', default: true },
  { id: 'cidade', label: 'Cidade', default: true },
  { id: 'estado', label: 'Estado', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
];

export default function TabelaFornecedores({ fornecedores, onEdit, onDelete, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [colunasVisiveis, setColunasVisiveis] = useState(
    COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id)
  );
  const [selectedItems, setSelectedItems] = useState([]);
  const [showBulkActions, setShowBulkActions] = useState(false);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => 
      prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === filteredFornecedores.length && filteredFornecedores.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(filteredFornecedores.map(f => f.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} cadastro(s) selecionado(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
      selectedItems.forEach(id => onDelete(id));
      setSelectedItems([]);
      setShowBulkActions(false);
    }
  };

  const handleBulkPrint = () => {
    selectedItems.forEach(id => {
      const fornecedor = fornecedores.find(f => f.id === id);
      if (fornecedor) onPrint(fornecedor);
    });
    setShowBulkActions(false);
  };

  const filteredFornecedores = fornecedores.filter(fornecedor => {
    const searchLower = searchTerm.toLowerCase();
    return (
      fornecedor.nome?.toLowerCase().includes(searchLower) ||
      fornecedor.cidade?.toLowerCase().includes(searchLower) ||
      fornecedor.cpf?.includes(searchLower) ||
      fornecedor.cnpj?.includes(searchLower) ||
      fornecedor.email?.toLowerCase().includes(searchLower) ||
      fornecedor.numero_cadastro?.includes(searchLower)
    );
  });

  return (
    <Card className="shadow-xl border-slate-200 bg-white">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            Lista de Fornecedores/Clientes
            <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
              {filteredFornecedores.length} {filteredFornecedores.length === 1 ? 'cadastro' : 'cadastros'}
            </Badge>
            {selectedItems.length > 0 && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-300">
                {selectedItems.length} selecionados
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-3 w-full md:w-auto">
            {selectedItems.length > 0 && (
              <DropdownMenu open={showBulkActions} onOpenChange={setShowBulkActions}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2 border-blue-300 text-blue-700">
                    <CheckSquare className="w-4 h-4" />
                    Ações em Massa
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Ações para {selectedItems.length} itens</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem onClick={handleBulkPrint}>
                    <Printer className="w-4 h-4 mr-2" />
                    Imprimir Todos
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem onClick={handleBulkDelete} className="text-red-600">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Excluir Todos
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            
            <div className="relative flex-1 md:w-80">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar por nº, nome, documento, cidade..."
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
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedItems.length === filteredFornecedores.length && filteredFornecedores.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                {colunasVisiveis.includes('numero') && <TableHead className="font-semibold text-slate-700">Nº</TableHead>}
                {colunasVisiveis.includes('nome') && <TableHead className="font-semibold text-slate-700">Nome</TableHead>}
                {colunasVisiveis.includes('tipo') && <TableHead className="font-semibold text-slate-700">Tipo</TableHead>}
                {colunasVisiveis.includes('documento') && <TableHead className="font-semibold text-slate-700">CPF/CNPJ</TableHead>}
                {colunasVisiveis.includes('telefone') && <TableHead className="font-semibold text-slate-700">Telefone</TableHead>}
                {colunasVisiveis.includes('email') && <TableHead className="font-semibold text-slate-700">E-mail</TableHead>}
                {colunasVisiveis.includes('cidade') && <TableHead className="font-semibold text-slate-700">Cidade</TableHead>}
                {colunasVisiveis.includes('estado') && <TableHead className="font-semibold text-slate-700">Estado</TableHead>}
                {colunasVisiveis.includes('observacoes') && <TableHead className="font-semibold text-slate-700">Observações</TableHead>}
                <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="wait">
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 bg-slate-200 rounded w-4"></div></TableCell>
                      {colunasVisiveis.map((col, idx) => (
                        <TableCell key={idx}><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      ))}
                      <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                    </TableRow>
                  ))
                ) : filteredFornecedores.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasVisiveis.length + 2} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Users className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhum cadastro encontrado</p>
                        <p className="text-sm">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando um novo fornecedor/cliente'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredFornecedores.map((fornecedor) => (
                    <motion.tr
                      key={fornecedor.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedItems.includes(fornecedor.id)}
                          onCheckedChange={() => toggleSelectItem(fornecedor.id)}
                        />
                      </TableCell>
                      {colunasVisiveis.includes('numero') && (
                        <TableCell className="font-bold text-slate-900">
                          {fornecedor.numero_cadastro || '-'}
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('nome') && (
                        <TableCell className="font-semibold text-slate-900">
                          {fornecedor.nome}
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('tipo') && (
                        <TableCell>
                          <Badge className={fornecedor.tipo_pessoa === 'Física' ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-purple-100 text-purple-800 border-purple-300'}>
                            {fornecedor.tipo_pessoa}
                          </Badge>
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('documento') && (
                        <TableCell className="font-mono text-slate-700">
                          {fornecedor.tipo_pessoa === 'Física' ? fornecedor.cpf || '-' : fornecedor.cnpj || '-'}
                        </TableCell>
                      )}
                      {colunasVisiveis.includes('telefone') && (
                        <TableCell className="text-slate-700">{fornecedor.telefone || '-'}</TableCell>
                      )}
                      {colunasVisiveis.includes('email') && (
                        <TableCell className="text-slate-700">{fornecedor.email || '-'}</TableCell>
                      )}
                      {colunasVisiveis.includes('cidade') && (
                        <TableCell className="text-slate-700">{fornecedor.cidade || '-'}</TableCell>
                      )}
                      {colunasVisiveis.includes('estado') && (
                        <TableCell className="text-slate-700 uppercase">{fornecedor.estado || '-'}</TableCell>
                      )}
                      {colunasVisiveis.includes('observacoes') && (
                        <TableCell className="text-slate-600 max-w-xs truncate">
                          {fornecedor.observacoes || '-'}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(fornecedor)}
                            className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            title="Editar"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onPrint(fornecedor)}
                            className="hover:bg-green-50 hover:text-green-700 transition-colors"
                            title="Imprimir Ficha"
                          >
                            <Printer className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(fornecedor.id)}
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