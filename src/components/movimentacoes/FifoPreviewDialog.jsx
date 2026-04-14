import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const fmt = (v) => {
  if (v == null || isNaN(v)) return '0,00';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtMoeda = (v) => {
  if (v == null || isNaN(v)) return 'R$ 0,00';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
const fmtData = (d) => {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
};

export default function FifoPreviewDialog({ open, onOpenChange, lotes = [], produtoNome, quantidadeSaida = 0 }) {
  // Simula consumo FIFO
  let qtdRestante = quantidadeSaida;
  const consumos = lotes.map(lote => {
    if (qtdRestante <= 0) return { ...lote, consumo: 0 };
    const consumir = Math.min(qtdRestante, lote.quantidade_disponivel || 0);
    qtdRestante -= consumir;
    return { ...lote, consumo: consumir };
  });

  const totalConsumido = consumos.reduce((s, c) => s + c.consumo, 0);
  const custoTotal = consumos.reduce((s, c) => s + c.consumo * (c.custo_unitario || 0), 0);
  const custoMedio = totalConsumido > 0 ? custoTotal / totalConsumido : 0;
  const saldoInsuficiente = qtdRestante > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col p-2">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-sm font-semibold text-slate-900">
            Simulação FIFO — {produtoNome}
          </DialogTitle>
          <div className="text-[11px] text-slate-500">
            Quantidade solicitada: <strong>{fmt(quantidadeSaida)}</strong> | 
            Custo médio FIFO: <strong className="text-emerald-700">{fmtMoeda(custoMedio)}</strong> | 
            Custo total: <strong>{fmtMoeda(custoTotal)}</strong>
            {saldoInsuficiente && (
              <Badge className="ml-2 bg-red-100 text-red-700 border-red-300 text-[10px]">
                SALDO INSUFICIENTE — faltam {fmt(qtdRestante)}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {lotes.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              Nenhum lote disponível para este produto neste local de estoque.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border-b">Ordem</TableHead>
                  <TableHead className="text-xs font-bold py-1 border-b">Documento</TableHead>
                  <TableHead className="text-xs font-bold py-1 border-b">Data</TableHead>
                  <TableHead className="text-xs font-bold py-1 border-b">Fornecedor</TableHead>
                  <TableHead className="text-xs font-bold py-1 border-b text-right">Saldo Disp.</TableHead>
                  <TableHead className="text-xs font-bold py-1 border-b text-right">Custo Unit.</TableHead>
                  <TableHead className="text-xs font-bold py-1 border-b text-right">Consumo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border-b text-right">Custo Consumo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consumos.map((lote, idx) => (
                  <TableRow key={lote.id || idx} className={lote.consumo > 0 ? 'bg-emerald-50' : ''}>
                    <TableCell className="text-xs py-1 border-b text-center font-mono">{idx + 1}º</TableCell>
                    <TableCell className="text-xs py-1 border-b">{lote.numero_documento || 'S/N'}</TableCell>
                    <TableCell className="text-xs py-1 border-b">{fmtData(lote.data_documento)}</TableCell>
                    <TableCell className="text-xs py-1 border-b">{lote.fornecedor_nome || '-'}</TableCell>
                    <TableCell className="text-xs py-1 border-b text-right font-mono">{fmt(lote.quantidade_disponivel)}</TableCell>
                    <TableCell className="text-xs py-1 border-b text-right font-mono">{fmtMoeda(lote.custo_unitario)}</TableCell>
                    <TableCell className={`text-xs py-1 border-b text-right font-mono font-semibold ${lote.consumo > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {lote.consumo > 0 ? fmt(lote.consumo) : '-'}
                    </TableCell>
                    <TableCell className={`text-xs py-1 border-b text-right font-mono ${lote.consumo > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {lote.consumo > 0 ? fmtMoeda(lote.consumo * (lote.custo_unitario || 0)) : '-'}
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