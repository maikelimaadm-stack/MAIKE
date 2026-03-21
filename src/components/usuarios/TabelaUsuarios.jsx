import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MoreVertical, Search, Shield, User, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getAccessSummary } from "@/lib/permissions";

export default function TabelaUsuarios({ usuarios = [], grupos = [], currentUser, onEdit, onRemoveGroup, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredUsuarios = usuarios.filter((usuario) => {
    const term = searchTerm.toLowerCase();
    return usuario.full_name?.toLowerCase().includes(term) || usuario.email?.toLowerCase().includes(term);
  });

  const getGrupo = (codigo) => grupos.find((grupo) => grupo.codigo === codigo);

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900">Usuários ({usuarios.length})</CardTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input placeholder="Buscar usuário..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 border-b">
              <TableHead className="text-xs">Usuário</TableHead>
              <TableHead className="text-xs">Email</TableHead>
              <TableHead className="text-xs">Perfil Base44</TableHead>
              <TableHead className="text-xs">Grupo</TableHead>
              <TableHead className="text-xs text-center">Resumo</TableHead>
              <TableHead className="text-xs text-center w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                </TableRow>
              ) : filteredUsuarios.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-slate-400 text-xs">Nenhum usuário</TableCell>
                </TableRow>
              ) : (
                filteredUsuarios.map((usuario) => {
                  const grupo = getGrupo(usuario.grupo_permissao_codigo);
                  const isCurrentUser = currentUser?.email === usuario.email;
                  const summary = getAccessSummary(grupo);

                  return (
                    <motion.tr key={usuario.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hover:bg-slate-50 border-b">
                      <TableCell className="text-xs font-semibold">
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          {usuario.full_name}
                          {isCurrentUser && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-300">Você</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{usuario.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${usuario.role === "admin" ? "bg-purple-100 text-purple-800 border-purple-300" : "bg-slate-100 text-slate-700 border-slate-300"}`}>
                          {usuario.role === "admin" ? "Admin Base44" : "Usuário"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {grupo ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs uppercase">{grupo.nome}</Badge>
                            {grupo.is_admin && <Shield className="w-3.5 h-3.5 text-violet-600" />}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-orange-100 text-orange-800 border-orange-300">Sem grupo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant="outline" className="text-xs font-mono">{summary.principal}</Badge>
                          <span className="text-[10px] text-slate-500">{summary.secundario}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => onEdit(usuario)} className="text-xs">Editar Grupo</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onRemoveGroup(usuario)} className="text-xs text-red-600" disabled={isCurrentUser}>
                              Remover Grupo
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  );
                })
              )}
            </AnimatePresence>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}