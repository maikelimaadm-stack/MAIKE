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
import { MoreVertical, Pencil, Trash2, Search, MapPin } from "lucide-react";

export default function TabelaPontosGeo({ pontos, onEdit, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredPontos = pontos.filter(ponto =>
    ponto.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ponto.tipo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ponto.numero_ponto?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600" />
            Pontos Cadastrados ({pontos.length})
          </CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar pontos..."
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
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Coordenadas</th>
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Observações</th>
                <th className="text-right py-2 px-2 font-semibold text-slate-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredPontos.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-500 text-sm">
                    Nenhum ponto encontrado
                  </td>
                </tr>
              ) : (
                filteredPontos.map((ponto) => (
                  <tr key={ponto.id} className="border-b hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-2 text-xs">{ponto.numero_ponto}</td>
                    <td className="py-2.5 px-2 text-xs font-medium">{ponto.nome}</td>
                    <td className="py-2.5 px-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {ponto.tipo}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2 text-xs text-slate-600">
                      {ponto.coordenadas?.lat && ponto.coordenadas?.lng 
                        ? `${ponto.coordenadas.lat.toFixed(6)}, ${ponto.coordenadas.lng.toFixed(6)}`
                        : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-slate-600">
                      {ponto.observacoes ? ponto.observacoes.substring(0, 30) + '...' : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(ponto)} className="text-xs">
                            <Pencil className="w-3 h-3 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDelete(ponto)} className="text-xs text-red-600">
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