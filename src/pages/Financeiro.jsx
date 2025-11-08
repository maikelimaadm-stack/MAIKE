import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Plus, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import FormularioFinanceiro from "../components/financeiro/FormularioFinanceiro.jsx";
import TabelaFinanceiro from "../components/financeiro/TabelaFinanceiro.jsx";
import BaixaFinanceira from "../components/financeiro/BaixaFinanceira.jsx";

const getNextNumber = async (empresaId) => {
  const all = await base44.entities.LancamentoFinanceiro.list();
  const filtered = all.filter(l => l.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_lancamento) || 0), 0);
  return maxNum + 1;
};

export default function Financeiro() {
  const [tipoAba, setTipoAba] = useState("pagar");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showBaixa, setShowBaixa] = useState(false);
  const [itemBaixa, setItemBaixa] = useState(null);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ['lancamentos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list('nome');
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list('nome_produto');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: safras = [] } = useQuery({
    queryKey: ['safras_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const numero = await getNextNumber(empresaSelecionadaId);
      
      const valorTotal = (data.valor_original || 0) + (data.valor_juros || 0) + (data.valor_multa || 0) - (data.valor_desconto || 0);
      
      const lancamento = {
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_lancamento: String(numero),
        valor_total: valorTotal,
        valor_pago: 0,
        valor_saldo: valorTotal,
        status: 'Pendente'
      };

      if (data.total_parcelas && data.total_parcelas > 1) {
        const lancamentoPai = await base44.entities.LancamentoFinanceiro.create(lancamento);
        
        const valorParcela = valorTotal / data.total_parcelas;
        const parcelas = [];
        
        for (let i = 1; i <= data.total_parcelas; i++) {
          const numeroParcela = await getNextNumber(empresaSelecionadaId);
          const dataVencimento = new Date(data.data_vencimento);
          dataVencimento.setMonth(dataVencimento.getMonth() + (i - 1));
          
          parcelas.push({
            ...lancamento,
            numero_lancamento: String(numeroParcela),
            valor_original: valorParcela,
            valor_total: valorParcela,
            valor_saldo: valorParcela,
            data_vencimento: dataVencimento.toISOString().split('T')[0],
            numero_parcela: i,
            total_parcelas: data.total_parcelas,
            lancamento_pai_id: lancamentoPai.id
          });
        }
        
        await base44.entities.LancamentoFinanceiro.bulkCreate(parcelas);
        return lancamentoPai;
      } else {
        return base44.entities.LancamentoFinanceiro.create(lancamento);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setShowForm(false);
      setEditingItem(null);
      toast.success('Lançamento cadastrado com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar lançamento.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      const valorTotal = (data.valor_original || 0) + (data.valor_juros || 0) + (data.valor_multa || 0) - (data.valor_desconto || 0);
      return base44.entities.LancamentoFinanceiro.update(id, { ...data, valor_total: valorTotal });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setShowForm(false);
      setEditingItem(null);
      toast.success('Lançamento atualizado!');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const baixas = await base44.entities.BaixaFinanceira.list();
      const temBaixas = baixas.some(b => b.lancamento_id === id);
      if (temBaixas) {
        throw new Error('❌ EXCLUSÃO BLOQUEADA! Este lançamento possui baixas financeiras. Não é possível excluir.');
      }
      return base44.entities.LancamentoFinanceiro.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('Lançamento excluído!');
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const handleSubmit = (data) => {
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ Deseja realmente excluir este lançamento?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleBaixa = (item) => {
    setItemBaixa(item);
    setShowBaixa(true);
  };

  const lancamentosPagar = lancamentos.filter(l => l.tipo === 'Pagar' && !l.lancamento_pai_id);
  const lancamentosReceber = lancamentos.filter(l => l.tipo === 'Receber' && !l.lancamento_pai_id);

  const estatisticas = useMemo(() => {
    const contasPagar = lancamentosPagar.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado');
    const contasReceber = lancamentosReceber.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado');
    const vencidos = lancamentos.filter(l => new Date(l.data_vencimento) < new Date() && l.status === 'Pendente');
    
    return {
      totalPagar: contasPagar.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      totalReceber: contasReceber.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      totalVencidos: vencidos.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      qtdVencidos: vencidos.length
    };
  }, [lancamentos, lancamentosPagar, lancamentosReceber]);

  const formatarMoeda = (valor) => {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-green-900">Controle Financeiro</h1>
          <p className="text-green-700">Gerenciar contas a pagar e receber</p>
        </div>
        {!showForm && !showBaixa && (
          <Button onClick={() => { setEditingItem(null); setShowForm(true); }} className="bg-green-600 gap-2">
            <Plus className="w-5 h-5" />
            Novo Lançamento
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-red-200 bg-gradient-to-br from-white to-red-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Contas a Pagar</CardTitle>
            <TrendingDown className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-900">{formatarMoeda(estatisticas.totalPagar)}</div>
            <p className="text-xs text-red-600 mt-1">{lancamentosPagar.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado').length} título(s)</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Contas a Receber</CardTitle>
            <TrendingUp className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{formatarMoeda(estatisticas.totalReceber)}</div>
            <p className="text-xs text-green-600 mt-1">{lancamentosReceber.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado').length} título(s)</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-orange-200 bg-gradient-to-br from-white to-orange-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Títulos Vencidos</CardTitle>
            <AlertCircle className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-900">{formatarMoeda(estatisticas.totalVencidos)}</div>
            <p className="text-xs text-orange-600 mt-1">⚠️ {estatisticas.qtdVencidos} título(s)</p>
          </CardContent>
        </Card>
      </div>

      {showForm && (
        <FormularioFinanceiro
          onSubmit={handleSubmit}
          onCancel={() => { setShowForm(false); setEditingItem(null); }}
          initialData={editingItem}
          fornecedores={fornecedores}
          produtos={produtos}
          safras={safras}
        />
      )}

      {showBaixa && (
        <BaixaFinanceira
          lancamento={itemBaixa}
          onClose={() => { setShowBaixa(false); setItemBaixa(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
            setShowBaixa(false);
            setItemBaixa(null);
          }}
        />
      )}

      {!showForm && !showBaixa && (
        <Tabs value={tipoAba} onValueChange={setTipoAba}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="pagar" className="gap-2">
              <TrendingDown className="w-4 h-4" />
              Contas a Pagar ({lancamentosPagar.length})
            </TabsTrigger>
            <TabsTrigger value="receber" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              Contas a Receber ({lancamentosReceber.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pagar">
            <TabelaFinanceiro
              lancamentos={lancamentosPagar}
              tipo="Pagar"
              onEdit={handleEdit}
              onDelete={handleDelete}
              onBaixa={handleBaixa}
              isLoading={isLoading}
            />
          </TabsContent>

          <TabsContent value="receber">
            <TabelaFinanceiro
              lancamentos={lancamentosReceber}
              tipo="Receber"
              onEdit={handleEdit}
              onDelete={handleDelete}
              onBaixa={handleBaixa}
              isLoading={isLoading}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}