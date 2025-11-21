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
import { MoreVertical, Pencil, Trash2, Search, Map } from "lucide-react";

export default function TabelaAreasGeo({ areas, onEdit, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredAreas = areas.filter(area =>
    area.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    area.tipo_pastagem?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    area.numero_area?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Map className="w-4 h-4 text-emerald-600" />
            Áreas Cadastradas ({areas.length})
          </CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar áreas..."
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
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Tamanho (ha)</th>
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Capacidade (UA)</th>
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Ocupação</th>
                <th className="text-left py-2 px-2 font-semibold text-slate-700">Status</th>
                <th className="text-right py-2 px-2 font-semibold text-slate-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredAreas.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-slate-500 text-sm">
                    Nenhuma área encontrada
                  </td>
                </tr>
              ) : (
                filteredAreas.map((area) => (
                  <tr key={area.id} className="border-b hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-2 text-xs">{area.numero_area}</td>
                    <td className="py-2.5 px-2 text-xs font-medium">{area.nome}</td>
                    <td className="py-2.5 px-2 text-xs">{area.tipo_pastagem || '-'}</td>
                    <td className="py-2.5 px-2 text-xs">{area.tamanho_hectares?.toFixed(2) || '-'}</td>
                    <td className="py-2.5 px-2 text-xs">{area.capacidade_maxima || '-'}</td>
                    <td className="py-2.5 px-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {area.quantidade_atual || 0} / {area.capacidade_maxima || 0}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2 text-xs">
                      <Badge className={
                        area.status_ocupacao === 'Disponível' ? 'bg-emerald-100 text-emerald-800' :
                        area.status_ocupacao === 'Médio' ? 'bg-yellow-100 text-yellow-800' :
                        area.status_ocupacao === 'Alto' ? 'bg-orange-100 text-orange-800' :
                        'bg-red-100 text-red-800'
                      }>
                        {area.status_ocupacao || 'Disponível'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(area)} className="text-xs">
                            <Pencil className="w-3 h-3 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDelete(area)} className="text-xs text-red-600">
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