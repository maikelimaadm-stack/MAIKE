import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Search, Building2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function TabelaEmpresas({ empresas, onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

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

  return (
    <Card className="shadow-xl border-slate-200 bg-white">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            Lista de Empresas
            <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
              {filteredEmpresas.length} {filteredEmpresas.length === 1 ? 'empresa' : 'empresas'}
            </Badge>
          </CardTitle>
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Buscar por nome, apelido, documento..."
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
                <TableHead className="font-semibold text-slate-700">Logotipo</TableHead>
                <TableHead className="font-semibold text-slate-700">Apelido</TableHead>
                <TableHead className="font-semibold text-slate-700">Nome/Razão Social</TableHead>
                <TableHead className="font-semibold text-slate-700">Tipo</TableHead>
                <TableHead className="font-semibold text-slate-700">CPF/CNPJ</TableHead>
                <TableHead className="font-semibold text-slate-700">Telefone</TableHead>
                <TableHead className="font-semibold text-slate-700">Cidade</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
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
                      <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                    </TableRow>
                  ))
                ) : filteredEmpresas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Building2 className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhuma empresa encontrada</p>
                        <p className="text-sm">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando uma nova empresa'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmpresas.map((empresa) => (
                    <motion.tr
                      key={empresa.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
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
                        <Badge className={empresa.tipo_pessoa === 'Física' ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-purple-100 text-purple-800 border-purple-300'}>
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
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(empresa)}
                            className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            title="Editar"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(empresa.id)}
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