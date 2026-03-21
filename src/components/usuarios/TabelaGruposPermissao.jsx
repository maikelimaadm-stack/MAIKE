import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MoreVertical, Search, Shield, Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getAccessSummary } from "@/lib/permissions";

export default function TabelaGruposPermissao({ grupos = [], usuarios = [], onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredGroups = grupos.filter((grupo) => {
    const term = searchTerm.toLowerCase();
    return grupo.nome?.toLowerCase().includes(term) || grupo.codigo?.toLowerCase().includes(term);
  });

  const getUsersCount = (codigo) => usuarios.filter((user) => user.grupo_permissao_codigo === codigo).length;

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900">Grupos de Permissão ({grupos.length})</CardTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input placeholder="Buscar grupo..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 border-b">
              <TableHead className="text-xs">Grupo</TableHead>
              <TableHead className="text-xs">Código</TableHead>
              <TableHead className="text-xs">Nível</TableHead>
              <TableHead className="text-xs text-center">Usuários</TableHead>
              <TableHead className="text-xs text-center">Permissões</TableHead>
              <TableHead className="text-xs text-center">Mobile</TableHead>
              <TableHead className="text-xs text-center w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                </TableRow>
              ) : filteredGroups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">Nenhum grupo cadastrado</TableCell>
                </TableRow>
              ) : (
                filteredGroups.map((grupo) => {
                  const summary = getAccessSummary(grupo);
                  const linkedUsers = getUsersCount(grupo.codigo);

                  return (
                    <motion.tr key={grupo.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hover:bg-slate-50 border-b">
                      <TableCell className="text-xs font-semibold uppercase">{grupo.nome}</TableCell>
                      <TableCell className="text-xs font-mono">{grupo.codigo}</TableCell>
                      <TableCell>
                        {grupo.is_admin ? (
                          <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs">
                            <Shield className="w-3 h-3 mr-1" />
                            Admin
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Grupo Restrito</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs font-mono">{linkedUsers}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant="outline" className="text-xs font-mono">{summary.principal}</Badge>
                          <span className="text-[10px] text-slate-500">{summary.secundario}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1 text-xs text-slate-600">
                          <Smartphone className="w-3.5 h-3.5" />
                          {grupo.is_admin ? 4 : (grupo.mobile_atalhos?.length || 0)}
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
                            <DropdownMenuItem onClick={() => onEdit(grupo)} className="text-xs">Editar Grupo</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onDelete(grupo)} className="text-xs text-red-600">Excluir Grupo</DropdownMenuItem>
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