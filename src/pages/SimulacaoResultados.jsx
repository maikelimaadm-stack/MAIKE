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
import { TrendingUp, DollarSign, Download, Plus, Trash2, Printer } from "lucide-react";
import { toast } from "sonner";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return 'R$ 0,00';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarNumero = (valor, decimals = 2) => {
  if (!valor && valor !== 0) return '0,00';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

export default function SimulacaoResultados() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  // Estados
  const [loteSelecionado, setLoteSelecionado] = useState("");
  const [precoArrobaSimulacao, setPrecoArrobaSimulacao] = useState("");
  const [orientacao, setOrientacao] = useState("paisagem");
  
  // Períodos personalizados com GMD específico
  const [periodos, setPeriodos] = useState([
    { dias: 30, gmdEspecifico: "" },
    { dias: 60, gmdEspecifico: "" },
    { dias: 90, gmdEspecifico: "" }
  ]);

  const adicionarPeriodo = () => {
    setPeriodos([...periodos, { dias: "", gmdEspecifico: "" }]);
  };

  const removerPeriodo = (index) => {
    setPeriodos(periodos.filter((_, i) => i !== index));
  };

  const atualizarPeriodo = (index, campo, valor) => {
    const novos = [...periodos];
    novos[index][campo] = valor;
    setPeriodos(novos);
  };

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

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual-sim', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return null;
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaSelecionadaId) || null;
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

    return periodos
      .filter(p => p.dias > 0)
      .map(periodo => {
        const dias = parseInt(periodo.dias);
        const gmdUsar = periodo.gmdEspecifico ? parseFloat(periodo.gmdEspecifico) : loteAtual.gmd_esperado;
        const ganhoTotal = loteAtual.quantidade_animais * gmdUsar * dias;
        const arrobasProduzidas = ganhoTotal / 15;
        const valorGerado = arrobasProduzidas * precoArroba;
        const lucroBruto = valorGerado - custoTotalMedicamentos;
        const lucroPorAnimal = lucroBruto / loteAtual.quantidade_animais;
        const pesoFinal = loteAtual.peso_medio_atual + (gmdUsar * dias);

        return {
          dias,
          gmd: gmdUsar,
          ganhoTotal,
          arrobasProduzidas,
          valorGerado,
          custoTotal: custoTotalMedicamentos,
          lucroBruto,
          lucroPorAnimal,
          pesoFinal,
        };
      })
      .sort((a, b) => a.dias - b.dias);
  }, [loteAtual, precoArroba, periodos, custoTotalMedicamentos]);

  const dadosGrafico = resultados.map(r => ({
    periodo: `${r.dias}d`,
    'Ganho (kg)': parseFloat(r.ganhoTotal.toFixed(0)),
    'Valor Gerado': parseFloat(r.valorGerado.toFixed(0)),
    'Custo': parseFloat(r.custoTotal.toFixed(0)),
    'Lucro': parseFloat(r.lucroBruto.toFixed(0)),
  }));

  const dadosPesoGrafico = resultados.map(r => ({
    periodo: `${r.dias}d`,
    'Peso Médio': parseFloat(r.pesoFinal.toFixed(0)),
  }));

  const handleImprimir = () => {
    window.print();
  };

  const formatarData = (dataString) => {
    if (!dataString) return '--/--/----';
    try {
      const dataStr = dataString.split('T')[0];
      const [ano, mes, dia] = dataStr.split('-');
      return `${dia}/${mes}/${ano}`;
    } catch { return '--/--/----'; }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200 no-print">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Simulação de Resultados</h1>
          <p className="text-xs text-slate-600">Análise de retorno econômico personalizado</p>
        </div>
        {loteAtual && (
          <Button variant="outline" size="sm" onClick={handleImprimir} className="h-8 text-xs">
            <Printer className="w-3.5 h-3.5 mr-1" />
            Imprimir
          </Button>
        )}
      </div>

      {/* Configurações */}
      <Card className="no-print">
        <CardContent className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
                step="0.01"
                value={precoArrobaSimulacao} 
                onChange={(e) => setPrecoArrobaSimulacao(e.target.value)} 
                className="h-8 text-xs" 
                placeholder={loteAtual?.preco_arroba_atual ? formatarMoeda(loteAtual.preco_arroba_atual) : "Ex: 280.00"} 
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Orientação</Label>
              <Select value={orientacao} onValueChange={setOrientacao}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="retrato">Retrato</SelectItem>
                  <SelectItem value="paisagem">Paisagem</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {loteAtual && (
        <Card className="bg-blue-50 border-blue-200 no-print">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm text-blue-800">Configurar Períodos de Ganho</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="space-y-2">
              {periodos.map((p, idx) => (
                <div key={idx} className="grid grid-cols-3 gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Dias</Label>
                    <Input 
                      type="number" 
                      value={p.dias} 
                      onChange={(e) => atualizarPeriodo(idx, 'dias', e.target.value)} 
                      className="h-8 text-xs" 
                      placeholder="30" 
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">GMD (kg/dia)</Label>
                    <Input 
                      type="number" 
                      step="0.001"
                      value={p.gmdEspecifico} 
                      onChange={(e) => atualizarPeriodo(idx, 'gmdEspecifico', e.target.value)} 
                      className="h-8 text-xs" 
                      placeholder={`Padrão: ${formatarNumero(loteAtual.gmd_esperado, 3)}`}
                    />
                  </div>
                  <Button variant="outline" size="icon" className="h-8 w-8 text-red-500" onClick={() => removerPeriodo(idx)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={adicionarPeriodo} className="h-7 text-xs w-full">
                <Plus className="w-3.5 h-3.5 mr-1" />
                Adicionar Período
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ÁREA DE IMPRESSÃO */}
      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page { size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'}; margin: 1.5cm 1cm 2cm 1cm; }
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; }
            header, nav, .no-print, .print\\:hidden { display: none !important; }
          }
        `}} />

        <div className="print-area p-8 print:p-0">
          {/* Cabeçalho do Relatório */}
          <div className="border-b-2 border-black pb-1 mb-3">
            <div className="flex items-center justify-between gap-3">
              {empresaAtual?.logotipo_url && (
                <img src={empresaAtual.logotipo_url} alt={empresaAtual.apelido || "Logo"} className="h-24 w-24 object-contain" />
              )}
              <div className="flex-1 text-center">
                <h1 className="text-base font-bold leading-tight uppercase">{empresaAtual?.nome || 'Empresa'}</h1>
                {empresaAtual?.apelido && empresaAtual.apelido !== empresaAtual.nome && (
                  <p className="text-xs leading-tight">{empresaAtual.apelido}</p>
                )}
                {empresaAtual?.endereco && (
                  <p className="text-xs leading-tight">
                    {empresaAtual.endereco}
                    {empresaAtual?.cidade && empresaAtual?.estado && `, ${empresaAtual.cidade}-${empresaAtual.estado}`}
                  </p>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold">SIMULAÇÃO DE RESULTADOS - GANHO DE PESO E RETORNO ECONÔMICO</h2>
              <p className="text-xs text-gray-600">
                Lote: <strong>{loteAtual?.nome_lote}</strong> | Emitido em: {new Date().toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>

          {/* Seção 1: Dados do Lote */}
          {loteAtual && (
            <Card className="mb-3">
              <CardHeader className="py-2 px-3 bg-slate-100">
                <CardTitle className="text-sm font-bold">1. DADOS DO LOTE</CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="border-r pr-3">
                    <div className="mb-1"><span className="text-slate-600">Lote:</span> <span className="font-bold">{loteAtual.nome_lote}</span></div>
                    <div className="mb-1"><span className="text-slate-600">Data Registro:</span> <span className="font-bold">{formatarData(loteAtual.data_registro)}</span></div>
                    <div className="mb-1"><span className="text-slate-600">Quantidade:</span> <span className="font-bold">{formatarNumero(loteAtual.quantidade_animais, 0)} animais</span></div>
                  </div>
                  <div className="border-r pr-3">
                    <div className="mb-1"><span className="text-slate-600">Peso Médio Atual:</span> <span className="font-bold">{formatarNumero(loteAtual.peso_medio_atual, 2)} kg</span></div>
                    <div className="mb-1"><span className="text-slate-600">Categoria:</span> <span className="font-bold">{loteAtual.categoria_animal}</span></div>
                    <div className="mb-1"><span className="text-slate-600">GMD Padrão:</span> <span className="font-bold">{formatarNumero(loteAtual.gmd_esperado, 3)} kg/dia</span></div>
                  </div>
                  <div>
                    <div className="mb-1"><span className="text-slate-600">Tipo de Pasto:</span> <span className="font-bold">{loteAtual.tipo_pasto}</span></div>
                    <div className="mb-1"><span className="text-slate-600">Sal Mineral:</span> <span className="font-bold">{loteAtual.sal_mineral ? 'Sim' : 'Não'}</span></div>
                    <div className="mb-1"><span className="text-slate-600">Preço @:</span> <span className="font-bold">{formatarMoeda(precoArroba)}</span></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Seção 2: Produtos Aplicados */}
          {loteAtual && aplicacoesLote.length > 0 && (
            <Card className="mb-3">
              <CardHeader className="py-2 px-3 bg-slate-100">
                <CardTitle className="text-sm font-bold">2. PRODUTOS APLICADOS</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black">Categoria</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black">Fornecedor</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black">Vendedor</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd/Animal</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor Unit.</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo/Cabeça</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd Animais</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aplicacoesLote.map(a => {
                      const prod = produtos.find(p => p.id === a.produto_id);
                      return (
                        <TableRow key={a.id} className="hover:bg-gray-50">
                          <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{a.produto_nome}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{a.categoria_produto}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{prod?.empresa_fornecedora || '-'}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{prod?.nome_vendedor || '-'}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(a.quantidade_aplicada, 2)} {a.unidade_medida}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(a.valor_unitario)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold text-blue-700">{formatarMoeda(a.custo_por_animal)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(a.quantidade_animais, 0)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-bold text-emerald-700">{formatarMoeda(a.custo_total)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-emerald-100">
                      <TableCell colSpan={8} className="text-xs py-1 border border-black font-bold text-right">CUSTO TOTAL DOS MEDICAMENTOS:</TableCell>
                      <TableCell className="text-xs py-1 border border-black text-right font-mono font-bold text-emerald-800">{formatarMoeda(custoTotalMedicamentos)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-blue-100">
                      <TableCell colSpan={8} className="text-xs py-1 border border-black font-bold text-right">CUSTO POR ANIMAL:</TableCell>
                      <TableCell className="text-xs py-1 border border-black text-right font-mono font-bold text-blue-800">
                        {formatarMoeda(loteAtual.quantidade_animais > 0 ? custoTotalMedicamentos / loteAtual.quantidade_animais : 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Seção 3: Projeção de Ganho e Retorno */}
          {loteAtual && precoArroba > 0 && resultados.length > 0 && (
            <>
              <Card className="mb-3">
                <CardHeader className="py-2 px-3 bg-slate-100">
                  <CardTitle className="text-sm font-bold">3. PROJEÇÃO DE GANHO E RETORNO</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs font-bold py-1 border border-black">Período</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">GMD (kg/dia)</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Ganho Total (kg)</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Arrobas (@)</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Peso Final Médio (kg)</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Total</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor Produzido</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Lucro Bruto</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Lucro/Animal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultados.map(r => (
                        <TableRow key={r.dias} className="hover:bg-gray-50">
                          <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{r.dias} dias</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(r.gmd, 3)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(r.ganhoTotal, 2)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(r.arrobasProduzidas, 2)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{formatarNumero(r.pesoFinal, 2)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(r.custoTotal)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold text-blue-700">{formatarMoeda(r.valorGerado)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-bold text-emerald-700">{formatarMoeda(r.lucroBruto)}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(r.lucroPorAnimal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Conclusão Automática */}
              <Card className="bg-emerald-50 border-emerald-200 mb-3">
                <CardHeader className="py-2 px-3 bg-emerald-100">
                  <CardTitle className="text-sm font-bold text-emerald-800">4. CONCLUSÃO DA ANÁLISE</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <p className="text-sm text-emerald-900 leading-relaxed">
                    Com base no preço da arroba atual de <strong>{formatarMoeda(precoArroba)}</strong>, 
                    o lote de <strong>{formatarNumero(loteAtual.quantidade_animais, 0)} animais</strong> (peso médio inicial: <strong>{formatarNumero(loteAtual.peso_medio_atual, 2)} kg</strong>) pode gerar entre{' '}
                    <strong className="text-emerald-700">{formatarMoeda(resultados[0]?.lucroBruto)}</strong> e{' '}
                    <strong className="text-emerald-700">{formatarMoeda(resultados[resultados.length - 1]?.lucroBruto)}</strong> de lucro 
                    em {resultados[resultados.length - 1]?.dias} dias, descontando o custo de <strong>{formatarMoeda(custoTotalMedicamentos)}</strong> em medicamentos 
                    (<strong>{formatarMoeda(custoTotalMedicamentos / loteAtual.quantidade_animais)}</strong> por animal).
                  </p>
                  
                  <div className="mt-3 pt-3 border-t border-emerald-300">
                    <p className="text-xs font-semibold text-emerald-800 mb-2">Resumo por Período:</p>
                    <div className="grid grid-cols-3 gap-2">
                      {resultados.map(r => (
                        <div key={r.dias} className="bg-white rounded p-2 border border-emerald-300">
                          <div className="font-bold text-emerald-800 text-xs">{r.dias} dias</div>
                          <div className="text-[11px] text-emerald-700">GMD: {formatarNumero(r.gmd, 3)} kg/dia</div>
                          <div className="text-[11px] text-emerald-600">Peso final: {formatarNumero(r.pesoFinal, 2)} kg</div>
                          <div className="text-[11px] text-blue-700 font-semibold">Lucro: {formatarMoeda(r.lucroBruto)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Rodapé */}
              <div className="mt-4 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
                <p>Relatório emitido em: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Gráficos - Apenas na Tela */}
      {loteAtual && precoArroba > 0 && resultados.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 no-print mt-4">
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
                  <Tooltip formatter={(value) => formatarNumero(value, 0)} />
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
                  <Tooltip formatter={(value) => formatarMoeda(value)} />
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
                  <Tooltip formatter={(value) => `${formatarNumero(value, 0)} kg`} />
                  <Line type="monotone" dataKey="Peso Médio" stroke="#0ea5e9" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
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