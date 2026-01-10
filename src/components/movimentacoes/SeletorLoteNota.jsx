import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const formatarMoedaBR = (valor) => {
  if (valor === null || valor === undefined || isNaN(valor)) return "R$ 0,00";
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarNumero = (num, decimais = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais });
};

export default function SeletorLoteNota({ 
  open, 
  onOpenChange, 
  lotes = [], 
  produtoNome,
  localNome,
  onSelecionar 
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Selecionar Lote/Nota de Origem
          </DialogTitle>
          <div className="text-xs text-slate-500">
            Produto: <strong>{produtoNome}</strong> | Local: <strong>{localNome}</strong>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {lotes.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <p className="text-sm">Nenhum lote disponível para este produto neste local.</p>
              <p className="text-xs mt-2">Verifique se há entradas registradas.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black">Documento</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Série</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Fornecedor</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Saldo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Unit.</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black w-24">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lotes.map((lote) => (
                  <TableRow key={lote.id} className="hover:bg-gray-50">
                    <TableCell className="text-xs py-1 border border-gray-300">
                      {lote.numero_documento || 'S/Número'}
                    </TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">
                      {lote.serie_documento || '-'}
                    </TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">
                      {lote.data_documento 
                        ? new Date(lote.data_documento).toLocaleDateString('pt-BR') 
                        : '-'}
                    </TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">
                      {lote.fornecedor_nome || '-'}
                    </TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">
                      <Badge variant={lote.quantidade_disponivel > 0 ? "default" : "secondary"}>
                        {formatarNumero(lote.quantidade_disponivel)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">
                      {formatarMoedaBR(lote.custo_unitario)}
                    </TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">
                      <Button 
                        size="sm" 
                        className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => onSelecionar(lote)}
                        disabled={lote.quantidade_disponivel <= 0}
                      >
                        Selecionar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}