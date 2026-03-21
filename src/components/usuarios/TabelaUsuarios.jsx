import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Search, Shield, User, Lock, Smartphone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function TabelaUsuarios({ usuarios = [], permissoes = [], currentUser, onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const getPermissaoUsuario = (userEmail) => permissoes.find((item) => item.user_email === userEmail);

  const filteredUsuarios = usuarios.filter((usuario) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      usuario.full_name?.toLowerCase().includes(searchLower) ||
      usuario.email?.toLowerCase().includes(searchLower)
    );
  });

  const getResumoAcesso = (userEmail) => {
    const permissao = getPermissaoUsuario(userEmail);
    if (!permissao) {
      return { modulos: "Todos", telas: "Todas", mobile: "Padrão" };
    }
    if (permissao.is_admin) {
      return { modulos: "Todos", telas: "Todas", mobile: "Livre" };
    }
    const telasVisiveis = (permissao.permissoes_telas || []).filter((item) => item.visualizar !== false).length;
    return {
      modulos: permissao.modulos_permitidos?.length || 0,
      telas: telasVisiveis,
      mobile: permissao.mobile_menu_ids?.length || 0,
    };
  };

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
                <TableHead className="text-xs border-r border-slate-200">Nível de Acesso</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Módulos</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Telas</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Mobile</TableHead>
                <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                  </TableRow>
                ) : filteredUsuarios.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-xs">Nenhum usuário</TableCell>
                  </TableRow>
                ) : (
                  filteredUsuarios.map((usuario) => {
                    const permissao = getPermissaoUsuario(usuario.email);
                    const isCurrentUser = currentUser?.email === usuario.email;
                    const resumo = getResumoAcesso(usuario.email);

                    return (
                      <motion.tr
                        key={usuario.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="hover:bg-slate-50 transition-colors border-b"
                      >
                        <TableCell className="text-xs font-semibold border-r border-slate-200">
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            {usuario.full_name}
                            {isCurrentUser && (
                              <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-300">
                                Você
                              </Badge>
                            )}
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
                            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                              Acesso total padrão
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <Badge variant="outline" className="text-xs font-mono">{resumo.modulos}</Badge>
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <Badge variant="outline" className="text-xs font-mono">{resumo.telas}</Badge>
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <Badge variant="outline" className="text-xs font-mono inline-flex items-center gap-1">
                            <Smartphone className="w-3 h-3" />
                            {resumo.mobile}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => onEdit(usuario)} className="text-xs">
                                Editar Permissões
                              </DropdownMenuItem>
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