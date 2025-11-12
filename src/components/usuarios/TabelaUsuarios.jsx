import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Search, Users, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export default function TabelaUsuarios({ usuarios, onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredUsuarios = usuarios.filter(usuario => {
    const searchLower = searchTerm.toLowerCase();
    return (
      usuario.full_name?.toLowerCase().includes(searchLower) ||
      usuario.email?.toLowerCase().includes(searchLower) ||
      usuario.cpf?.includes(searchTerm) ||
      usuario.cargo?.toLowerCase().includes(searchLower)
    );
  });

  const contarPermissoes = (permissoes) => {
    if (!permissoes) return 0;
    let total = 0;
    Object.values(permissoes).forEach(modulo => {
      if (typeof modulo === 'object') {
        total += Object.values(modulo).filter(v => v === true).length;
      }
    });
    return total;
  };

  return (
    <Card className="shadow-xl border-slate-200 bg-white">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            Lista de Usuários
            <Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-700 border-blue-300">
              {filteredUsuarios.length} {filteredUsuarios.length === 1 ? 'usuário' : 'usuários'}
            </Badge>
          </CardTitle>
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Buscar por nome, e-mail, CPF..."
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
                <TableHead className="font-semibold text-slate-700">Nome</TableHead>
                <TableHead className="font-semibold text-slate-700">E-mail</TableHead>
                <TableHead className="font-semibold text-slate-700">CPF</TableHead>
                <TableHead className="font-semibold text-slate-700">Cargo</TableHead>
                <TableHead className="font-semibold text-slate-700">Telefone</TableHead>
                <TableHead className="font-semibold text-slate-700">Perfil</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Permissões</TableHead>
                <TableHead className="font-semibold text-slate-700">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="wait">
                {isLoading ? (
                  Array(3).fill(0).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 bg-slate-200 rounded w-32"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-40"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-28"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-28"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-16"></div></TableCell>
                      <TableCell><div className="h-4 bg-slate-200 rounded w-16"></div></TableCell>
                    </TableRow>
                  ))
                ) : filteredUsuarios.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Users className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhum usuário encontrado</p>
                        <p className="text-sm">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando um novo usuário'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsuarios.map((usuario) => (
                    <ContextMenu key={usuario.id}>
                      <ContextMenuTrigger asChild>
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <TableCell className="font-semibold text-slate-900">
                            {usuario.full_name}
                          </TableCell>
                          <TableCell className="text-slate-700 text-sm">
                            {usuario.email}
                          </TableCell>
                          <TableCell className="font-mono text-slate-700 text-sm">
                            {usuario.cpf || '-'}
                          </TableCell>
                          <TableCell className="text-slate-700 text-sm">
                            {usuario.cargo || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-slate-700 text-sm">
                            {usuario.telefone || '-'}
                          </TableCell>
                          <TableCell>
                            <Badge className={usuario.role === 'admin' ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-blue-100 text-blue-800 border-blue-300'}>
                              <Shield className="w-3 h-3 mr-1" />
                              {usuario.role === 'admin' ? 'Admin' : 'Usuário'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="bg-slate-50">
                              {contarPermissoes(usuario.permissoes)} ativas
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={usuario.ativo !== false ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'}>
                              {usuario.ativo !== false ? 'Ativo' : 'Inativo'}
                            </Badge>
                          </TableCell>
                        </motion.tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => onEdit(usuario)}>
                          <Edit className="w-4 h-4 mr-2 text-blue-600" />
                          Editar
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onDelete(usuario.id)}>
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
      </CardContent>
    </Card>
  );
}