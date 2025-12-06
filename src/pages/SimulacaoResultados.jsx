import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, DollarSign, Download } from "lucide-react";
import { toast } from "sonner";

export default function SimulacaoResultados() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  // Estados
  const [loteSelecionado, setLoteSelecionado] = useState("");
  const [periodos, setPeriodos] = useState([30, 60, 90]);
  const [precoArrobaSimulacao, setPrecoArrobaSimulacao] = useState("");

  // Fetch dados
  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-animais-cotacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LoteAnimaisCotacao.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: aplicacoes = [] } = useQuery({
    queryKey: ['aplicacoes-medicamentos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AplicacaoMedicamento.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-cotacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ProdutoCotacao.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const loteAtual = lotes.find(l => l.id === loteSelecionado);
  const aplicacoesLote = aplicacoes.filter(a => a.lote_id === loteSelecionado);
  const custoTotalMedicamentos = aplicacoesLote.reduce((s, a) => s + (a.custo_total || 0), 0);
  const precoArroba = parseFloat(precoArrobaSimulacao) || loteAtual?.preco_arroba_atual || 0;

  // Cálculos de simulação
  const resultados = useMemo(() => {
    if (!loteAtual || precoArroba === 0) return [];

    return periodos.map(dias => {
      const ganhoTotal = loteAtual.quantidade_animais * loteAtual.gmd_esperado * dias;
      const arrobasProduzidas = ganhoTotal / 15;
      const valorGerado = arrobasProduzidas * precoArroba;
      const lucroBruto = valorGerado - custoTotalMedicamentos;
      const lucroPorAnimal = lucroBruto / loteAtual.quantidade_animais;
      const pesoFinal = loteAtual.peso_medio_atual + (loteAtual.gmd_esperado * dias);

      return {
        dias,
        ganhoTotal,
        arrobasProduzidas,
        valorGerado,
        custoTotal: custoTotalMedicamentos,
        lucroBruto,
        lucroPorAnimal,
        pesoFinal,
      };
    });
  }, [loteAtual, precoArroba, periodos, custoTotalMedicamentos]);

  const dadosGrafico = resultados.map(r => ({
    periodo: `${r.dias}d`,
    'Ganho (kg)': r.ganhoTotal.toFixed(0),
    'Valor Gerado': r.valorGerado.toFixed(0),
    'Custo': r.custoTotal.toFixed(0),
    'Lucro': r.lucroBruto.toFixed(0),
  }));

  const dadosPesoGrafico = resultados.map(r => ({
    periodo: `${r.dias}d`,
    'Peso Médio': r.pesoFinal.toFixed(0),
  }));

  const gerarPDF = () => {
    toast.info("Funcionalidade de PDF em desenvolvimento");
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Simulação de Resultados</h1>
          <p className="text-xs text-slate-600">Análise de retorno econômico em 30/60/90 dias</p>
        </div>
        {loteAtual && (
          <Button variant="outline" size="sm" onClick={gerarPDF} className="h-8 text-xs">
            <Download className="w-3.5 h-3.5 mr-1" />
            Exportar PDF
          </Button>
        )}
      </div>

      {/* Seleção de Lote e Parâmetros */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm">Selecionar Lote</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Lote <span className="text-red-500">*</span></Label>
                <Select value={loteSelecionado} onValueChange={setLoteSelecionado}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha um lote" /></SelectTrigger>
                  <SelectContent>
                    {lotes.map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.nome_lote}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Preço da Arroba (R$)</Label>
                <Input 
                  type="number" 
                  value={precoArrobaSimulacao} 
                  onChange={(e) => setPrecoArrobaSimulacao(e.target.value)} 
                  className="h-8 text-xs" 
                  placeholder={loteAtual?.preco_arroba_atual ? `Atual: R$ ${loteAtual.preco_arroba_atual.toFixed(2)}` : "Ex: 280.00"} 
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {loteAtual && (
          <Card className="bg-blue-50 border-blue-200">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm text-blue-800">Dados do Lote</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-blue-600">Animais:</span> <span className="font-bold">{loteAtual.quantidade_animais}</span></div>
                <div><span className="text-blue-600">Peso Médio:</span> <span className="font-bold">{loteAtual.peso_medio_atual.toFixed(2)} kg</span></div>
                <div><span className="text-blue-600">GMD:</span> <span className="font-bold">{loteAtual.gmd_esperado.toFixed(3)} kg/dia</span></div>
                <div><span className="text-blue-600">Categoria:</span> <span className="font-bold">{loteAtual.categoria_animal}</span></div>
                <div><span className="text-blue-600">Pasto:</span> <span className="font-bold">{loteAtual.tipo_pasto}</span></div>
                <div><span className="text-blue-600">Sal Mineral:</span> <span className="font-bold">{loteAtual.sal_mineral ? 'Sim' : 'Não'}</span></div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Seção 1: Produtos da Cotação */}
      {loteAtual && aplicacoesLote.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3 bg-slate-100">
            <CardTitle className="text-sm">1. Produtos Aplicados</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Fornecedor</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd/Animal</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo/Animal</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aplicacoesLote.map(a => {
                  const prod = produtos.find(p => p.id === a.produto_id);
                  return (
                    <TableRow key={a.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{a.produto_nome}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{prod?.empresa_fornecedora || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{a.quantidade_aplicada} {a.unidade_medida}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">R$ {a.custo_por_animal.toFixed(2)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">R$ {a.custo_total.toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-emerald-100">
                  <TableCell colSpan={4} className="text-xs py-1 border border-black font-bold text-right">CUSTO TOTAL DOS MEDICAMENTOS:</TableCell>
                  <TableCell className="text-xs py-1 border border-black text-right font-mono font-bold text-emerald-800">R$ {custoTotalMedicamentos.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Seção 3: Tabela de Resultados */}
      {loteAtual && precoArroba > 0 && resultados.length > 0 && (
        <>
          <Card>
            <CardHeader className="py-2 px-3 bg-slate-100">
              <CardTitle className="text-sm">2. Projeção de Ganho e Retorno</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-bold py-1 border border-black">Período</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Ganho Total (kg)</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Arrobas (@)</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Peso Final Médio</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Total</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor Produzido</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Lucro</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Lucro/Animal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultados.map(r => (
                    <TableRow key={r.dias} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{r.dias} dias</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{r.ganhoTotal.toFixed(2)} kg</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{r.arrobasProduzidas.toFixed(2)} @</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{r.pesoFinal.toFixed(2)} kg</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">R$ {r.custoTotal.toFixed(2)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold text-blue-700">R$ {r.valorGerado.toFixed(2)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-bold text-emerald-700">R$ {r.lucroBruto.toFixed(2)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">R$ {r.lucroPorAnimal.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Conclusão Automática */}
          <Card className="bg-emerald-50 border-emerald-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <TrendingUp className="w-8 h-8 text-emerald-700 flex-shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-800 mb-2">Conclusão da Análise</h3>
                  <p className="text-sm text-emerald-900">
                    Com base no preço da arroba atual de <strong>R$ {precoArroba.toFixed(2)}</strong> e no ganho médio diário de <strong>{loteAtual.gmd_esperado.toFixed(3)} kg/dia</strong>, 
                    o lote de <strong>{loteAtual.quantidade_animais} animais</strong> pode gerar entre{' '}
                    <strong className="text-emerald-700">R$ {resultados[0]?.lucroBruto.toFixed(2)}</strong> e{' '}
                    <strong className="text-emerald-700">R$ {resultados[resultados.length - 1]?.lucroBruto.toFixed(2)}</strong> de lucro 
                    em {resultados[resultados.length - 1]?.dias} dias, descontando o custo de <strong>R$ {custoTotalMedicamentos.toFixed(2)}</strong> em medicamentos.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm">Ganho de Peso Total</CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dadosGrafico}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="Ganho (kg)" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm">Custo vs Lucro</CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dadosGrafico}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Custo" fill="#ef4444" />
                    <Bar dataKey="Lucro" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm">Evolução do Peso Médio</CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={dadosPesoGrafico}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="Peso Médio" stroke="#0ea5e9" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {!loteAtual && (
        <Card>
          <CardContent className="p-12 text-center">
            <TrendingUp className="w-16 h-16 mx-auto mb-4 text-slate-300" />
            <p className="text-sm text-slate-500">Selecione um lote para visualizar a simulação de resultados</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}