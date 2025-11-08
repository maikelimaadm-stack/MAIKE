import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRightLeft, TrendingUp, TrendingDown, Package, Download, AlertTriangle } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

import FormularioMovimentacao from "../components/movimentacoes/FormularioMovimentacao";
import TabelaMovimentacoes from "../components/movimentacoes/TabelaMovimentacoes";

const getNextSystemNumber = async () => {
  try {
    const [pesagens, fornecedores, produtos, movimentacoes] = await Promise.all([
      base44.entities.Pesagem.list(),
      base44.entities.Fornecedor.list(),
      base44.entities.Produto.list(),
      base44.entities.MovimentacaoEstoque.list()
    ]);

    const numeros = [
      ...pesagens.map(p => parseInt(p.numero_registro) || 0),
      ...fornecedores.map(f => parseInt(f.numero_cadastro) || 0),
      ...produtos.map(p => parseInt(p.numero_produto) || 0),
      ...movimentacoes.map(m => parseInt(m.numero_movimentacao) || 0)
    ].filter(n => n > 0 && n < 1000000000);

    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    console.error('Erro ao obter próximo número:', error);
    return 1;
  }
};

const calcularCustoMedio = (estoqueAtual, custoMedioAtual, quantidadeEntrada, custoEntrada) => {
  if (estoqueAtual === 0 || !custoMedioAtual) return custoEntrada;
  
  const valorTotalAtual = estoqueAtual * custoMedioAtual;
  const valorTotalEntrada = quantidadeEntrada * custoEntrada;
  const novoEstoque = estoqueAtual + quantidadeEntrada;
  
  return (valorTotalAtual + valorTotalEntrada) / novoEstoque;
};

export default function MovimentacoesEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingMovimentacao, setEditingMovimentacao] = useState(null);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: movimentacoes, isLoading } = useQuery({
    queryKey: ['movimentacoes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-created_date');
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status !== 'Cancelada');
    },
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    const numerarMovimentacoes = async () => {
      const movSemNumero = movimentacoes.filter(m => !m.numero_movimentacao || m.numero_movimentacao === '');
      
      if (movSemNumero.length > 0) {
        for (const mov of movSemNumero) {
          try {
            const proximoNumero = await getNextSystemNumber();
            await base44.entities.MovimentacaoEstoque.update(mov.id, {
              numero_movimentacao: String(proximoNumero)
            });
          } catch (error) {
            console.error(`Erro ao numerar:`, error);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      }
    };

    if (!isLoading && movimentacoes.length > 0) {
      numerarMovimentacoes();
    }
  }, [movimentacoes, isLoading, queryClient]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const produto = produtos.find(p => p.id === data.produto_id);
      if (!produto) throw new Error('Produto não encontrado');

      const estoqueAtual = produto.estoque_atual || 0;
      const custoMedioAtual = produto.preco_custo || 0;
      let novoEstoque = estoqueAtual;
      let novoCustoMedio = custoMedioAtual;

      if (data.tipo_movimentacao === 'Entrada') {
        novoEstoque = estoqueAtual + data.quantidade;
        if (data.tipo_detalhado === 'Compra' && data.valor_unitario) {
          novoCustoMedio = calcularCustoMedio(estoqueAtual, custoMedioAtual, data.quantidade, data.valor_unitario);
        }
      } else if (data.tipo_movimentacao === 'Saída' || data.tipo_movimentacao === 'Transferência') {
        novoEstoque = estoqueAtual - data.quantidade;
      } else if (data.tipo_movimentacao === 'Ajuste') {
        if (data.tipo_detalhado.includes('Positivo')) {
          novoEstoque = estoqueAtual + data.quantidade;
        } else {
          novoEstoque = estoqueAtual - data.quantidade;
        }
      }

      data.saldo_antes = estoqueAtual;
      data.saldo_depois = novoEstoque;
      data.custo_medio_antes = custoMedioAtual;
      data.custo_medio_depois = novoCustoMedio;
      data.usuario_responsavel = user?.email || 'Sistema';
      data.status = 'Ativa';

      const result = await base44.entities.MovimentacaoEstoque.create(data);
      
      await base44.entities.Produto.update(produto.id, {
        estoque_atual: novoEstoque,
        preco_custo: novoCustoMedio
      });
      
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      setShowForm(false);
      setEditingMovimentacao(null);
      toast.success('✅ Movimentação registrada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao registrar');
    }
  });

  const handleSubmit = async (formData) => {
    const produto = produtos.find(p => p.id === formData.produto_id);
    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const centro = centros.find(c => c.id === formData.centro_custo_id);
    
    const data = {
      empresa_id: empresaSelecionadaId,
      tipo_movimentacao: formData.tipo_movimentacao,
      tipo_detalhado: formData.tipo_detalhado,
      data_movimentacao: formData.data_movimentacao,
      produto_id: formData.produto_id,
      produto_nome: produto?.nome_produto,
      produto_codigo: produto?.codigo_interno,
      quantidade: formData.quantidade,
      unidade_medida: produto?.unidade_medida,
      local_estoque_origem: formData.local_estoque_origem || undefined,
      local_estoque_destino: formData.local_estoque_destino || undefined,
      valor_unitario: formData.valor_unitario || undefined,
      valor_total: formData.valor_total || undefined,
      tipo_documento: formData.tipo_documento,
      numero_documento: formData.numero_documento?.toUpperCase() || undefined,
      chave_documento: formData.chave_documento || undefined,
      serie_documento: formData.serie_documento || undefined,
      data_documento: formData.data_documento || undefined,
      fornecedor_id: formData.fornecedor_id || undefined,
      fornecedor_nome: fornecedor?.nome,
      cliente_nome: formData.cliente_nome?.toUpperCase() || undefined,
      motivo_movimentacao: formData.motivo_movimentacao?.toUpperCase(),
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome,
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      anexos: formData.anexos || []
    };

    if (!editingMovimentacao) {
      const proximoNumero = await getNextSystemNumber();
      data.numero_movimentacao = String(proximoNumero);
    }

    createMutation.mutate(data);
  };

  const handleEdit = (movimentacao) => {
    setEditingMovimentacao(movimentacao);
    setShowForm(true);
  };

  const handleCancel = async (id) => {
    const motivo = window.prompt('Informe o motivo do cancelamento:');
    if (!motivo) return;
    
    if (window.confirm('⚠️ ATENÇÃO: Esta movimentação será cancelada e o estoque revertido. Confirma?')) {
      try {
        const mov = movimentacoes.find(m => m.id === id);
        const produto = produtos.find(p => p.id === mov.produto_id);
        
        let novoEstoque = produto.estoque_atual || 0;
        if (mov.tipo_movimentacao === 'Entrada') novoEstoque -= mov.quantidade;
        else if (mov.tipo_movimentacao === 'Saída') novoEstoque += mov.quantidade;

        await base44.entities.MovimentacaoEstoque.update(id, {
          status: 'Cancelada',
          cancelado_por: user?.email || 'Sistema',
          data_cancelamento: new Date().toISOString(),
          motivo_cancelamento: motivo.toUpperCase()
        });

        await base44.entities.Produto.update(produto.id, { estoque_atual: novoEstoque });
        
        queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
        queryClient.invalidateQueries({ queryKey: ['produtos'] });
        toast.success('Movimentação cancelada!');
      } catch (error) {
        toast.error('Erro ao cancelar');
      }
    }
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Nº', 'Data/Hora', 'Tipo', 'Tipo Detalhado', 'Produto', 'Qtd', 'Origem', 'Destino', 'Documento', 'Motivo'];
    csvRows.push(headers.join(';'));

    movimentacoes.forEach(m => {
      const row = [
        m.numero_movimentacao,
        format(new Date(m.data_movimentacao), 'dd/MM/yyyy HH:mm'),
        m.tipo_movimentacao,
        m.tipo_detalhado,
        m.produto_nome,
        m.quantidade,
        m.local_estoque_origem || '',
        m.local_estoque_destino || '',
        m.numero_documento || '',
        m.motivo_movimentacao || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `movimentacoes_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  const totalMovimentacoes = movimentacoes.length;
  const totalEntradas = movimentacoes.filter(m => m.tipo_movimentacao === 'Entrada').length;
  const totalSaidas = movimentacoes.filter(m => m.tipo_movimentacao === 'Saída').length;
  const totalAjustes = movimentacoes.filter(m => m.tipo_movimentacao === 'Ajuste').length;
  const produtosEstoqueBaixo = produtos.filter(p => (p.estoque_atual || 0) <= (p.estoque_minimo || 0));

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total</CardTitle>
            <ArrowRightLeft className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalMovimentacoes}</div>
            <p className="text-xs text-green-600 mt-1">Movimentações ativas</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Entradas</CardTitle>
            <TrendingUp className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{totalEntradas}</div>
            <p className="text-xs text-blue-600 mt-1">Recebimentos</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-orange-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Saídas</CardTitle>
            <TrendingDown className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-900">{totalSaidas}</div>
            <p className="text-xs text-orange-600 mt-1">Vendas/Consumos</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Ajustes</CardTitle>
            <Package className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{totalAjustes}</div>
            <p className="text-xs text-purple-600 mt-1">Correções</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-red-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Alertas</CardTitle>
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-900">{produtosEstoqueBaixo.length}</div>
            <p className="text-xs text-red-600 mt-1">Estoque crítico</p>
          </CardContent>
        </Card>
      </div>

      {!showForm && (
        <div className="flex justify-between items-center">
          <Button onClick={handleExport} variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
          <Button onClick={() => { setEditingMovimentacao(null); setShowForm(true); }} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" size="lg">
            <Plus className="w-5 h-5" />
            Nova Movimentação
          </Button>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <FormularioMovimentacao
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingMovimentacao(null); }}
            initialData={editingMovimentacao}
            isEditing={!!editingMovimentacao}
            produtos={produtos}
            fornecedores={fornecedores}
          />
        )}
      </AnimatePresence>

      <TabelaMovimentacoes
        movimentacoes={movimentacoes}
        onEdit={handleEdit}
        onCancel={handleCancel}
        isLoading={isLoading}
      />
    </div>
  );
}