import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Search, Shield, User, Lock, Smartphone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getAccessSummary } from "@/lib/permissions";

export default function TabelaUsuarios({ usuarios = [], permissoes = [], currentUser, onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const getPermissaoUsuario = (userEmail) => permissoes.find((p) => p.user_email === userEmail);

  const filteredUsuarios = usuarios.filter((usuario) => {
    const searchLower = searchTerm.toLowerCase();
    return usuario.full_name?.toLowerCase().includes(searchLower) || usuario.email?.toLowerCase().includes(searchLower);
  });

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900">Usuários ({usuarios.length})</CardTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b">
                <TableHead className="text-xs border-r border-slate-200">Usuário</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Email</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Perfil Base44</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Nível</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Acesso</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Mobile</TableHead>
                <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                  </TableRow>
                ) : filteredUsuarios.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">Nenhum usuário</TableCell>
                  </TableRow>
                ) : (
                  filteredUsuarios.map((usuario) => {
                    const permissao = getPermissaoUsuario(usuario.email);
                    const isCurrentUser = currentUser?.email === usuario.email;
                    const resumo = getAccessSummary(permissao);
                    const mobileCount = permissao?.is_admin ? "4" : (permissao?.mobile_menu_items?.length || 4);

                    return (
                      <motion.tr key={usuario.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hover:bg-slate-50 transition-colors border-b">
                        <TableCell className="text-xs font-semibold border-r border-slate-200">
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            {usuario.full_name}
                            {isCurrentUser && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-300">Você</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs border-r border-slate-200">{usuario.email}</TableCell>
                        <TableCell className="border-r border-slate-200">
                          <Badge variant="outline" className={`text-xs ${usuario.role === "admin" ? "bg-purple-100 text-purple-800 border-purple-300" : "bg-slate-100 text-slate-700 border-slate-300"}`}>
                            {usuario.role === "admin" ? "Admin Base44" : "Usuário"}
                          </Badge>
                        </TableCell>
                        <TableCell className="border-r border-slate-200">
                          {permissao?.is_admin ? (
                            <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs">
                              <Shield className="w-3 h-3 mr-1" />
                              Administrador
                            </Badge>
                          ) : permissao ? (
                            <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                              <Lock className="w-3 h-3 mr-1" />
                              Restrito
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">Livre</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant="outline" className="text-xs font-mono">{resumo.label}</Badge>
                            <span className="text-[10px] text-slate-500">{resumo.count}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <div className="inline-flex items-center gap-1 text-xs text-slate-600">
                            <Smartphone className="w-3.5 h-3.5" />
                            {mobileCount}
                          </div>
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => onEdit(usuario)} className="text-xs">Editar Permissões</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onDelete(usuario.email)} className="text-xs text-red-600" disabled={isCurrentUser}>
                                Remover Permissões
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
        </div>
      </CardContent>
    </Card>
  );
}