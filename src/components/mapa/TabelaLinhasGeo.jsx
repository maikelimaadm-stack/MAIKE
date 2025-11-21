import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, Trash2, Search, Route } from "lucide-react";

export default function TabelaLinhasGeo({ linhas, onEdit, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredLinhas = linhas.filter(linha =>
    linha.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    linha.tipo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    linha.numero_linha?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Route className="w-4 h-4 text-orange-600" />
            Linhas Cadastradas ({linhas.length})
          </CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar linhas..."
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs">
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Código</th>
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Nome</th>
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Tipo</th>
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Comprimento</th>
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Observações</th>
                <th className="text-right py-2 px-2 font-semibold text-slate-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredLinhas.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-500 text-sm">
                    Nenhuma linha encontrada
                  </td>
                </tr>
              ) : (
                filteredLinhas.map((linha) => (
                  <tr key={linha.id} className="border-b hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-2 text-xs">{linha.numero_linha}</td>
                    <td className="py-2.5 px-2 text-xs font-medium">{linha.nome}</td>
                    <td className="py-2.5 px-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {linha.tipo}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2 text-xs">
                      {linha.comprimento_metros 
                        ? `${(linha.comprimento_metros / 1000).toFixed(2)} km`
                        : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-slate-600">
                      {linha.observacoes ? linha.observacoes.substring(0, 30) + '...' : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(linha)} className="text-xs">
                            <Pencil className="w-3 h-3 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDelete(linha)} className="text-xs text-red-600">
                            <Trash2 className="w-3 h-3 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}