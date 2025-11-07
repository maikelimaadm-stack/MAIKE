
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp, DollarSign, Package, Users, ChevronRight, Calendar, CheckCircle, Clock, XCircle, Edit, Trash2, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function CustosSafra() {
  const [showSafraForm, setShowSafraForm] = useState(false);
  const [editingSafra, setEditingSafra] = useState(null);
  const [safraAtiva, setSafraAtiva] = useState(null);
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState(null);
  const [showCustoForm, setShowCustoForm] = useState(false);
  const [editingCusto, setEditingCusto] = useState(null);

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
    enabled: !!empresaSelecionadaId, // This was changed from !!empresaSelecionadaId && !!safraAtiva as it's needed for CustoForm when no product is selected yet.
  });

  // Buscar produtos
  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId, // This was changed from !!empresaSelecionadaId && !!fornecedorSelecionado as it's needed for CustoForm when no product is selected yet.
  });

  const createSafraMutation = useMutation({
    mutationFn: (data) => base44.entities.Safra.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      setShowSafraForm(false);
      setEditingSafra(null);
      toast.success('Safra cadastrada com sucesso!');
    },
  });

  const updateSafraMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Safra.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      setShowSafraForm(false);
      setEditingSafra(null);
      toast.success('Safra atualizada com sucesso!');
    },
  });

  const deleteSafraMutation = useMutation({
    mutationFn: (id) => base44.entities.Safra.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      toast.success('Safra excluída com sucesso!');
    },
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

  const handleSafraSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      empresa_id: empresaSelecionadaId,
      ano_inicio: formData.get('ano_inicio'),
      ano_fim: formData.get('ano_fim'),
      descricao: formData.get('descricao')?.toUpperCase(),
      status: formData.get('status'),
      observacoes: formData.get('observacoes')?.toUpperCase(),
    };

    if (editingSafra) {
      updateSafraMutation.mutate({ id: editingSafra.id, data });
    } else {
      createSafraMutation.mutate(data);
    }
  };

  const handleCustoSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const fornecedor = fornecedores.find(f => f.id === formData.get('fornecedor_id'));
    const produto = produtos.find(p => p.id === formData.get('produto_id'));
    const quantidade = parseFloat(formData.get('quantidade'));
    const valorUnitario = parseFloat(formData.get('valor_unitario'));

    const data = {
      empresa_id: empresaSelecionadaId,
      safra_id: safraAtiva.id,
      fornecedor_id: formData.get('fornecedor_id'),
      fornecedor_nome: fornecedor?.nome,
      produto_id: formData.get('produto_id'),
      produto_nome: produto?.nome_produto,
      quantidade: quantidade,
      unidade_medida: produto?.unidade_medida,
      valor_unitario: valorUnitario,
      valor_total: quantidade * valorUnitario,
      prazo_entrega: formData.get('prazo_entrega'),
      data_entrega: formData.get('data_entrega') || undefined,
      status_entrega: formData.get('status_entrega'),
      forma_pagamento: formData.get('forma_pagamento')?.toUpperCase(),
      observacoes: formData.get('observacoes')?.toUpperCase(),
    };

    if (editingCusto) {
      updateCustoMutation.mutate({ id: editingCusto.id, data });
    } else {
      createCustoMutation.mutate(data);
    }
  };

  const formatarNumero = (numero) => {
    if (!numero && numero !== 0) return "0,00";
    return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  const getStatusBadge = (status) => {
    const config = {
      'Planejamento': { color: 'bg-blue-100 text-blue-800 border-blue-300', icon: Clock },
      'Em Andamento': { color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: TrendingUp },
      'Finalizada': { color: 'bg-green-100 text-green-800 border-green-300', icon: CheckCircle },
      'Pendente': { color: 'bg-orange-100 text-orange-800 border-orange-300', icon: Clock },
      'Em Trânsito': { color: 'bg-blue-100 text-blue-800 border-blue-300', icon: TrendingUp },
      'Entregue': { color: 'bg-green-100 text-green-800 border-green-300', icon: CheckCircle },
      'Cancelado': { color: 'bg-red-100 text-red-800 border-red-300', icon: XCircle },
    };
    const { color, icon: Icon } = config[status] || config['Pendente'];
    return (
      <Badge className={`${color} flex items-center gap-1 border`}>
        <Icon className="w-3 h-3" />
        {status}
      </Badge>
    );
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

  // Estatísticas gerais
  const totalSafras = safras.length;
  const safrasAtivas = safras.filter(s => s.status === 'Em Andamento').length;
  const safrasFinalizadas = safras.filter(s => s.status === 'Finalizada').length;

  // Se não tem safra ativa, mostrar lista de safras
  if (!safraAtiva) {
    return (
      <div className="p-6 space-y-6">
        {/* Cards de Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-green-700">Total de Safras</CardTitle>
              <Layers className="h-5 w-5 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-900">{totalSafras}</div>
              <p className="text-xs text-green-600 mt-1">Safras cadastradas</p>
            </CardContent>
          </Card>

          <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-yellow-50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-green-700">Em Andamento</CardTitle>
              <TrendingUp className="h-5 w-5 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-900">{safrasAtivas}</div>
              <p className="text-xs text-yellow-600 mt-1">Safras ativas</p>
            </CardContent>
          </Card>

          <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-green-700">Finalizadas</CardTitle>
              <CheckCircle className="h-5 w-5 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-900">{safrasFinalizadas}</div>
              <p className="text-xs text-green-600 mt-1">Safras concluídas</p>
            </CardContent>
          </Card>

          <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-green-700">Planejamento</CardTitle>
              <Clock className="h-5 w-5 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-900">
                {safras.filter(s => s.status === 'Planejamento').length}
              </div>
              <p className="text-xs text-blue-600 mt-1">Em planejamento</p>
            </CardContent>
          </Card>
        </div>

        {/* Botão e Título */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Gerenciar Safras</h1>
            <p className="text-slate-600">Selecione uma safra para visualizar e gerenciar custos</p>
          </div>
          <Button onClick={() => setShowSafraForm(true)} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" size="lg">
            <Plus className="w-5 h-5" />
            Nova Safra
          </Button>
        </div>

        {/* Grid de Safras */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {safras.map((safra) => (
              <motion.div
                key={safra.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Card className="hover:shadow-xl transition-all cursor-pointer border-slate-200 bg-white h-full">
                  <CardHeader className="pb-3 bg-gradient-to-r from-slate-50 to-green-50">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
                          <Calendar className="w-5 h-5 text-white" />
                        </div>
                        <CardTitle className="text-xl font-bold text-slate-900">
                          {safra.ano_inicio}/{safra.ano_fim}
                        </CardTitle>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSafra(safra);
                            setShowSafraForm(true);
                          }}
                          className="hover:bg-blue-50 hover:text-blue-700"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('Deseja excluir esta safra?')) {
                              deleteSafraMutation.mutate(safra.id);
                            }
                          }}
                          className="hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {getStatusBadge(safra.status)}
                  </CardHeader>
                  <CardContent className="pt-4">
                    {safra.descricao && (
                      <p className="text-sm text-slate-600 mb-4 line-clamp-2">{safra.descricao}</p>
                    )}
                    <Button
                      onClick={() => setSafraAtiva(safra)}
                      variant="outline"
                      className="w-full gap-2 border-green-300 text-green-700 hover:bg-green-50"
                    >
                      Ver Custos
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>

          {safras.length === 0 && (
            <div className="col-span-full text-center py-12">
              <Layers className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-lg font-medium text-slate-400">Nenhuma safra cadastrada</p>
              <p className="text-sm text-slate-400 mt-2">Clique em "Nova Safra" para começar</p>
            </div>
          )}
        </div>

        {/* Dialog Formulário Safra */}
        <Dialog open={showSafraForm} onOpenChange={setShowSafraForm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-green-600" />
                {editingSafra ? 'Editar' : 'Nova'} Safra
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSafraSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Ano Início *</Label>
                  <Input
                    name="ano_inicio"
                    type="number"
                    defaultValue={editingSafra?.ano_inicio}
                    required
                    placeholder="2025"
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ano Fim *</Label>
                  <Input
                    name="ano_fim"
                    type="number"
                    defaultValue={editingSafra?.ano_fim}
                    required
                    placeholder="2026"
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Input
                  name="descricao"
                  defaultValue={editingSafra?.descricao}
                  placeholder="SAFRA DE SOJA"
                  className="uppercase border-slate-300 focus:border-green-500"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select name="status" defaultValue={editingSafra?.status || 'Planejamento'}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Planejamento">Planejamento</SelectItem>
                    <SelectItem value="Em Andamento">Em Andamento</SelectItem>
                    <SelectItem value="Finalizada">Finalizada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea
                  name="observacoes"
                  defaultValue={editingSafra?.observacoes}
                  className="uppercase border-slate-300 focus:border-green-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => {
                  setShowSafraForm(false);
                  setEditingSafra(null);
                }}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-green-600 hover:bg-green-700">Salvar</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Se tem fornecedor selecionado, mostrar custos do fornecedor
  if (fornecedorSelecionado) {
    const custosDoFornecedor = custos.filter(c => c.fornecedor_id === fornecedorSelecionado.fornecedor_id);
    const totalFornecedor = custosDoFornecedor.reduce((sum, c) => sum + (c.valor_total || 0), 0);

    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => setFornecedorSelecionado(null)} className="hover:bg-slate-100">
            ← Voltar
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">
              {fornecedorSelecionado.fornecedor_nome}
            </h1>
            <p className="text-slate-600">
              Safra {safraAtiva.ano_inicio}/{safraAtiva.ano_fim}
            </p>
          </div>
          <Button onClick={() => {
            setEditingCusto(null); // Ensure editingCusto is cleared when adding new
            setShowCustoForm(true);
          }} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" size="lg">
            <Plus className="w-5 h-5" />
            Novo Lançamento
          </Button>
        </div>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              Total do Fornecedor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-green-700">
              R$ {formatarNumero(totalFornecedor)}
            </div>
            <p className="text-sm text-green-600 mt-1">{custosDoFornecedor.length} lançamento(s)</p>
          </CardContent>
        </Card>

        <Card className="shadow-xl border-slate-200">
          <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b">
            <CardTitle>Lançamentos</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-4">
              {custosDoFornecedor.map((custo) => (
                <Card key={custo.id} className="border-slate-200 hover:shadow-lg transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-bold text-lg text-slate-900 mb-2">{custo.produto_nome}</h3>
                        <div className="space-y-1 text-sm text-slate-600">
                          <p>Quantidade: <span className="font-semibold">{formatarNumero(custo.quantidade)} {custo.unidade_medida}</span></p>
                          <p>Valor Unit.: <span className="font-semibold">R$ {formatarNumero(custo.valor_unitario)}</span></p>
                          {custo.prazo_entrega && (
                            <p>Prazo: <span className="font-semibold">{new Date(custo.prazo_entrega).toLocaleDateString('pt-BR')}</span></p>
                          )}
                          {custo.forma_pagamento && (
                            <p>Pagamento: <span className="font-semibold">{custo.forma_pagamento}</span></p>
                          )}
                        </div>
                        {custo.observacoes && (
                          <p className="text-sm text-slate-500 mt-2 italic">{custo.observacoes}</p>
                        )}
                      </div>
                      <div className="text-right space-y-3 ml-4">
                        <div className="text-2xl font-bold text-green-700">
                          R$ {formatarNumero(custo.valor_total)}
                        </div>
                        {getStatusBadge(custo.status_entrega)}
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setEditingCusto(custo);
                              setShowCustoForm(true);
                            }}
                            className="hover:bg-blue-50 hover:text-blue-700"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm('Deseja excluir este lançamento?')) {
                                deleteCustoMutation.mutate(custo.id);
                              }
                            }}
                            className="hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {custosDoFornecedor.length === 0 && (
                <div className="text-center py-12">
                  <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-lg font-medium text-slate-400">Nenhum lançamento para este fornecedor</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Dialog Formulário Custo */}
        <Dialog open={showCustoForm} onOpenChange={setShowCustoForm}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingCusto ? 'Editar' : 'Novo'} Lançamento</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCustoSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Fornecedor *</Label>
                <Select
                  name="fornecedor_id"
                  defaultValue={editingCusto?.fornecedor_id || fornecedorSelecionado.fornecedor_id}
                  required
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Produto *</Label>
                <Select name="produto_id" defaultValue={editingCusto?.produto_id} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome_produto}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Quantidade *</Label>
                  <Input
                    name="quantidade"
                    type="number"
                    step="0.01"
                    defaultValue={editingCusto?.quantidade}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Valor Unitário (R$) *</Label>
                  <Input
                    name="valor_unitario"
                    type="number"
                    step="0.01"
                    defaultValue={editingCusto?.valor_unitario}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Prazo de Entrega</Label>
                  <Input
                    name="prazo_entrega"
                    type="date"
                    defaultValue={editingCusto?.prazo_entrega}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Data da Entrega</Label>
                  <Input
                    name="data_entrega"
                    type="date"
                    defaultValue={editingCusto?.data_entrega}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status Entrega</Label>
                  <Select name="status_entrega" defaultValue={editingCusto?.status_entrega || 'Pendente'}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pendente">Pendente</SelectItem>
                      <SelectItem value="Em Trânsito">Em Trânsito</SelectItem>
                      <SelectItem value="Entregue">Entregue</SelectItem>
                      <SelectItem value="Cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Forma de Pagamento</Label>
                  <Input
                    name="forma_pagamento"
                    defaultValue={editingCusto?.forma_pagamento}
                    placeholder="À VISTA, PRAZO, ETC"
                    className="uppercase"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea
                  name="observacoes"
                  defaultValue={editingCusto?.observacoes}
                  className="uppercase"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => {
                  setShowCustoForm(false);
                  setEditingCusto(null);
                }}>
                  Cancelar
                </Button>
                <Button type="submit">Salvar</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Mostrar lista de fornecedores da safra
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => setSafraAtiva(null)} className="hover:bg-slate-100">
          ← Voltar
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">
            Safra {safraAtiva.ano_inicio}/{safraAtiva.ano_fim}
          </h1>
          <p className="text-slate-600">{safraAtiva.descricao}</p>
        </div>
        <Button onClick={() => {
          setFornecedorSelecionado({ fornecedor_id: null, fornecedor_nome: 'Novo' });
          setEditingCusto(null); // Ensure editingCusto is cleared when adding new
          setShowCustoForm(true);
        }} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" size="lg">
          <Plus className="w-5 h-5" />
          Novo Lançamento
        </Button>
      </div>

      {/* Cards de Estatísticas da Safra */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

      {/* Lista de Fornecedores */}
      <Card className="shadow-xl border-slate-200">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b">
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-green-600" />
            Fornecedores da Safra
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-3">
            {Object.values(custosPorFornecedor).map((item) => (
              <Card
                key={item.fornecedor_id}
                className="border-slate-200 hover:shadow-lg hover:border-green-300 cursor-pointer transition-all"
                onClick={() => setFornecedorSelecionado(item)}
              >
                <CardContent className="p-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-green-100 to-green-200 rounded-xl flex items-center justify-center">
                        <Users className="w-6 h-6 text-green-700" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-slate-900">{item.fornecedor_nome}</h3>
                        <p className="text-sm text-slate-600">{item.custos.length} lançamento(s)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-2xl font-bold text-green-700">
                          R$ {formatarNumero(item.total)}
                        </div>
                      </div>
                      <ChevronRight className="w-6 h-6 text-slate-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {Object.keys(custosPorFornecedor).length === 0 && (
              <div className="text-center py-12">
                <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-lg font-medium text-slate-400">Nenhum lançamento para esta safra</p>
                <p className="text-sm text-slate-400 mt-2">Clique em "Novo Lançamento" para começar</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog para criar novo custo */}
      <Dialog open={showCustoForm} onOpenChange={setShowCustoForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novo Lançamento</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCustoSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Fornecedor *</Label>
              <Select name="fornecedor_id" required value={fornecedorSelecionado?.fornecedor_id || ''} onValueChange={(value) => setFornecedorSelecionado(fornecedores.find(f => f.id === value) || { fornecedor_id: value, fornecedor_nome: fornecedores.find(f => f.id === value)?.nome })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  {fornecedores.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Produto *</Label>
              <Select name="produto_id" required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {produtos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome_produto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantidade *</Label>
                <Input name="quantidade" type="number" step="0.01" required />
              </div>
              <div className="space-y-2">
                <Label>Valor Unitário (R$) *</Label>
                <Input name="valor_unitario" type="number" step="0.01" required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prazo de Entrega</Label>
                <Input name="prazo_entrega" type="date" />
              </div>
              <div className="space-y-2">
                <Label>Status Entrega</Label>
                <Select name="status_entrega" defaultValue="Pendente">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pendente">Pendente</SelectItem>
                    <SelectItem value="Em Trânsito">Em Trânsito</SelectItem>
                    <SelectItem value="Entregue">Entregue</SelectItem>
                    <SelectItem value="Cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Forma de Pagamento</Label>
              <Input name="forma_pagamento" placeholder="À VISTA, PRAZO, ETC" className="uppercase" />
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea name="observacoes" className="uppercase" />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => {
                setShowCustoForm(false);
                setFornecedorSelecionado(null);
              }}>
                Cancelar
              </Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
