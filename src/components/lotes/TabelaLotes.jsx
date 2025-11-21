import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, MoreVertical, Edit, Trash2, MapPin } from "lucide-react";

export default function TabelaLotes({ lotes, areas, onEdit, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");

  const lotesFiltered = lotes.filter(lote =>
    lote.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lote.categoria?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lote.area_atual_nome?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status) => {
    const colors = {
      'Ativo': 'bg-green-100 text-green-800 border-green-300',
      'Vendido': 'bg-blue-100 text-blue-800 border-blue-300',
      'Transferido': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'Baixado': 'bg-red-100 text-red-800 border-red-300'
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-slate-50 border-b py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold">
            Lista de Lotes ({lotesFiltered.length})
          </CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar lote..."
              className="h-8 text-xs pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Código</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Nome</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Qtd Cabeças</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Categoria</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Peso Médio</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Área Atual</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Valor Total</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lotesFiltered.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-8 text-slate-500">
                    Nenhum lote encontrado
                  </td>
                </tr>
              ) : (
                lotesFiltered.map((lote) => (
                  <tr key={lote.id} className="border-b hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 font-mono text-slate-600">
                      #{lote.numero_lote}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900">
                      {lote.nome}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="font-bold">
                        {lote.quantidade_cabecas} 🐄
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {lote.categoria}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {lote.peso_medio_kg ? `${lote.peso_medio_kg} kg` : '-'}
                    </td>
                    <td className="px-3 py-2">
                      {lote.area_atual_nome ? (
                        <Badge variant="outline" className="gap-1">
                          <MapPin className="w-3 h-3" />
                          {lote.area_atual_nome}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">Sem área</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={getStatusBadge(lote.status)}>
                        {lote.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {lote.valor_total_compra ? 
                        `R$ ${lote.valor_total_compra.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` 
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(lote)} className="text-xs">
                            <Edit className="w-3 h-3 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onDelete(lote.id)}
                            className="text-xs text-red-600"
                          >
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