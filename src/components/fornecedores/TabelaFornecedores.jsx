
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Trash2, Printer, Search, Users, Settings, CheckSquare, Loader2, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  
  // Carregar configuração de colunas do localStorage
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    if (typeof window !== 'undefined') { // Ensure localStorage is available (client-side)
      const saved = localStorage.getItem('colunas_fornecedores');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Filter out any IDs that are no longer available in COLUNAS_DISPONIVEIS
          // and ensure all parsed IDs are valid.
          const validParsed = parsed.filter(id => COLUNAS_DISPONIVEIS.some(c => c.id === id));
          // If all saved columns are valid, use them. Otherwise, default.
          if (validParsed.length === parsed.length && validParsed.length > 0) {
            return validParsed;
          }
        } catch (error) {
          console.error("Failed to parse 'colunas_fornecedores' from localStorage:", error);
          // Fallback to default if parsing fails
        }
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });
  
  const [selectedItems, setSelectedItems] = useState([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

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

  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(filteredFornecedores.length / itemsPerPage);
  const startIndex = itemsPerPage === -1 ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === -1 ? filteredFornecedores.length : startIndex + itemsPerPage;
  const paginatedFornecedores = filteredFornecedores.slice(startIndex, endIndex);

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(value === 'all' ? -1 : parseInt(value));
    setCurrentPage(1); // Reset to first page when items per page changes
  };

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      // Salvar no localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('colunas_fornecedores', JSON.stringify(novasColunas));
      }
      
      return novasColunas;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === paginatedFornecedores.length && paginatedFornecedores.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedFornecedores.map(f => f.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} cadastro(s) selecionado(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
      setIsDeletingBulk(true);
      setDeleteProgress({ current: 0, total: selectedItems.length });

      let deleted = 0;
      for (const id of selectedItems) {
        try {
          await onDelete(id, true); // Assuming onDelete can handle an optional `isBulk` flag
          deleted++;
          setDeleteProgress({ current: deleted, total: selectedItems.length });
        } catch (error) {
          console.error('Erro ao excluir:', error);
          // Optionally, handle individual item deletion failure, e.g., show a toast.
        }
      }

      // Give a small delay for UX before closing the dialog
      setTimeout(() => {
        setIsDeletingBulk(false);
        setSelectedItems([]);
        setShowBulkActions(false);
      }, 500);
    }
  };

  const handleBulkPrint = () => {
    selectedItems.forEach(id => {
      const fornecedor = fornecedores.find(f => f.id === id);
      if (fornecedor) onPrint(fornecedor);
    });
    setShowBulkActions(false);
  };

  const deleteProgressPercentage = deleteProgress.total > 0
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100)
    : 0;

  return (
    <>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <CardTitle className="flex items-center gap-3 text-slate-900 text-sm">
              Fornecedores/Clientes ({filteredFornecedores.length})
              {selectedItems.length > 0 && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-300 text-xs">
                  {selectedItems.length} selecionados
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-3 w-full md:w-auto">
              {selectedItems.length > 0 && (
                <DropdownMenu open={showBulkActions} onOpenChange={setShowBulkActions}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2 border-blue-300 text-blue-700 h-8 text-xs">
                      <CheckSquare className="w-4 h-4" />
                      Ações em Massa
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">Ações para {selectedItems.length} itens</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem onClick={handleBulkPrint} className="text-xs">
                      <Printer className="w-4 h-4 mr-2" />
                      Imprimir Todos
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem onClick={handleBulkDelete} className="text-red-600 text-xs">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Excluir Todos
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 border-slate-300 h-8 text-xs"
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="Configurar Colunas" className="border-slate-300 h-8 w-8">
                    <Settings className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
                  <DropdownMenuLabel className="text-xs">Colunas Visíveis</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COLUNAS_DISPONIVEIS.map((coluna) => (
                    <DropdownMenuCheckboxItem
                      key={coluna.id}
                      checked={colunasVisiveis.includes(coluna.id)}
                      onCheckedChange={() => toggleColuna(coluna.id)}
                      className="text-xs"
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
                  <TableHead className="w-12 text-xs">
                    <Checkbox
                      checked={selectedItems.length === paginatedFornecedores.length && paginatedFornecedores.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  {colunasVisiveis.includes('numero') && <TableHead className="font-semibold text-slate-700 text-xs">Nº</TableHead>}
                  {colunasVisiveis.includes('nome') && <TableHead className="font-semibold text-slate-700 text-xs">Nome</TableHead>}
                  {colunasVisiveis.includes('tipo') && <TableHead className="font-semibold text-slate-700 text-xs">Tipo</TableHead>}
                  {colunasVisiveis.includes('documento') && <TableHead className="font-semibold text-slate-700 text-xs">CPF/CNPJ</TableHead>}
                  {colunasVisiveis.includes('telefone') && <TableHead className="font-semibold text-slate-700 text-xs">Telefone</TableHead>}
                  {colunasVisiveis.includes('email') && <TableHead className="font-semibold text-slate-700 text-xs">E-mail</TableHead>}
                  {colunasVisiveis.includes('cidade') && <TableHead className="font-semibold text-slate-700 text-xs">Cidade</TableHead>}
                  {colunasVisiveis.includes('estado') && <TableHead className="font-semibold text-slate-700 text-xs">Estado</TableHead>}
                  {colunasVisiveis.includes('observacoes') && <TableHead className="font-semibold text-slate-700 text-xs">Observações</TableHead>}
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
                      </TableRow>
                    ))
                  ) : paginatedFornecedores.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasVisiveis.length + 1} className="text-center py-12">
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                          <Users className="w-12 h-12" />
                          <p className="text-sm font-medium">Nenhum cadastro encontrado</p>
                          <p className="text-xs">
                            {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando um novo fornecedor/cliente'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedFornecedores.map((fornecedor) => (
                      <ContextMenu key={fornecedor.id}>
                        <ContextMenuTrigger asChild>
                          <motion.tr
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer text-xs"
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
                                <Badge className={`text-xs ${fornecedor.tipo_pessoa === 'Física' ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-purple-100 text-purple-800 border-purple-300'}`}>
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
                          </motion.tr>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => onEdit(fornecedor)} className="text-xs">
                            <Edit className="w-4 h-4 mr-2 text-blue-600" />
                            Editar
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => onPrint(fornecedor)} className="text-xs">
                            <Printer className="w-4 h-4 mr-2 text-green-600" />
                            Imprimir Ficha
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => onDelete(fornecedor.id)} className="text-xs">
                            <Trash2 className="w-4 h-4 mr-2 text-red-600" />
                            Excluir
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>

          {!isLoading && paginatedFornecedores.length > 0 && (
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 border-t border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span>Mostrar</span>
                <Select value={itemsPerPage === -1 ? 'all' : itemsPerPage.toString()} onValueChange={handleItemsPerPageChange}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20" className="text-xs">20</SelectItem>
                    <SelectItem value="50" className="text-xs">50</SelectItem>
                    <SelectItem value="100" className="text-xs">100</SelectItem>
                    <SelectItem value="all" className="text-xs">Todos</SelectItem>
                  </SelectContent>
                </Select>
                <span>por página</span>
              </div>

              {itemsPerPage !== -1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="h-8 w-8">
                    <ChevronsLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="h-8 w-8">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  
                  <div className="flex items-center gap-2 px-3 text-xs">
                    <span className="text-slate-700 font-medium">
                      Pág {currentPage} de {totalPages}
                    </span>
                    <span className="text-slate-500">
                      ({startIndex + 1}-{Math.min(endIndex, filteredFornecedores.length)} de {filteredFornecedores.length})
                    </span>
                  </div>

                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="h-8 w-8">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="h-8 w-8">
                    <ChevronsRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de Progresso de Exclusão */}
      <Dialog open={isDeletingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-red-600" />
              Excluindo Cadastros
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto excluímos os cadastros selecionados...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {deleteProgress.current} de {deleteProgress.total}
                </span>
              </div>
              <Progress value={deleteProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-red-600">
                {deleteProgressPercentage}%
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
