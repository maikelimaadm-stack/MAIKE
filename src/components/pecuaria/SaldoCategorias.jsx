import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Scale, ChevronDown, ChevronUp, Tag } from "lucide-react";

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

  // Calcular matriz categoria x marca
  const { matrizCategoriaMarca, marcas, categorias, totaisPorMarca, totaisPorCategoria, totalGeral } = useMemo(() => {
    const matriz = {};
    const marcasSet = new Set();
    const categoriasSet = new Set();

    movimentacoes.forEach(mov => {
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
    <div className="space-y-4 mb-4">
      {/* Quadro Categoria x Marca (Pivot) */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="bg-slate-50 border-b py-2 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Scale className="w-4 h-4" />
              Saldo por Categoria
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-semibold">
                Total: {totalGeral.toLocaleString('pt-BR')} cab
              </div>
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
          </div>
        </CardHeader>
        {isVisibleCategoria && (
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[400px]">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow className="bg-slate-100">
                    <TableHead className="text-xs font-bold border-r border-slate-300 sticky left-0 bg-slate-100 z-20 min-w-[150px]">
                      Categoria de Manejo
                    </TableHead>
                    {marcas.map(marca => (
                      <TableHead key={marca} className="text-xs font-semibold text-center border-r border-slate-200 min-w-[80px] whitespace-nowrap">
                        {marca}
                      </TableHead>
                    ))}
                    <TableHead className="text-xs font-bold text-center bg-emerald-50 min-w-[100px]">
                      Total Cabeças
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categorias.map((categoria, idx) => (
                    <TableRow key={categoria} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <TableCell className="text-xs font-medium border-r border-slate-300 sticky left-0 bg-inherit z-10">
                        {categoria}
                      </TableCell>
                      {marcas.map(marca => {
                        const saldo = getSaldo(categoria, marca);
                        return (
                          <TableCell 
                            key={marca} 
                            className={`text-xs text-center font-mono border-r border-slate-200 ${
                              saldo > 0 ? 'text-slate-900' : saldo < 0 ? 'text-red-600' : 'text-slate-300'
                            }`}
                          >
                            {saldo !== 0 ? saldo.toLocaleString('pt-BR') : ''}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-xs text-center font-mono font-bold bg-emerald-50 text-emerald-800">
                        {totaisPorCategoria[categoria]?.toLocaleString('pt-BR') || 0}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Linha de Subtotal por Marca */}
                  <TableRow className="bg-slate-200 border-t-2 border-slate-400">
                    <TableCell className="text-xs font-bold border-r border-slate-300 sticky left-0 bg-slate-200 z-10">
                      SUBTOTAL
                    </TableCell>
                    {marcas.map(marca => (
                      <TableCell key={marca} className="text-xs text-center font-mono font-bold border-r border-slate-200 text-slate-800">
                        {totaisPorMarca[marca]?.toLocaleString('pt-BR') || 0}
                      </TableCell>
                    ))}
                    <TableCell className="text-xs text-center font-mono font-bold bg-emerald-100 text-emerald-900">
                      {totalGeral.toLocaleString('pt-BR')}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Quadro por Marca (categorias dentro de cada marca) */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="bg-blue-50 border-b py-2 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Saldo por Marca (com Categorias)
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-semibold">
                {marcas.length} marca(s)
              </div>
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
          </div>
        </CardHeader>
        {isVisibleMarca && (
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {marcas.map(marca => {
                const categoriasComSaldo = categorias
                  .map(cat => ({ categoria: cat, saldo: getSaldo(cat, marca) }))
                  .filter(item => item.saldo !== 0);
                
                if (categoriasComSaldo.length === 0) return null;

                return (
                  <div key={marca} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="bg-blue-100 px-3 py-2 border-b border-blue-200 flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-900">{marca}</span>
                      <span className="text-xs font-bold text-blue-700 bg-white px-2 py-0.5 rounded">
                        {totaisPorMarca[marca]?.toLocaleString('pt-BR') || 0} cab
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {categoriasComSaldo.map(item => (
                        <div key={item.categoria} className="flex justify-between px-3 py-1.5 hover:bg-slate-50">
                          <span className="text-xs text-slate-700">{item.categoria}</span>
                          <span className={`text-xs font-mono font-semibold ${item.saldo >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                            {item.saldo.toLocaleString('pt-BR')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}