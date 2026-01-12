import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function ResumoVendaDia({ pesagens = [], pendingPesagensDB = [], dataPesagem }) {
  const vendasDia = useMemo(() => {
    const all = [...(pendingPesagensDB || []), ...(pesagens || [])];
    return all.filter((p) => p.data_pesagem === dataPesagem && p.tipo_manejo === 'Saída' && p.motivo_saida === 'Venda');
  }, [pesagens, pendingPesagensDB, dataPesagem]);

  const stats = useMemo(() => {
    const total = vendasDia.length;
    const pesoTotal = vendasDia.reduce((s, p) => s + (Number(p.peso) || 0), 0);
    const pesoMedio = total ? pesoTotal / total : 0;

    // média da arroba informada
    const arrobasInformadas = vendasDia
      .map((v) => Number(v.valor_arroba))
      .filter((n) => !isNaN(n) && n > 0);
    const mediaArroba = arrobasInformadas.length
      ? arrobasInformadas.reduce((s, n) => s + n, 0) / arrobasInformadas.length
      : 0;

    // valor total: usar valor_venda_total se existir; senão, calcular por peso/30 * valor_arroba
    const valorTotal = vendasDia.reduce((s, v) => {
      const direto = Number(v.valor_venda_total);
      if (!isNaN(direto) && direto > 0) return s + direto;
      const calc = (Number(v.peso) || 0) / 30 * (Number(v.valor_arroba) || 0);
      return s + (isNaN(calc) ? 0 : calc);
    }, 0);

    return { total, pesoTotal, pesoMedio, mediaArroba, valorTotal };
  }, [vendasDia]);

  return (
    <div className="xl:col-span-1 lg:col-span-1">
      <Card className="shadow-sm sticky top-2">
        <CardHeader className="py-2 px-3 bg-slate-200 border-b">
          <CardTitle className="text-xs font-semibold">
            Resumo de Vendas
            <span className="text-[10px] text-slate-600 ml-2">({dataPesagem?.split('T')[0]?.split('-')?.reverse()?.join('/')})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {stats.total > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Métrica</TableHead>
                  <TableHead className="text-[10px] text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-gray-50">
                  <TableCell className="text-xs">Animais vendidos</TableCell>
                  <TableCell className="text-xs text-right font-mono">{stats.total}</TableCell>
                </TableRow>
                <TableRow className="hover:bg-gray-50">
                  <TableCell className="text-xs">Peso total (kg)</TableCell>
                  <TableCell className="text-xs text-right font-mono">{stats.pesoTotal.toFixed(2)}</TableCell>
                </TableRow>
                <TableRow className="hover:bg-gray-50">
                  <TableCell className="text-xs">Peso médio (kg)</TableCell>
                  <TableCell className="text-xs text-right font-mono">{stats.pesoMedio.toFixed(2)}</TableCell>
                </TableRow>
                <TableRow className="hover:bg-gray-50">
                  <TableCell className="text-xs">Média da arroba (R$)</TableCell>
                  <TableCell className="text-xs text-right font-mono">R$ {stats.mediaArroba.toFixed(2)}</TableCell>
                </TableRow>
                <TableRow className="hover:bg-gray-50">
                  <TableCell className="text-xs">Valor total (R$)</TableCell>
                  <TableCell className="text-xs text-right font-mono">R$ {stats.valorTotal.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-6 text-slate-400 text-xs">
              Nenhuma venda registrada neste dia
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}