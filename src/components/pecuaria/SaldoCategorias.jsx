import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Scale, ChevronDown, ChevronUp } from "lucide-react";

export default function SaldoCategorias({ movimentacoes = [] }) {
  const [isVisible, setIsVisible] = useState(true);
  // Calcular saldo por categoria
  const calcularSaldos = () => {
    const saldos = {};

    movimentacoes.forEach(mov => {
      const categoria = mov.categoria_animal;
      if (!categoria) return;

      if (!saldos[categoria]) {
        saldos[categoria] = { entradas: 0, saidas: 0, saldo: 0 };
      }

      const qtd = mov.quantidade_animais || 0;

      if (mov.tipo === "Entrada") {
        saldos[categoria].entradas += qtd;
        saldos[categoria].saldo += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[categoria].saidas += qtd;
        saldos[categoria].saldo -= qtd;
      }

      // Mudança de categoria: subtrai da categoria origem e soma na destino
      if (mov.motivo === "Mudança de Categoria" && mov.categoria_nova) {
        if (!saldos[mov.categoria_nova]) {
          saldos[mov.categoria_nova] = { entradas: 0, saidas: 0, saldo: 0 };
        }
        // A entrada já foi contada na categoria_animal, 
        // então precisamos ajustar para a categoria nova
        if (mov.tipo === "Entrada") {
          saldos[categoria].saldo -= qtd;
          saldos[categoria].entradas -= qtd;
          saldos[mov.categoria_nova].saldo += qtd;
          saldos[mov.categoria_nova].entradas += qtd;
        }
      }
    });

    return Object.entries(saldos)
      .map(([categoria, dados]) => ({ categoria, ...dados }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria, 'pt-BR'));
  };

  const saldos = calcularSaldos();
  const totalEntradas = saldos.reduce((sum, s) => sum + s.entradas, 0);
  const totalSaidas = saldos.reduce((sum, s) => sum + s.saidas, 0);
  const totalSaldo = saldos.reduce((sum, s) => sum + s.saldo, 0);

  if (saldos.length === 0) {
    return null;
  }

  return (
    <Card className="shadow-sm border-slate-200 mb-4">
      <CardHeader className="bg-slate-50 border-b py-2 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Scale className="w-4 h-4" />
            Saldo por Categoria
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsVisible(!isVisible)}
            className="h-7 gap-1 text-xs"
          >
            {isVisible ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {isVisible ? 'Ocultar' : 'Mostrar'}
          </Button>
        </div>
      </CardHeader>
      {isVisible && <CardContent className="p-0">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs font-semibold">Categoria</TableHead>
                <TableHead className="text-xs font-semibold text-center text-green-700">
                  <div className="flex items-center justify-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    Entradas
                  </div>
                </TableHead>
                <TableHead className="text-xs font-semibold text-center text-red-700">
                  <div className="flex items-center justify-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    Saídas
                  </div>
                </TableHead>
                <TableHead className="text-xs font-semibold text-center text-blue-700">Saldo Atual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {saldos.map((item) => (
                <TableRow key={item.categoria} className="hover:bg-slate-50">
                  <TableCell className="text-xs font-medium">{item.categoria}</TableCell>
                  <TableCell className="text-xs text-center font-mono text-green-700 font-semibold">
                    +{item.entradas}
                  </TableCell>
                  <TableCell className="text-xs text-center font-mono text-red-700 font-semibold">
                    -{item.saidas}
                  </TableCell>
                  <TableCell className={`text-xs text-center font-mono font-bold ${item.saldo >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    {item.saldo} cab
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                <TableCell className="text-xs font-bold">TOTAL GERAL</TableCell>
                <TableCell className="text-xs text-center font-mono text-green-700 font-bold">
                  +{totalEntradas}
                </TableCell>
                <TableCell className="text-xs text-center font-mono text-red-700 font-bold">
                  -{totalSaidas}
                </TableCell>
                <TableCell className={`text-xs text-center font-mono font-bold ${totalSaldo >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  {totalSaldo} cab
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          </div>
          </CardContent>}
          </Card>
          );
          }