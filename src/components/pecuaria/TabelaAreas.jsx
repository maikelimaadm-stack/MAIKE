import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function TabelaAreas({ areas = [], gado = [], onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredAreas = areas.filter(area => {
    const searchLower = searchTerm.toLowerCase();
    return (
      area.nome?.toLowerCase().includes(searchLower) ||
      area.tipo_pastagem?.toLowerCase().includes(searchLower) ||
      area.numero_area?.includes(searchLower)
    );
  });

  const getStatusColor = (status) => {
    const colors = {
      'Disponível': 'bg-green-100 text-green-800 border-green-300',
      'Médio': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'Alto': 'bg-orange-100 text-orange-800 border-orange-300',
      'Sobrepastoreado': 'bg-red-100 text-red-800 border-red-300'
    };
    return colors[status] || 'bg-slate-100 text-slate-700 border-slate-300';
  };

  const getAnimaisNaArea = (areaId) => {
    return gado.filter(g => g.area_atual_id === areaId).length;
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900">
            Áreas ({areas.length})
          </CardTitle>
          <div className="flex gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b">
                <TableHead className="text-xs border-r border-slate-200">Nº</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Nome</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Tamanho (ha)</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Capacidade</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Atual</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Ocupação</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Status</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Tipo Pastagem</TableHead>
                <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                  </TableRow>
                ) : filteredAreas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-xs">Nenhuma área</TableCell>
                  </TableRow>
                ) : (
                  filteredAreas.map((area) => {
                    const animaisAtual = getAnimaisNaArea(area.id);
                    const percentual = area.capacidade_maxima > 0 ? (animaisAtual / area.capacidade_maxima) * 100 : 0;

                    return (
                      <motion.tr 
                        key={area.id}
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        className="hover:bg-slate-50 transition-colors border-b"
                      >
                        <TableCell className="text-xs border-r border-slate-200">{area.numero_area || '-'}</TableCell>
                        <TableCell className="text-xs font-semibold border-r border-slate-200">{area.nome}</TableCell>
                        <TableCell className="text-xs border-r border-slate-200">{area.tamanho_hectares} ha</TableCell>
                        <TableCell className="text-xs border-r border-slate-200">{area.capacidade_maxima || 0} UA</TableCell>
                        <TableCell className="text-xs font-semibold border-r border-slate-200">{animaisAtual}</TableCell>
                        <TableCell className="text-xs border-r border-slate-200">{percentual.toFixed(0)}%</TableCell>
                        <TableCell className="border-r border-slate-200">
                          <Badge variant="outline" className={`${getStatusColor(area.status_ocupacao)} text-xs`}>
                            {area.status_ocupacao}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs border-r border-slate-200">{area.tipo_pastagem || '-'}</TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => onEdit(area)} className="text-xs">
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onDelete(area.id)} className="text-xs text-red-600">
                                Remover
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