import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";

// ========== CONFIGURAÇÕES ==========
const TIPOS_MOVIMENTACAO = [
  { value: '', label: 'Todos' },
  { value: 'Entrada', label: 'Entrada' },
  { value: 'Saída', label: 'Saída' },
  { value: 'Transferência', label: 'Transferência' },
  { value: 'Ajuste', label: 'Ajuste' }
];

const OPERACOES_POR_TIPO = {
  'Entrada': ['compra', 'compra_vista', 'devolucao_cliente', 'bonificacao', 'doacao_recebida', 'producao_entrada', 'transferencia_recebida', 'ajuste_positivo', 'outros_entrada'],
  'Saída': ['venda', 'venda_vista', 'consumo_interno', 'suplementacao', 'aplicacao_area', 'manutencao', 'doacao', 'perda', 'quebra', 'transferencia_enviada', 'ajuste_negativo', 'outros_saida'],
  'Transferência': ['entre_locais', 'outros_transferencia'],
  'Ajuste': ['ajuste_positivo', 'ajuste_negativo', 'inventario', 'correcao']
};

// ========== FUNÇÕES AUXILIARES ==========
const calcularSaldoPorProdutoELocal = (movimentacoes, produtos) => {
  const saldos = {};

  // Inicializar produtos
  produtos.forEach(p => {
    saldos[p.id] = { 
      produto: p, 
      total: 0, 
      porLocal: {},
      totalEntradas: 0,
      totalSaidas: 0
    };
  });

  movimentacoes.forEach(mov => {
    if (!mov.produto_id || !saldos[mov.produto_id]) return;

    const qtd = mov.quantidade || 0;
    const origemId = mov.local_estoque_origem_id;
    const destinoId = mov.local_estoque_destino_id;

    if (mov.tipo_movimentacao === 'Entrada') {
      saldos[mov.produto_id].total += qtd;
      saldos[mov.produto_id].totalEntradas += qtd;
      if (destinoId) {
        if (!saldos[mov.produto_id].porLocal[destinoId]) saldos[mov.produto_id].porLocal[destinoId] = 0;
        saldos[mov.produto_id].porLocal[destinoId] += qtd;
      }
    } else if (mov.tipo_movimentacao === 'Saída') {
      saldos[mov.produto_id].total -= qtd;
      saldos[mov.produto_id].totalSaidas += qtd;
      if (origemId) {
        if (!saldos[mov.produto_id].porLocal[origemId]) saldos[mov.produto_id].porLocal[origemId] = 0;
        saldos[mov.produto_id].porLocal[origemId] -= qtd;
      }
    } else if (mov.tipo_movimentacao === 'Transferência') {
      if (origemId) {
        if (!saldos[mov.produto_id].porLocal[origemId]) saldos[mov.produto_id].porLocal[origemId] = 0;
        saldos[mov.produto_id].porLocal[origemId] -= qtd;
      }
      if (destinoId) {
        if (!saldos[mov.produto_id].porLocal[destinoId]) saldos[mov.produto_id].porLocal[destinoId] = 0;
        saldos[mov.produto_id].porLocal[destinoId] += qtd;
      }
    } else if (mov.tipo_movimentacao === 'Ajuste') {
      const localId = destinoId || origemId;
      const isPositivo = mov.tipo_detalhado?.toLowerCase().includes('positivo') || mov.tipo_detalhado?.toLowerCase().includes('inventário');
      if (isPositivo) {
        saldos[mov.produto_id].total += qtd;
        saldos[mov.produto_id].totalEntradas += qtd;
        if (localId) {
          if (!saldos[mov.produto_id].porLocal[localId]) saldos[mov.produto_id].porLocal[localId] = 0;
          saldos[mov.produto_id].porLocal[localId] += qtd;
        }
      } else {
        saldos[mov.produto_id].total -= qtd;
        saldos[mov.produto_id].totalSaidas += qtd;
        if (localId) {
          if (!saldos[mov.produto_id].porLocal[localId]) saldos[mov.produto_id].porLocal[localId] = 0;
          saldos[mov.produto_id].porLocal[localId] -= qtd;
        }
      }
    }
  });

  return saldos;
};

const filtrarMovimentacoes = (movimentacoes, filtros) => {
  return movimentacoes.filter(mov => {
    // Período
    if (filtros.dataInicial) {
      const dataInicio = new Date(filtros.dataInicial);
      const dataMov = new Date(mov.data_movimentacao);
      if (dataMov < dataInicio) return false;
    }
    if (filtros.dataFinal) {
      const dataFim = new Date(filtros.dataFinal);
      dataFim.setHours(23, 59, 59, 999);
      const dataMov = new Date(mov.data_movimentacao);
      if (dataMov > dataFim) return false;
    }

    // Local
    if (filtros.localId && filtros.localId !== 'todos') {
      const matchOrigem = mov.local_estoque_origem_id === filtros.localId;
      const matchDestino = mov.local_estoque_destino_id === filtros.localId;
      if (!matchOrigem && !matchDestino) return false;
    }

    // Produto
    if (filtros.produtoId && filtros.produtoId !== 'todos') {
      if (mov.produto_id !== filtros.produtoId) return false;
    }

    // Busca por texto (produto)
    if (filtros.buscaProduto) {
      const busca = filtros.buscaProduto.toLowerCase();
      const matchNome = mov.produto_nome?.toLowerCase().includes(busca);
      const matchCodigo = mov.produto_codigo?.toLowerCase().includes(busca);
      if (!matchNome && !matchCodigo) return false;
    }

    // Tipo
    if (filtros.tipo && filtros.tipo !== 'todos') {
      if (mov.tipo_movimentacao !== filtros.tipo) return false;
    }

    // Tipo detalhado
    if (filtros.tipoDetalhado && filtros.tipoDetalhado !== 'todos') {
      if (mov.tipo_detalhado !== filtros.tipoDetalhado) return false;
    }

    // Centro de custo
    if (filtros.centroCustoId && filtros.centroCustoId !== 'todos') {
      if (mov.centro_custo_id !== filtros.centroCustoId) return false;
    }

    // Fornecedor/Cliente
    if (filtros.parceiroId && filtros.parceiroId !== 'todos') {
      if (mov.fornecedor_id !== filtros.parceiroId && mov.cliente_id !== filtros.parceiroId) return false;
    }

    return true;
  });
};

export default function RelatorioEstoque() {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const [abaAtiva, setAbaAtiva] = useState('saldo');
  const [filtrosAplicados, setFiltrosAplicados] = useState({});
  const [carregando, setCarregando] = useState(false);

  // Filtros temporários (antes de aplicar)
  const [filtros, setFiltros] = useState({
    dataInicial: '',
    dataFinal: '',
    localId: 'todos',
    produtoId: 'todos',
    buscaProduto: '',
    tipo: 'todos',
    tipoDetalhado: 'todos',
    centroCustoId: 'todos',
    parceiroId: 'todos',
    apenasComSaldo: false,
    apenasSaldoNegativo: false
  });

  // ========== QUERIES ==========
  const { data: movimentacoes = [], isLoading: loadingMov } = useQuery({
    queryKey: ['movimentacoes_relatorio', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaId && m.status === 'Ativa');
    },
    enabled: !!empresaId
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_relatorio', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaId);
    },
    enabled: !!empresaId
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais_relatorio'],
    queryFn: () => base44.entities.LocalEstoque.list()
  });

  const { data: centrosCusto = [] } = useQuery({
    queryKey: ['centros_relatorio', empresaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaId);
    },
    enabled: !!empresaId
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_relatorio', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaId);
    },
    enabled: !!empresaId
  });

  // ========== DADOS CALCULADOS ==========
  const movimentacoesFiltradas = useMemo(() => {
    return filtrarMovimentacoes(movimentacoes, filtrosAplicados);
  }, [movimentacoes, filtrosAplicados]);

  const saldos = useMemo(() => {
    return calcularSaldoPorProdutoELocal(movimentacoesFiltradas, produtos);
  }, [movimentacoesFiltradas, produtos]);

  const saldosTotais = useMemo(() => {
    return calcularSaldoPorProdutoELocal(movimentacoes, produtos);
  }, [movimentacoes, produtos]);

  // Lista de saldos para exibição
  const listaSaldos = useMemo(() => {
    let lista = Object.values(saldosTotais).map(s => ({
      ...s,
      saldoNoLocal: filtrosAplicados.localId && filtrosAplicados.localId !== 'todos' 
        ? (s.porLocal[filtrosAplicados.localId] || 0) 
        : null
    }));

    // Filtrar por busca de produto
    if (filtrosAplicados.buscaProduto) {
      const busca = filtrosAplicados.buscaProduto.toLowerCase();
      lista = lista.filter(s => 
        s.produto.nome_produto?.toLowerCase().includes(busca) ||
        s.produto.codigo_interno?.toLowerCase().includes(busca) ||
        s.produto.codigo_barras?.toLowerCase().includes(busca)
      );
    }

    // Filtrar apenas com saldo
    if (filtrosAplicados.apenasComSaldo) {
      lista = lista.filter(s => {
        if (filtrosAplicados.localId && filtrosAplicados.localId !== 'todos') {
          return (s.porLocal[filtrosAplicados.localId] || 0) > 0;
        }
        return s.total > 0;
      });
    }

    // Filtrar saldo negativo
    if (filtrosAplicados.apenasSaldoNegativo) {
      lista = lista.filter(s => {
        if (filtrosAplicados.localId && filtrosAplicados.localId !== 'todos') {
          return (s.porLocal[filtrosAplicados.localId] || 0) < 0;
        }
        return s.total < 0;
      });
    }

    return lista.sort((a, b) => a.produto.nome_produto?.localeCompare(b.produto.nome_produto || ''));
  }, [saldosTotais, filtrosAplicados]);

  // Resumo por período
  const resumoPeriodo = useMemo(() => {
    const resumo = {};

    movimentacoesFiltradas.forEach(mov => {
      if (!mov.produto_id) return;

      const key = mov.produto_id;
      if (!resumo[key]) {
        resumo[key] = {
          produto_id: mov.produto_id,
          produto_nome: mov.produto_nome,
          produto_codigo: mov.produto_codigo,
          unidade: mov.unidade_medida,
          entradas: 0,
          saidas: 0,
          saldo: 0
        };
      }

      const qtd = mov.quantidade || 0;

      if (mov.tipo_movimentacao === 'Entrada') {
        resumo[key].entradas += qtd;
        resumo[key].saldo += qtd;
      } else if (mov.tipo_movimentacao === 'Saída') {
        resumo[key].saidas += qtd;
        resumo[key].saldo -= qtd;
      } else if (mov.tipo_movimentacao === 'Ajuste') {
        const isPositivo = mov.tipo_detalhado?.toLowerCase().includes('positivo');
        if (isPositivo) {
          resumo[key].entradas += qtd;
          resumo[key].saldo += qtd;
        } else {
          resumo[key].saidas += qtd;
          resumo[key].saldo -= qtd;
        }
      }
    });

    return Object.values(resumo).sort((a, b) => a.produto_nome?.localeCompare(b.produto_nome || ''));
  }, [movimentacoesFiltradas]);

  // Totalizadores
  const totalizadores = useMemo(() => {
    return {
      totalEntradas: movimentacoesFiltradas.filter(m => m.tipo_movimentacao === 'Entrada' || (m.tipo_movimentacao === 'Ajuste' && m.tipo_detalhado?.toLowerCase().includes('positivo'))).reduce((s, m) => s + (m.quantidade || 0), 0),
      totalSaidas: movimentacoesFiltradas.filter(m => m.tipo_movimentacao === 'Saída' || (m.tipo_movimentacao === 'Ajuste' && !m.tipo_detalhado?.toLowerCase().includes('positivo'))).reduce((s, m) => s + (m.quantidade || 0), 0),
      totalMovimentacoes: movimentacoesFiltradas.length,
      saldoGeral: listaSaldos.reduce((s, item) => s + item.total, 0)
    };
  }, [movimentacoesFiltradas, listaSaldos]);

  // ========== HANDLERS ==========
  const handleAplicarFiltros = () => {
    setCarregando(true);
    setTimeout(() => {
      setFiltrosAplicados({ ...filtros });
      setCarregando(false);
    }, 100);
  };

  const handleLimparFiltros = () => {
    const limpo = {
      dataInicial: '',
      dataFinal: '',
      localId: 'todos',
      produtoId: 'todos',
      buscaProduto: '',
      tipo: 'todos',
      tipoDetalhado: 'todos',
      centroCustoId: 'todos',
      parceiroId: 'todos',
      apenasComSaldo: false,
      apenasSaldoNegativo: false
    };
    setFiltros(limpo);
    setFiltrosAplicados({});
  };

  const tiposDetalhadosDisponiveis = useMemo(() => {
    if (!filtros.tipo || filtros.tipo === 'todos') return [];
    return OPERACOES_POR_TIPO[filtros.tipo] || [];
  }, [filtros.tipo]);

  const isLoading = loadingMov || carregando;

  // ========== RENDER ==========
  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Estoque</h1>
          <p className="text-xs text-slate-600">Saldos, movimentações e resumos</p>
        </div>
      </div>

      {/* FILTROS */}
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="py-2 px-3 bg-slate-100 border-b">
          <CardTitle className="text-sm font-semibold">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          {/* Linha 1 */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Data Inicial</Label>
              <Input 
                type="date" 
                value={filtros.dataInicial} 
                onChange={(e) => setFiltros(f => ({ ...f, dataInicial: e.target.value }))}
                className="h-8 text-xs w-full"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Final</Label>
              <Input 
                type="date" 
                value={filtros.dataFinal} 
                onChange={(e) => setFiltros(f => ({ ...f, dataFinal: e.target.value }))}
                className="h-8 text-xs w-full"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Local de Estoque</Label>
              <Select value={filtros.localId} onValueChange={(v) => setFiltros(f => ({ ...f, localId: v }))}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {locais.map(l => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">{l.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Produto</Label>
              <Select value={filtros.produtoId} onValueChange={(v) => setFiltros(f => ({ ...f, produtoId: v }))}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {produtos.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.nome_produto}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo Movimentação</Label>
              <Select value={filtros.tipo} onValueChange={(v) => setFiltros(f => ({ ...f, tipo: v, tipoDetalhado: 'todos' }))}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MOVIMENTACAO.map(t => (
                    <SelectItem key={t.value || 'todos'} value={t.value || 'todos'} className="text-xs">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo Detalhado</Label>
              <Select value={filtros.tipoDetalhado} onValueChange={(v) => setFiltros(f => ({ ...f, tipoDetalhado: v }))} disabled={filtros.tipo === 'todos'}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {tiposDetalhadosDisponiveis.map(t => (
                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Linha 2 */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Centro de Custo</Label>
              <Select value={filtros.centroCustoId} onValueChange={(v) => setFiltros(f => ({ ...f, centroCustoId: v }))}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {centrosCusto.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fornecedor/Cliente</Label>
              <Select value={filtros.parceiroId} onValueChange={(v) => setFiltros(f => ({ ...f, parceiroId: v }))}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {fornecedores.map(f => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Buscar Produto</Label>
              <Input 
                value={filtros.buscaProduto} 
                onChange={(e) => setFiltros(f => ({ ...f, buscaProduto: e.target.value }))}
                placeholder="Nome, código interno ou barras..."
                className="h-8 text-xs w-full"
              />
            </div>
            <div className="flex items-end gap-4">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="apenasComSaldo" 
                  checked={filtros.apenasComSaldo}
                  onCheckedChange={(v) => setFiltros(f => ({ ...f, apenasComSaldo: v, apenasSaldoNegativo: v ? false : f.apenasSaldoNegativo }))}
                />
                <Label htmlFor="apenasComSaldo" className="text-xs">Saldo {'>'} 0</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="apenasSaldoNegativo" 
                  checked={filtros.apenasSaldoNegativo}
                  onCheckedChange={(v) => setFiltros(f => ({ ...f, apenasSaldoNegativo: v, apenasComSaldo: v ? false : f.apenasComSaldo }))}
                />
                <Label htmlFor="apenasSaldoNegativo" className="text-xs">Saldo {'<'} 0</Label>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleAplicarFiltros}>
                Aplicar Filtros
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleLimparFiltros}>
                Limpar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ABAS */}
      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <TabsList className="grid w-full grid-cols-3 h-9">
          <TabsTrigger value="saldo" className="text-xs">Saldo Atual</TabsTrigger>
          <TabsTrigger value="extrato" className="text-xs">Extrato de Movimentações</TabsTrigger>
          <TabsTrigger value="resumo" className="text-xs">Resumo por Período</TabsTrigger>
        </TabsList>

        {/* ABA SALDO ATUAL */}
        <TabsContent value="saldo">
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="py-2 px-3 bg-slate-100 border-b">
              <CardTitle className="text-sm font-semibold">
                Saldo Atual por Produto {filtrosAplicados.localId && filtrosAplicados.localId !== 'todos' && `(Local: ${locais.find(l => l.id === filtrosAplicados.localId)?.nome})`}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500">Carregando...</div>
              ) : listaSaldos.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">Nenhum produto encontrado</div>
              ) : (
                <>
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Total Entradas</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Total Saídas</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Saldo Total</TableHead>
                          {filtrosAplicados.localId && filtrosAplicados.localId !== 'todos' && (
                            <TableHead className="text-xs font-bold py-1 border border-black text-right">Saldo no Local</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {listaSaldos.map((item, idx) => (
                          <TableRow key={item.produto.id} className="hover:bg-gray-50">
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto.nome_produto}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto.codigo_interno || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto.unidade_medida || 'UN'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right">{item.totalEntradas.toFixed(2)}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right">{item.totalSaidas.toFixed(2)}</TableCell>
                            <TableCell className={`text-xs py-1 border border-gray-300 text-right font-semibold ${item.total < 0 ? 'text-red-600' : ''}`}>
                              {item.total.toFixed(2)}
                            </TableCell>
                            {filtrosAplicados.localId && filtrosAplicados.localId !== 'todos' && (
                              <TableCell className={`text-xs py-1 border border-gray-300 text-right font-semibold ${item.saldoNoLocal < 0 ? 'text-red-600' : ''}`}>
                                {(item.saldoNoLocal || 0).toFixed(2)}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="bg-slate-100 p-2 border-t flex justify-end gap-4 text-xs">
                    <span>Produtos: {listaSaldos.length}</span>
                    <span className="font-semibold">Saldo Geral: {totalizadores.saldoGeral.toFixed(2)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA EXTRATO */}
        <TabsContent value="extrato">
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="py-2 px-3 bg-slate-100 border-b">
              <CardTitle className="text-sm font-semibold">Extrato de Movimentações ({movimentacoesFiltradas.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500">Carregando...</div>
              ) : movimentacoesFiltradas.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">Nenhuma movimentação encontrada</div>
              ) : (
                <>
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Operação</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Origem</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Destino</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">C. Custo</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Documento</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Forn./Cliente</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movimentacoesFiltradas.slice(0, 200).map((mov, idx) => (
                          <TableRow key={mov.id} className="hover:bg-gray-50">
                            <TableCell className="text-xs py-1 border border-gray-300">
                              {mov.data_movimentacao ? format(new Date(mov.data_movimentacao), 'dd/MM/yyyy') : '-'}
                            </TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.tipo_movimentacao}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.tipo_detalhado || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.produto_nome}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.produto_codigo || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right">{mov.quantidade?.toFixed(2)}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.unidade_medida || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.local_estoque_origem || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.local_estoque_destino || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.centro_custo_nome || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">
                              {mov.numero_documento ? `${mov.tipo_documento || ''} ${mov.numero_documento}` : '-'}
                            </TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{mov.fornecedor_nome || mov.cliente_nome || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {movimentacoesFiltradas.length > 200 && (
                    <div className="p-2 text-center text-xs text-amber-600 bg-amber-50 border-t">
                      Exibindo 200 de {movimentacoesFiltradas.length} registros. Refine os filtros para ver menos dados.
                    </div>
                  )}
                  <div className="bg-slate-100 p-2 border-t flex justify-end gap-4 text-xs">
                    <span>Total Movimentações: {totalizadores.totalMovimentacoes}</span>
                    <span>Entradas: {totalizadores.totalEntradas.toFixed(2)}</span>
                    <span>Saídas: {totalizadores.totalSaidas.toFixed(2)}</span>
                    <span className="font-semibold">Saldo: {(totalizadores.totalEntradas - totalizadores.totalSaidas).toFixed(2)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA RESUMO */}
        <TabsContent value="resumo">
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="py-2 px-3 bg-slate-100 border-b">
              <CardTitle className="text-sm font-semibold">
                Resumo por Período 
                {filtrosAplicados.dataInicial && ` (${format(new Date(filtrosAplicados.dataInicial), 'dd/MM/yyyy')}`}
                {filtrosAplicados.dataFinal && ` a ${format(new Date(filtrosAplicados.dataFinal), 'dd/MM/yyyy')})`}
                {!filtrosAplicados.dataInicial && !filtrosAplicados.dataFinal && ' (Todos os períodos)'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500">Carregando...</div>
              ) : resumoPeriodo.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">Nenhum dado encontrado para o período</div>
              ) : (
                <>
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Entradas</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Saídas</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Saldo Período</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resumoPeriodo.map((item, idx) => (
                          <TableRow key={item.produto_id} className="hover:bg-gray-50">
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto_nome}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto_codigo || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.unidade || 'UN'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right text-emerald-600">{item.entradas.toFixed(2)}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right text-red-600">{item.saidas.toFixed(2)}</TableCell>
                            <TableCell className={`text-xs py-1 border border-gray-300 text-right font-semibold ${item.saldo < 0 ? 'text-red-600' : ''}`}>
                              {item.saldo.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="bg-slate-100 p-2 border-t flex justify-end gap-4 text-xs">
                    <span>Produtos: {resumoPeriodo.length}</span>
                    <span className="text-emerald-600">Total Entradas: {resumoPeriodo.reduce((s, i) => s + i.entradas, 0).toFixed(2)}</span>
                    <span className="text-red-600">Total Saídas: {resumoPeriodo.reduce((s, i) => s + i.saidas, 0).toFixed(2)}</span>
                    <span className="font-semibold">Saldo: {resumoPeriodo.reduce((s, i) => s + i.saldo, 0).toFixed(2)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}