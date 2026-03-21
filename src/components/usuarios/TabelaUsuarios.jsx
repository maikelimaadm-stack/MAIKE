import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Search, User, Shield, Smartphone } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getAccessSummary } from "@/lib/permissions";

export default function TabelaUsuarios({ usuarios = [], assignments = [], grupos = [], currentUser, onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const groupMap = useMemo(() => {
    return grupos.reduce((acc, grupo) => {
      acc[grupo.id] = grupo;
      return acc;
    }, {});
  }, [grupos]);

  const assignmentMap = useMemo(() => {
    return assignments.reduce((acc, item) => {
      acc[item.user_email] = item;
      return acc;
    }, {});
  }, [assignments]);

  const filteredUsuarios = usuarios.filter((usuario) => {
    const text = searchTerm.toLowerCase();
    return usuario.full_name?.toLowerCase().includes(text) || usuario.email?.toLowerCase().includes(text);
  });

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900">Usuários ({usuarios.length})</CardTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar usuário..." className="pl-9 h-8 w-48 text-xs uppercase" />
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
                <TableHead className="text-xs border-r border-slate-200">Grupo</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Resumo</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Mobile</TableHead>
                <TableHead className="text-xs text-center w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                </TableRow>
              ) : filteredUsuarios.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">Nenhum usuário encontrado</TableCell>
                </TableRow>
              ) : filteredUsuarios.map((usuario) => {
                const assignment = assignmentMap[usuario.email];
                const grupo = assignment ? groupMap[assignment.grupo_permissao_id] : null;
                const resumo = getAccessSummary(grupo);
                const isCurrentUser = currentUser?.email === usuario.email;
                const mobileCount = grupo?.is_admin ? 4 : (grupo?.mobile?.atalhos?.length || 0);

                return (
                  <TableRow key={usuario.id} className="hover:bg-slate-50 border-b">
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
                      {grupo ? (
                        <Badge className={`text-xs uppercase ${grupo.is_admin ? "bg-violet-100 text-violet-800 border-violet-300" : "bg-emerald-100 text-emerald-800 border-emerald-300"}`}>
                          {grupo.nome}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs uppercase">Sem Grupo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="border-r border-slate-200">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase">{resumo.role}</span>
                        <span className="text-[10px] text-slate-500 uppercase">{resumo.details}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center border-r border-slate-200">
                      <div className="inline-flex items-center gap-1 text-xs text-slate-600"><Smartphone className="w-3.5 h-3.5" />{mobileCount}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(usuario)} className="text-xs">Editar Grupo</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onDelete(usuario.email)} className="text-xs text-red-600" disabled={isCurrentUser}>Remover Vínculo</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}