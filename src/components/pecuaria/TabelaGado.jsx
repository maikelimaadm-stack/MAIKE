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

export default function TabelaGado({ gado = [], areas = [], onEdit, onDelete, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredGado = gado.filter(animal => {
    const searchLower = searchTerm.toLowerCase();
    return (
      animal.nome?.toLowerCase().includes(searchLower) ||
      animal.categoria?.toLowerCase().includes(searchLower) ||
      animal.lote?.toLowerCase().includes(searchLower) ||
      animal.numero_animal?.includes(searchLower)
    );
  });

  const getAreaNome = (areaId) => {
    const area = areas.find(a => a.id === areaId);
    return area?.nome || '-';
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900">
            Animais ({gado.length})
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
                <TableHead className="text-xs border-r border-slate-200">Categoria</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Sexo</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Idade</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Peso</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Lote</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Área Atual</TableHead>
                <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                  </TableRow>
                ) : filteredGado.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-xs">Nenhum animal</TableCell>
                  </TableRow>
                ) : (
                  filteredGado.map((animal) => (
                    <motion.tr 
                      key={animal.id}
                      initial={{ opacity: 0 }} 
                      animate={{ opacity: 1 }} 
                      exit={{ opacity: 0 }} 
                      className="hover:bg-slate-50 transition-colors border-b"
                    >
                      <TableCell className="text-xs border-r border-slate-200">{animal.numero_animal || '-'}</TableCell>
                      <TableCell className="text-xs font-semibold border-r border-slate-200">{animal.nome}</TableCell>
                      <TableCell className="border-r border-slate-200">
                        <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
                          {animal.categoria}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs border-r border-slate-200">{animal.sexo}</TableCell>
                      <TableCell className="text-xs border-r border-slate-200">{animal.idade_meses ? `${animal.idade_meses}m` : '-'}</TableCell>
                      <TableCell className="text-xs border-r border-slate-200">{animal.peso_kg ? `${animal.peso_kg}kg` : '-'}</TableCell>
                      <TableCell className="text-xs border-r border-slate-200">{animal.lote || '-'}</TableCell>
                      <TableCell className="text-xs border-r border-slate-200">
                        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 text-xs">
                          {getAreaNome(animal.area_atual_id)}
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
                            <DropdownMenuItem onClick={() => onEdit(animal)} className="text-xs">
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onDelete(animal.id)} className="text-xs text-red-600">
                              Remover
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  ))
                )}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}