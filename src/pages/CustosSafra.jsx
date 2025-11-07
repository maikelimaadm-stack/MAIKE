import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp, DollarSign, Package, Users, Calendar, CheckCircle, Clock, Layers, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import TabelaCustos from "../components/custos/TabelaCustos";
import FormularioCusto from "../components/custos/FormularioCusto";
import LancarEntrega from "../components/custos/LancarEntrega";

export default function CustosSafra() {
  const [showSafraDialog, setShowSafraDialog] = useState(false);
  const [safraAtiva, setSafraAtiva] = useState(null);
  const [showCustoForm, setShowCustoForm] = useState(false);
  const [editingCusto, setEditingCusto] = useState(null);
  const [custoParaEntrega, setCustoParaEntrega] = useState(null);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  // Buscar safras
  const { data: safras = [] } = useQuery({
    queryKey: ['safras', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list('-created_date');
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Auto-selecionar primeira safra se não tiver nenhuma selecionada
  React.useEffect(() => {
    if (!safraAtiva && safras.length > 0) {
      const safraEmAndamento = safras.find(s => s.status === 'Em Andamento') || safras[0];
      setSafraAtiva(safraEmAndamento);
    }
  }, [safras, safraAtiva]);

  // Buscar custos da safra ativa
  const { data: custos = [] } = useQuery({
    queryKey: ['custos_safra', safraAtiva?.id],
    queryFn: async () => {
      if (!safraAtiva) return [];
      const all = await base44.entities.CustoSafra.list('-created_date');
      return all.filter(c => c.safra_id === safraAtiva.id);
    },
    enabled: !!safraAtiva,
  });

  // Buscar fornecedores
  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Buscar produtos
  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createCustoMutation = useMutation({
    mutationFn: (data) => base44.entities.CustoSafra.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
      setShowCustoForm(false);
      setEditingCusto(null);
      toast.success('Custo lançado com sucesso!');
    },
  });

  const updateCustoMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CustoSafra.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
      setShowCustoForm(false);
      setEditingCusto(null);
      toast.success('Custo atualizado com sucesso!');
    },
  });

  const deleteCustoMutation = useMutation({
    mutationFn: (id) => base44.entities.CustoSafra.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
      toast.success('Custo excluído com sucesso!');
    },
  });

  const handleCustoSubmit = (formData) => {
    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const produto = produtos.find(p => p.id === formData.produto_id);
    const quantidade = parseFloat(formData.quantidade);
    const valorUnitario = parseFloat(formData.valor_unitario);

    const data = {
      empresa_id: empresaSelecionadaId,
      safra_id: safraAtiva.id,
      fornecedor_id: formData.fornecedor_id,
      fornecedor_nome: fornecedor?.nome,
      produto_id: formData.produto_id,
      produto_nome: produto?.nome_produto,
      quantidade: quantidade,
      unidade_medida: produto?.unidade_medida,
      valor_unitario: valorUnitario,
      valor_total: quantidade * valorUnitario,
      prazo_entrega: formData.prazo_entrega || undefined,
      data_entrega: formData.data_entrega || undefined,
      status_entrega: formData.status_entrega,
      forma_pagamento: formData.forma_pagamento,
      observacoes: formData.observacoes,
      quantidade_entregue: 0, // Inicializar quantidade entregue
    };

    if (editingCusto) {
      updateCustoMutation.mutate({ id: editingCusto.id, data });
    } else {
      createCustoMutation.mutate(data);
    }
  };

  const handleDeleteCusto = async (id, skipConfirm = false) => {
    if (skipConfirm || window.confirm('Deseja excluir este lançamento?')) {
      deleteCustoMutation.mutate(id);
    }
  };

  const handlePrintCusto = (custo) => {
    console.log('Imprimir custo:', custo);
  };

  const handleLancarEntrega = (custo) => {
    setCustoParaEntrega(custo);
  };

  const formatarNumero = (numero) => {
    if (!numero && numero !== 0) return "0,00";
    return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  // Agrupar custos por fornecedor
  const custosPorFornecedor = custos.reduce((acc, custo) => {
    if (!acc[custo.fornecedor_id]) {
      acc[custo.fornecedor_id] = {
        fornecedor_id: custo.fornecedor_id,
        fornecedor_nome: custo.fornecedor_nome,
        custos: [],
        total: 0
      };
    }
    acc[custo.fornecedor_id].custos.push(custo);
    acc[custo.fornecedor_id].total += custo.valor_total || 0;
    return acc;
  }, {});

  const totalGeralSafra = Object.values(custosPorFornecedor).reduce((sum, f) => sum + f.total, 0);

  if (!safraAtiva && safras.length === 0) {
    return (
      <div className="p-6">
        <Card className="shadow-xl border-slate-200">
          <CardContent className="p-12 text-center">
            <Layers className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-700 mb-2">Nenhuma Safra Cadastrada</h2>
            <p className="text-slate-500 mb-6">Você precisa cadastrar uma safra antes de lançar custos.</p>
            <Button onClick={() => setShowSafraDialog(true)} className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              Cadastrar Safra
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Seletor de Safra e Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Seletor de Safra */}
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50 md:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-green-700 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Safra Ativa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select 
              value={safraAtiva?.id || ''} 
              onValueChange={(value) => {
                const safra = safras.find(s => s.id === value);
                setSafraAtiva(safra);
                setShowCustoForm(false);
                setEditingCusto(null);
              }}
            >
              <SelectTrigger className="border-green-300 focus:border-green-500">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {safras.map((safra) => (
                  <SelectItem key={safra.id} value={safra.id}>
                    {safra.ano_inicio}/{safra.ano_fim}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowSafraDialog(true)}
              className="w-full mt-2 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" />
              Nova Safra
            </Button>
          </CardContent>
        </Card>

        {/* Cards de Estatísticas */}
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total da Safra</CardTitle>
            <DollarSign className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">R$ {formatarNumero(totalGeralSafra)}</div>
            <p className="text-xs text-green-600 mt-1">Valor total investido</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Fornecedores</CardTitle>
            <Users className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{Object.keys(custosPorFornecedor).length}</div>
            <p className="text-xs text-blue-600 mt-1">Fornecedores ativos</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Lançamentos</CardTitle>
            <Package className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{custos.length}</div>
            <p className="text-xs text-purple-600 mt-1">Custos registrados</p>
          </CardContent>
        </Card>
      </div>

      {/* Botão Novo Lançamento */}
      {!showCustoForm && safraAtiva && (
        <div className="flex justify-end">
          <Button 
            onClick={() => {
              setEditingCusto(null);
              setShowCustoForm(true);
            }} 
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" 
            size="lg"
          >
            <Plus className="w-5 h-5" />
            Novo Lançamento
          </Button>
        </div>
      )}

      {/* Formulário Inline */}
      <AnimatePresence>
        {showCustoForm && safraAtiva && (
          <FormularioCusto
            onSubmit={handleCustoSubmit}
            onCancel={() => {
              setShowCustoForm(false);
              setEditingCusto(null);
            }}
            initialData={editingCusto}
            isEditing={!!editingCusto}
            fornecedores={fornecedores}
            produtos={produtos}
          />
        )}
      </AnimatePresence>

      {/* Tabela de Custos */}
      {safraAtiva && (
        <TabelaCustos
          custos={custos}
          onEdit={(custo) => {
            setEditingCusto(custo);
            setShowCustoForm(true);
          }}
          onDelete={handleDeleteCusto}
          onPrint={handlePrintCusto}
          onLancarEntrega={handleLancarEntrega}
          isLoading={false}
        />
      )}

      {/* Dialog para Lançar Entrega */}
      <LancarEntrega
        custo={custoParaEntrega}
        open={!!custoParaEntrega}
        onClose={() => setCustoParaEntrega(null)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
          setCustoParaEntrega(null);
        }}
      />

      {/* Dialog Gerenciar Safras */}
      <Dialog open={showSafraDialog} onOpenChange={setShowSafraDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-green-600" />
              Gerenciar Safras
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {safras.map((safra) => (
              <Card key={safra.id} className="border-slate-200">
                <CardContent className="p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-bold text-slate-900">{safra.ano_inicio}/{safra.ano_fim}</p>
                      <p className="text-sm text-slate-600">{safra.descricao}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={safraAtiva?.id === safra.id ? "default" : "outline"}
                      onClick={() => {
                        setSafraAtiva(safra);
                        setShowSafraDialog(false);
                      }}
                    >
                      {safraAtiva?.id === safra.id ? 'Ativa' : 'Selecionar'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => {
                setShowSafraDialog(false);
                window.open(window.location.origin + '/safras-gerenciar', '_blank');
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Cadastrar Nova Safra
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}