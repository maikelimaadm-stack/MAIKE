import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2 } from "lucide-react";

export default function TabelaCochosGeo({ cochos, onEdit, onDelete }) {
  if (cochos.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 bg-white rounded-lg border">
        <p className="text-sm">Nenhum cocho cadastrado</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Nome</TableHead>
            <TableHead className="text-xs">Tipo</TableHead>
            <TableHead className="text-xs">Produto Padrão</TableHead>
            <TableHead className="text-xs">Área Vinculada</TableHead>
            <TableHead className="text-xs">Capacidade</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cochos.map((cocho) => (
            <TableRow key={cocho.id}>
              <TableCell className="font-medium text-xs">{cocho.nome_ponto}</TableCell>
              <TableCell className="text-xs">{cocho.tipo}</TableCell>
              <TableCell className="text-xs">{cocho.produto_padrao || '-'}</TableCell>
              <TableCell className="text-xs">{cocho.area_vinculada_nome || '-'}</TableCell>
              <TableCell className="text-xs">{cocho.capacidade_cocho_kg ? `${cocho.capacidade_cocho_kg} kg` : '-'}</TableCell>
              <TableCell>
                <Badge variant={cocho.status === 'Ativo' ? 'default' : 'secondary'} className="text-xs">
                  {cocho.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onEdit(cocho)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => onDelete(cocho)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}