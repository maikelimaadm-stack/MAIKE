
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Edit,
  Trash2,
  Search,
  Building2,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export default function TabelaEmpresas({ empresas, onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const filteredEmpresas = empresas.filter(empresa => {
    const searchLower = searchTerm.toLowerCase();
    return (
      empresa.nome?.toLowerCase().includes(searchLower) ||
      empresa.apelido?.toLowerCase().includes(searchLower) ||
      empresa.cidade?.toLowerCase().includes(searchLower) ||
      empresa.cpf?.includes(searchLower) ||
      empresa.cnpj?.includes(searchLower) ||
      empresa.email?.toLowerCase().includes(searchLower)
    );
  });

  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(filteredEmpresas.length / itemsPerPage);
  const startIndex = itemsPerPage === -1 ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === -1 ? filteredEmpresas.length : startIndex + itemsPerPage;
  const paginatedEmpresas = filteredEmpresas.slice(startIndex, endIndex);

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(value === 'all' ? -1 : parseInt(value));
    setCurrentPage(1);
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900 text-sm">
            Empresas ({filteredEmpresas.length})
          </CardTitle>
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 border-slate-300 h-8 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="font-semibold text-slate-700 text-xs">Logotipo</TableHead>
                <TableHead className="font-semibold text-slate-700 text-xs">Apelido</TableHead>
                <TableHead className="font-semibold text-slate-700 text-xs">Nome/Razão Social</TableHead>
                <TableHead className="font-semibold text-slate-700 text-xs">Tipo</TableHead>
                <TableHead className="font-semibold text-slate-700 text-xs">CPF/CNPJ</TableHead>
                <TableHead className="font-semibold text-slate-700 text-xs">Telefone</TableHead>
                <TableHead className="font-semibold text-slate-700 text-xs">Cidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="wait">
                {isLoading ? (
                  Array(3).fill(0).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-10 w-10 bg-slate-200 rounded"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-32"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-28"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                    </TableRow>
                  ))
                ) : paginatedEmpresas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Building2 className="w-12 h-12" />
                        <p className="text-sm font-medium">Nenhuma empresa encontrada</p>
                        <p className="text-xs">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando uma nova empresa'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedEmpresas.map((empresa) => (
                    <ContextMenu key={empresa.id}>
                      <ContextMenuTrigger asChild>
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer text-xs"
                        >
                          <TableCell>
                            {empresa.logotipo_url ? (
                              <img 
                                src={empresa.logotipo_url} 
                                alt={empresa.apelido}
                                className="h-10 w-10 object-contain border rounded"
                              />
                            ) : (
                              <div className="h-10 w-10 bg-slate-100 rounded flex items-center justify-center">
                                <Building2 className="w-5 h-5 text-slate-400" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-semibold text-slate-900">
                            {empresa.apelido}
                          </TableCell>
                          <TableCell className="text-slate-700">
                            {empresa.nome}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-xs ${empresa.tipo_pessoa === 'Física' ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-purple-100 text-purple-800 border-purple-300'}`}>
                              {empresa.tipo_pessoa}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-slate-700">
                            {empresa.tipo_pessoa === 'Física' ? empresa.cpf || '-' : empresa.cnpj || '-'}
                          </TableCell>
                          <TableCell className="text-slate-700">
                            {empresa.telefone || '-'}
                          </TableCell>
                          <TableCell className="text-slate-700">
                            {empresa.cidade ? `${empresa.cidade} - ${empresa.estado || ''}` : '-'}
                          </TableCell>
                        </motion.tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => onEdit(empresa)} className="text-xs">
                          <Edit className="w-4 h-4 mr-2 text-blue-600" />
                          Editar
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onDelete(empresa.id)} className="text-xs">
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

        {!isLoading && paginatedEmpresas.length > 0 && (
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
                    ({startIndex + 1}-{Math.min(endIndex, filteredEmpresas.length)} de {filteredEmpresas.length})
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
  );
}
