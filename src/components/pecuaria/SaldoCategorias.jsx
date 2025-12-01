import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Scale, ChevronDown, ChevronUp } from "lucide-react";

export default function SaldoCategorias({ movimentacoes = [] }) {
  const [isVisible, setIsVisible] = useState(() => {
    const saved = localStorage.getItem('saldo_categoria_visivel');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const toggle = () => {
    setIsVisible(prev => {
      const newValue = !prev;
      localStorage.setItem('saldo_categoria_visivel', JSON.stringify(newValue));
      return newValue;
    });
  };

  // Calcular matriz categoria x marca (apenas movimentações manuais)
  const { matrizCategoriaMarca, marcas, categorias, totaisPorMarca, totaisPorCategoria, totalGeral } = useMemo(() => {
    const matriz = {};
    const marcasSet = new Set();
    const categoriasSet = new Set();

    // Filtrar apenas movimentações manuais (sem lote_id)
    const movimentacoesManuais = movimentacoes.filter(m => !m.lote_id);

    movimentacoesManuais.forEach(mov => {
      const categoria = mov.categoria_animal;
      const marca = mov.marca || 'Sem Marca';
      if (!categoria) return;

      marcasSet.add(marca);
      categoriasSet.add(categoria);

      const chave = `${categoria}|||${marca}`;
      if (!matriz[chave]) {
        matriz[chave] = { categoria, marca, saldo: 0 };
      }

      const qtd = mov.quantidade_animais || 0;
      if (mov.tipo === "Entrada") {
        matriz[chave].saldo += qtd;
      } else if (mov.tipo === "Saída") {
        matriz[chave].saldo -= qtd;
      }
    });

    const marcasArray = Array.from(marcasSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const categoriasArray = Array.from(categoriasSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    // Calcular totais por marca
    const totaisMarca = {};
    marcasArray.forEach(m => { totaisMarca[m] = 0; });
    
    // Calcular totais por categoria
    const totaisCategoria = {};
    categoriasArray.forEach(c => { totaisCategoria[c] = 0; });

    let total = 0;

    Object.values(matriz).forEach(item => {
      totaisMarca[item.marca] = (totaisMarca[item.marca] || 0) + item.saldo;
      totaisCategoria[item.categoria] = (totaisCategoria[item.categoria] || 0) + item.saldo;
      total += item.saldo;
    });

    return {
      matrizCategoriaMarca: matriz,
      marcas: marcasArray,
      categorias: categoriasArray,
      totaisPorMarca: totaisMarca,
      totaisPorCategoria: totaisCategoria,
      totalGeral: total
    };
  }, [movimentacoes]);

  // Função para obter saldo de uma célula
  const getSaldo = (categoria, marca) => {
    const chave = `${categoria}|||${marca}`;
    return matrizCategoriaMarca[chave]?.saldo || 0;
  };

  if (categorias.length === 0) {
    return null;
  }

  return (
    <Card className="shadow-sm border-slate-200 mb-4">
      <CardHeader className="bg-slate-50 border-b py-2 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Scale className="w-4 h-4" />
            Saldo por Categoria / Marca
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-semibold">
              Total: {totalGeral.toLocaleString('pt-BR')} cab
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggle}
              className="h-7 gap-1 text-xs"
            >
              {isVisible ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {isVisible ? 'Ocultar' : 'Mostrar'}
            </Button>
          </div>
        </div>
      </CardHeader>
      {isVisible && (
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-slate-100 border-b-2 border-slate-300">
                  <TableHead className="font-bold border-r border-slate-300 sticky left-0 bg-slate-100 z-20 min-w-[140px] py-1.5">
                    Categoria de Manejo
                  </TableHead>
                  {marcas.map(marca => (
                    <TableHead key={marca} className="font-semibold text-center border-r border-slate-200 min-w-[70px] whitespace-nowrap py-1.5">
                      {marca}
                    </TableHead>
                  ))}
                  <TableHead className="font-bold text-center bg-yellow-100 text-yellow-900 min-w-[90px] py-1.5">
                    Total Cabeças
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categorias.map((categoria, idx) => (
                  <TableRow key={categoria} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    <TableCell className="font-medium border-r border-slate-300 sticky left-0 bg-inherit z-10 py-1">
                      {categoria}
                    </TableCell>
                    {marcas.map(marca => {
                      const saldo = getSaldo(categoria, marca);
                      return (
                        <TableCell 
                          key={marca} 
                          className={`text-center font-mono border-r border-slate-200 py-1 ${
                            saldo > 0 ? 'text-slate-900' : saldo < 0 ? 'text-red-600 font-semibold' : ''
                          }`}
                        >
                          {saldo !== 0 ? saldo.toLocaleString('pt-BR') : ''}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center font-mono font-bold bg-yellow-50 text-yellow-900 py-1">
                      {totaisPorCategoria[categoria]?.toLocaleString('pt-BR') || 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}