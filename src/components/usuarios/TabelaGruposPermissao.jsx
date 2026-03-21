import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Search, Shield, Smartphone, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function TabelaGruposPermissao({ grupos = [], assignments = [], onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const assignmentCount = useMemo(() => {
    return assignments.reduce((acc, item) => {
      acc[item.grupo_permissao_id] = (acc[item.grupo_permissao_id] || 0) + 1;
      return acc;
    }, {});
  }, [assignments]);

  const filtered = grupos.filter((grupo) => {
    const text = searchTerm.toLowerCase();
    return grupo.nome?.toLowerCase().includes(text) || grupo.codigo?.toLowerCase().includes(text);
  });

  const countVisiblePages = (grupo) => {
    return Object.values(grupo.permissoes || {}).filter((item) => item?.visualizar).length;
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900">Grupos de Permissão ({grupos.length})</CardTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar grupo..." className="pl-9 h-8 w-48 text-xs uppercase" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b">
                <TableHead className="text-xs border-r border-slate-200">Grupo</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Código</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Tipo</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Telas</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Mobile</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-center">Usuários</TableHead>
                <TableHead className="text-xs text-center w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">Nenhum grupo encontrado</TableCell>
                </TableRow>
              ) : filtered.map((grupo) => (
                <TableRow key={grupo.id} className="hover:bg-slate-50 border-b">
                  <TableCell className="text-xs font-semibold border-r border-slate-200 uppercase">{grupo.nome}</TableCell>
                  <TableCell className="text-xs border-r border-slate-200 uppercase">{grupo.codigo}</TableCell>
                  <TableCell className="border-r border-slate-200">
                    {grupo.is_admin ? (
                      <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs"><Shield className="w-3 h-3 mr-1" />ADMIN</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">RESTRITO</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center border-r border-slate-200">
                    <Badge variant="outline" className="text-xs font-mono">{grupo.is_admin ? "TOTAL" : countVisiblePages(grupo)}</Badge>
                  </TableCell>
                  <TableCell className="text-center border-r border-slate-200">
                    <div className="inline-flex items-center gap-1 text-xs text-slate-600"><Smartphone className="w-3.5 h-3.5" />{grupo.is_admin ? 4 : (grupo.mobile?.atalhos?.length || 0)}</div>
                  </TableCell>
                  <TableCell className="text-center border-r border-slate-200">
                    <div className="inline-flex items-center gap-1 text-xs text-slate-600"><Users className="w-3.5 h-3.5" />{assignmentCount[grupo.id] || 0}</div>
                  </TableCell>
                  <TableCell className="text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(grupo)} className="text-xs">Editar Grupo</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onDelete(grupo)} className="text-xs text-red-600">Excluir Grupo</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}