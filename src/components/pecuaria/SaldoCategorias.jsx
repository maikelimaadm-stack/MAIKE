import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Scale, ChevronDown, ChevronUp, Tag } from "lucide-react";

export default function SaldoCategorias({ movimentacoes = [] }) {
  const [isVisibleCategoria, setIsVisibleCategoria] = useState(() => {
    const saved = localStorage.getItem('saldo_categoria_visivel');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [isVisibleMarca, setIsVisibleMarca] = useState(() => {
    const saved = localStorage.getItem('saldo_marca_visivel');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const toggleCategoria = () => {
    setIsVisibleCategoria(prev => {
      const newValue = !prev;
      localStorage.setItem('saldo_categoria_visivel', JSON.stringify(newValue));
      return newValue;
    });
  };

  const toggleMarca = () => {
    setIsVisibleMarca(prev => {
      const newValue = !prev;
      localStorage.setItem('saldo_marca_visivel', JSON.stringify(newValue));
      return newValue;
    });
  };
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

      // Mudança de categoria: é uma saída da categoria antiga, mas entra na nova
      // Não altera o total geral, apenas transfere entre categorias
      if (mov.motivo === "Mudança de Categoria" && mov.categoria_nova && mov.tipo === "Saída") {
        // Sai da categoria atual
        saldos[categoria].saidas += qtd;
        saldos[categoria].saldo -= qtd;
        
        // Entra na nova categoria
        if (!saldos[mov.categoria_nova]) {
          saldos[mov.categoria_nova] = { entradas: 0, saidas: 0, saldo: 0 };
        }
        saldos[mov.categoria_nova].entradas += qtd;
        saldos[mov.categoria_nova].saldo += qtd;
      } else if (mov.tipo === "Entrada") {
        saldos[categoria].entradas += qtd;
        saldos[categoria].saldo += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[categoria].saidas += qtd;
        saldos[categoria].saldo -= qtd;
      }
    });

    return Object.entries(saldos)
      .map(([categoria, dados]) => ({ categoria, ...dados }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria, 'pt-BR'));
  };

  // Calcular saldo por marca
  const calcularSaldosMarca = () => {
    const saldos = {};

    movimentacoes.forEach(mov => {
      const marca = mov.marca;
      if (!marca) return;

      if (!saldos[marca]) {
        saldos[marca] = { entradas: 0, saidas: 0, saldo: 0 };
      }

      const qtd = mov.quantidade_animais || 0;

      if (mov.tipo === "Entrada") {
        saldos[marca].entradas += qtd;
        saldos[marca].saldo += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[marca].saidas += qtd;
        saldos[marca].saldo -= qtd;
      }
    });

    return Object.entries(saldos)
      .map(([marca, dados]) => ({ marca, ...dados }))
      .sort((a, b) => a.marca.localeCompare(b.marca, 'pt-BR'));
  };

  const saldos = calcularSaldos();
  const saldosMarca = calcularSaldosMarca();
  
  const totalEntradas = saldos.reduce((sum, s) => sum + s.entradas, 0);
  const totalSaidas = saldos.reduce((sum, s) => sum + s.saidas, 0);
  const totalSaldo = saldos.reduce((sum, s) => sum + s.saldo, 0);

  const totalEntradasMarca = saldosMarca.reduce((sum, s) => sum + s.entradas, 0);
  const totalSaidasMarca = saldosMarca.reduce((sum, s) => sum + s.saidas, 0);
  const totalSaldoMarca = saldosMarca.reduce((sum, s) => sum + s.saldo, 0);

  if (saldos.length === 0 && saldosMarca.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 mb-4">
      {/* Saldo por Categoria */}
      {saldos.length > 0 && (
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="bg-slate-50 border-b py-2 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Scale className="w-4 h-4" />
                Saldo por Categoria
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleCategoria}
                className="h-7 gap-1 text-xs"
              >
                {isVisibleCategoria ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {isVisibleCategoria ? 'Ocultar' : 'Mostrar'}
              </Button>
            </div>
          </CardHeader>
          {isVisibleCategoria && <CardContent className="p-0">
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
          )}

          {/* Saldo por Marca */}
          {saldosMarca.length > 0 && (
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="bg-blue-50 border-b py-2 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Saldo por Marca
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleMarca}
                  className="h-7 gap-1 text-xs"
                >
                  {isVisibleMarca ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {isVisibleMarca ? 'Ocultar' : 'Mostrar'}
                </Button>
              </div>
            </CardHeader>
            {isVisibleMarca && <CardContent className="p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50">
                      <TableHead className="text-xs font-semibold">Marca</TableHead>
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
                    {saldosMarca.map((item) => (
                      <TableRow key={item.marca} className="hover:bg-blue-50/50">
                        <TableCell className="text-xs font-medium">{item.marca}</TableCell>
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
                    <TableRow className="bg-blue-100 border-t-2 border-blue-300">
                      <TableCell className="text-xs font-bold">TOTAL GERAL</TableCell>
                      <TableCell className="text-xs text-center font-mono text-green-700 font-bold">
                        +{totalEntradasMarca}
                      </TableCell>
                      <TableCell className="text-xs text-center font-mono text-red-700 font-bold">
                        -{totalSaidasMarca}
                      </TableCell>
                      <TableCell className={`text-xs text-center font-mono font-bold ${totalSaldoMarca >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                        {totalSaldoMarca} cab
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>}
          </Card>
          )}
          </div>
          );
          }