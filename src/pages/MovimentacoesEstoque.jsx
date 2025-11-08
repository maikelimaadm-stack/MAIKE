import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRightLeft, TrendingUp, TrendingDown, Package, Download, Upload, FileSpreadsheet } from "lucide-react";
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

    const nextNumber = numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
    return nextNumber;
  } catch (error) {
    console.error('Erro ao obter próximo número:', error);
    return 1;
  }
};

export default function MovimentacoesEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingMovimentacao, setEditingMovimentacao] = useState(null);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes, isLoading } = useQuery({
    queryKey: ['movimentacoes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-created_date');
      return all.filter(m => m.empresa_id === empresaSelecionadaId);
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
            console.error(`Erro ao numerar movimentação ${mov.id}:`, error);
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
      const result = await base44.entities.MovimentacaoEstoque.create(data);
      
      const produto = produtos.find(p => p.id === data.produto_id);
      if (produto) {
        let novoEstoque = produto.estoque_atual || 0;
        
        if (data.tipo_movimentacao === 'Entrada') {
          novoEstoque += data.quantidade;
        } else if (data.tipo_movimentacao === 'Saída') {
          novoEstoque -= data.quantidade;
        }
        
        await base44.entities.Produto.update(produto.id, {
          estoque_atual: novoEstoque
        });
      }
      
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      setShowForm(false);
      setEditingMovimentacao(null);
      toast.success('Movimentação registrada com sucesso!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MovimentacaoEstoque.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      setShowForm(false);
      setEditingMovimentacao(null);
      toast.success('Movimentação atualizada com sucesso!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MovimentacaoEstoque.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      toast.success('Movimentação excluída com sucesso!');
    },
  });

  const handleSubmit = async (formData) => {
    const produto = produtos.find(p => p.id === formData.produto_id);
    
    const data = {
      empresa_id: empresaSelecionadaId,
      tipo_movimentacao: formData.tipo_movimentacao,
      data_movimentacao: formData.data_movimentacao,
      produto_id: formData.produto_id,
      produto_nome: produto?.nome_produto,
      quantidade: parseFloat(formData.quantidade),
      unidade_medida: produto?.unidade_medida,
      local_estoque_origem: formData.local_estoque_origem || undefined,
      local_estoque_destino: formData.local_estoque_destino || undefined,
      numero_nfe: formData.numero_nfe?.toUpperCase() || undefined,
      chave_nfe: formData.chave_nfe || undefined,
      fornecedor_id: formData.fornecedor_id || undefined,
      fornecedor_nome: formData.fornecedor_id ? fornecedores.find(f => f.id === formData.fornecedor_id)?.nome : undefined,
      cliente_destino: formData.cliente_destino?.toUpperCase() || undefined,
      valor_unitario: formData.valor_unitario ? parseFloat(formData.valor_unitario) : undefined,
      valor_total: formData.valor_total ? parseFloat(formData.valor_total) : undefined,
      observacoes: formData.observacoes?.toUpperCase() || undefined
    };

    if (!editingMovimentacao) {
      const proximoNumero = await getNextSystemNumber();
      data.numero_movimentacao = String(proximoNumero);
    }

    if (editingMovimentacao) {
      updateMutation.mutate({ id: editingMovimentacao.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (movimentacao) => {
    setEditingMovimentacao(movimentacao);
    setShowForm(true);
  };

  const handleDelete = (id, skipConfirm = false) => {
    if (skipConfirm || window.confirm('⚠️ ATENÇÃO: Deseja realmente excluir esta movimentação? Esta ação não pode ser desfeita.')) {
      return deleteMutation.mutateAsync(id);
    }
    return Promise.reject('Cancelado');
  };

  const handleNew = () => {
    setEditingMovimentacao(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingMovimentacao(null);
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Tipo', 'Data', 'Produto', 'Quantidade', 'Local Origem', 'Local Destino', 'Nº NF-e', 'Fornecedor', 'Cliente/Destino', 'Valor Unit.', 'Valor Total', 'Observações'];
    csvRows.push(headers.join(';'));

    movimentacoes.forEach(m => {
      const row = [
        m.tipo_movimentacao,
        format(new Date(m.data_movimentacao), 'dd/MM/yyyy'),
        m.produto_nome,
        m.quantidade,
        m.local_estoque_origem || '',
        m.local_estoque_destino || '',
        m.numero_nfe || '',
        m.fornecedor_nome || '',
        m.cliente_destino || '',
        m.valor_unitario || '',
        m.valor_total || '',
        m.observacoes || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `movimentacoes_estoque_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Dados exportados com sucesso!');
  };

  const downloadTemplate = () => {
    const csvRows = [];
    const headers = ['Tipo', 'Data', 'Produto', 'Quantidade', 'Local Origem', 'Local Destino', 'Nº NF-e', 'Fornecedor', 'Cliente/Destino', 'Valor Unit.', 'Valor Total', 'Observações'];
    csvRows.push(headers.join(';'));
    
    const example = ['Entrada', '04/11/2025', 'PRODUTO EXEMPLO', '100', '', 'ARMAZÉM 1', '123456', 'FORNECEDOR EXEMPLO', '', '10.50', '1050.00', 'OBSERVAÇÕES'];
    csvRows.push(example.join(';'));

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_movimentacoes_estoque.csv';
    link.click();
  };

  const totalMovimentacoes = movimentacoes.length;
  const totalEntradas = movimentacoes.filter(m => m.tipo_movimentacao === 'Entrada').length;
  const totalSaidas = movimentacoes.filter(m => m.tipo_movimentacao === 'Saída').length;
  const totalTransferencias = movimentacoes.filter(m => m.tipo_movimentacao === 'Transferência').length;

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total</CardTitle>
            <ArrowRightLeft className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalMovimentacoes}</div>
            <p className="text-xs text-green-600 mt-1">Movimentações registradas</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Entradas</CardTitle>
            <TrendingUp className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{totalEntradas}</div>
            <p className="text-xs text-blue-600 mt-1">Entradas de estoque</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-orange-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Saídas</CardTitle>
            <TrendingDown className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-900">{totalSaidas}</div>
            <p className="text-xs text-orange-600 mt-1">Saídas de estoque</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Transferências</CardTitle>
            <Package className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{totalTransferencias}</div>
            <p className="text-xs text-purple-600 mt-1">Entre locais</p>
          </CardContent>
        </Card>
      </div>

      {!showForm && (
        <div className="flex justify-between items-center">
          <div className="flex gap-3">
            <Button onClick={handleExport} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Exportar CSV
            </Button>
            <Button onClick={downloadTemplate} variant="outline" className="gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              Baixar Modelo
            </Button>
          </div>
          <Button onClick={handleNew} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" size="lg">
            <Plus className="w-5 h-5" />
            Nova Movimentação
          </Button>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <FormularioMovimentacao
            onSubmit={handleSubmit}
            onCancel={handleCancelForm}
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
        onDelete={handleDelete}
        isLoading={isLoading}
      />
    </div>
  );
}