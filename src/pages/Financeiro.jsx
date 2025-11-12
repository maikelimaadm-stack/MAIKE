import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DollarSign, Save, X, Search, Edit, Trash2, Eye, TrendingUp, TrendingDown, AlertCircle, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
};

const getNextNumber = async (empresaId) => {
  const all = await base44.entities.LancamentoFinanceiro.list();
  const filtered = all.filter(l => l && l.empresa_id === empresaId);
  return filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_lancamento) || 0), 0) + 1;
};

export default function Financeiro() {
  const [abaAtiva, setAbaAtiva] = useState("cadastrar");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  
  const [formData, setFormData] = useState({
    tipo: "Pagar",
    fornecedor_id: "",
    descricao: "",
    documento: "",
    data_emissao: new Date().toISOString().split('T')[0],
    data_vencimento: new Date().toISOString().split('T')[0],
    valor_original: "",
    juros: "0",
    multa: "0",
    desconto: "0",
    plano_contas_id: "",
    centro_custo_id: "",
    forma_pagamento: "",
    observacoes: ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ['lancamentos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return [];
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l && l.empresa_id === empresaSelecionadaId) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_fin', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return [];
      const all = await base44.entities.Fornecedor.list('nome');
      return all.filter(f => f && f.empresa_id === empresaSelecionadaId) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: planos = [] } = useQuery({
    queryKey: ['planos_fin', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return [];
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p && p.empresa_id === empresaSelecionadaId && p.ativo !== false && p.aceita_lancamento !== false) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_fin', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return [];
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c && c.empresa_id === empresaSelecionadaId && c.ativo !== false) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const numero = await getNextNumber(empresaSelecionadaId);
      const fornecedor = fornecedores.find(f => f.id === data.fornecedor_id);
      const plano = planos.find(p => p.id === data.plano_contas_id);
      const centro = centros.find(c => c.id === data.centro_custo_id);

      return base44.entities.LancamentoFinanceiro.create({
        empresa_id: empresaSelecionadaId,
        numero_lancamento: String(numero),
        tipo: data.tipo,
        fornecedor_id: data.fornecedor_id,
        fornecedor_nome: fornecedor?.nome,
        descricao: data.descricao.toUpperCase(),
        documento: data.documento?.toUpperCase(),
        data_emissao: data.data_emissao,
        data_vencimento: data.data_vencimento,
        valor_original: parseFloat(data.valor_original) || 0,
        juros: parseFloat(data.juros) || 0,
        multa: parseFloat(data.multa) || 0,
        desconto: parseFloat(data.desconto) || 0,
        valor_pago: 0,
        plano_contas_id: data.plano_contas_id,
        plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
        centro_custo_id: data.centro_custo_id,
        centro_custo_nome: centro?.nome,
        forma_pagamento: data.forma_pagamento,
        status: 'Pendente',
        observacoes: data.observacoes?.toUpperCase()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      resetForm();
      toast.success('✅ Lançamento cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      const fornecedor = fornecedores.find(f => f.id === data.fornecedor_id);
      const plano = planos.find(p => p.id === data.plano_contas_id);
      const centro = centros.find(c => c.id === data.centro_custo_id);

      return base44.entities.LancamentoFinanceiro.update(id, {
        tipo: data.tipo,
        fornecedor_id: data.fornecedor_id,
        fornecedor_nome: fornecedor?.nome,
        descricao: data.descricao.toUpperCase(),
        documento: data.documento?.toUpperCase(),
        data_emissao: data.data_emissao,
        data_vencimento: data.data_vencimento,
        valor_original: parseFloat(data.valor_original) || 0,
        juros: parseFloat(data.juros) || 0,
        multa: parseFloat(data.multa) || 0,
        desconto: parseFloat(data.desconto) || 0,
        plano_contas_id: data.plano_contas_id,
        plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
        centro_custo_id: data.centro_custo_id,
        centro_custo_nome: centro?.nome,
        forma_pagamento: data.forma_pagamento,
        observacoes: data.observacoes?.toUpperCase()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      resetForm();
      setEditingId(null);
      toast.success('✅ Lançamento atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.LancamentoFinanceiro.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('✅ Lançamento excluído!');
    },
  });

  const resetForm = () => {
    setFormData({
      tipo: "Pagar",
      fornecedor_id: "",
      descricao: "",
      documento: "",
      data_emissao: new Date().toISOString().split('T')[0],
      data_vencimento: new Date().toISOString().split('T')[0],
      valor_original: "",
      juros: "0",
      multa: "0",
      desconto: "0",
      plano_contas_id: "",
      centro_custo_id: "",
      forma_pagamento: "",
      observacoes: ""
    });
    setEditingId(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.fornecedor_id || !formData.descricao || !formData.valor_original || !formData.plano_contas_id) {
      toast.error('❌ Preencha os campos obrigatórios!');
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (lancamento) => {
    setFormData({
      tipo: lancamento.tipo,
      fornecedor_id: lancamento.fornecedor_id || "",
      descricao: lancamento.descricao || "",
      documento: lancamento.documento || "",
      data_emissao: lancamento.data_emissao,
      data_vencimento: lancamento.data_vencimento,
      valor_original: String(lancamento.valor_original || 0),
      juros: String(lancamento.juros || 0),
      multa: String(lancamento.multa || 0),
      desconto: String(lancamento.desconto || 0),
      plano_contas_id: lancamento.plano_contas_id || "",
      centro_custo_id: lancamento.centro_custo_id || "",
      forma_pagamento: lancamento.forma_pagamento || "",
      observacoes: lancamento.observacoes || ""
    });
    setEditingId(lancamento.id);
    setAbaAtiva("cadastrar");
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ Deseja realmente excluir este lançamento?')) {
      deleteMutation.mutate(id);
    }
  };

  const lancamentosFiltrados = lancamentos.filter(l => {
    const matchTipo = filtroTipo === "todos" || l.tipo === filtroTipo;
    const matchSearch = !searchTerm || 
      (l.descricao || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.fornecedor_nome || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.documento || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchTipo && matchSearch;
  });

  const totalPagar = lancamentos.filter(l => l.tipo === 'Pagar' && l.status !== 'Pago').reduce((sum, l) => sum + ((l.valor_original || 0) - (l.valor_pago || 0)), 0);
  const totalReceber = lancamentos.filter(l => l.tipo === 'Receber' && l.status !== 'Pago').reduce((sum, l) => sum + ((l.valor_original || 0) - (l.valor_pago || 0)), 0);
  const totalPago = lancamentos.filter(l => l.status === 'Pago').reduce((sum, l) => sum + (l.valor_pago || 0), 0);

  const valorTotal = (parseFloat(formData.valor_original) || 0) + (parseFloat(formData.juros) || 0) + (parseFloat(formData.multa) || 0) - (parseFloat(formData.desconto) || 0);

  return (
    <div className="p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">FINANCEIRO</h1>
          <p className="text-sm text-slate-600">Controle de contas a pagar e receber</p>
        </div>

        <Card className="border-slate-300 shadow-lg">
          <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
            <TabsList className="w-full justify-start bg-slate-100 border-b rounded-none h-12">
              <TabsTrigger value="cadastrar" className="px-6 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-emerald-600">
                Cadastrar
              </TabsTrigger>
              <TabsTrigger value="pesquisar" className="px-6 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-emerald-600">
                Pesquisar
              </TabsTrigger>
              <TabsTrigger value="painel" className="px-6 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-emerald-600">
                Painel
              </TabsTrigger>
              <TabsTrigger value="valores" className="px-6 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-emerald-600">
                Valores
              </TabsTrigger>
            </TabsList>

            {/* ABA CADASTRAR */}
            <TabsContent value="cadastrar" className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* TIPO */}
                <div className="bg-slate-50 p-4 rounded border">
                  <Label className="text-sm font-semibold mb-3 block">Tipo:</Label>
                  <RadioGroup value={formData.tipo} onValueChange={(v) => setFormData({...formData, tipo: v})} className="flex gap-6">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Pagar" id="pagar" />
                      <Label htmlFor="pagar" className="cursor-pointer font-normal">Contas a Pagar</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Receber" id="receber" />
                      <Label htmlFor="receber" className="cursor-pointer font-normal">Contas a Receber</Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* DADOS PRINCIPAIS */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">{formData.tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'}: *</Label>
                    <Select value={formData.fornecedor_id} onValueChange={(v) => setFormData({...formData, fornecedor_id: v})}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {fornecedores.map(f => (
                          <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Nº Documento:</Label>
                    <Input value={formData.documento} onChange={(e) => setFormData({...formData, documento: e.target.value})} placeholder="Número do documento" className="bg-white uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Descrição: *</Label>
                  <Input value={formData.descricao} onChange={(e) => setFormData({...formData, descricao: e.target.value})} placeholder="Descrição do lançamento" className="bg-white uppercase" style={{ textTransform: 'uppercase' }} required />
                </div>

                {/* DATAS E VALORES */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Data Emissão: *</Label>
                    <Input type="date" value={formData.data_emissao} onChange={(e) => setFormData({...formData, data_emissao: e.target.value})} className="bg-white" required />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Data Vencimento: *</Label>
                    <Input type="date" value={formData.data_vencimento} onChange={(e) => setFormData({...formData, data_vencimento: e.target.value})} className="bg-white" required />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Valor Original: *</Label>
                    <Input type="number" step="0.01" value={formData.valor_original} onChange={(e) => setFormData({...formData, valor_original: e.target.value})} placeholder="0.00" className="bg-white" required />
                  </div>

                  <div className="space-y-2 bg-green-50 p-3 rounded border border-green-200">
                    <Label className="text-xs font-semibold text-green-800">Valor Total:</Label>
                    <div className="text-xl font-bold text-green-700">{formatarMoeda(valorTotal)}</div>
                  </div>
                </div>

                {/* AJUSTES */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Juros:</Label>
                    <Input type="number" step="0.01" value={formData.juros} onChange={(e) => setFormData({...formData, juros: e.target.value})} placeholder="0.00" className="bg-white" />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Multa:</Label>
                    <Input type="number" step="0.01" value={formData.multa} onChange={(e) => setFormData({...formData, multa: e.target.value})} placeholder="0.00" className="bg-white" />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Desconto:</Label>
                    <Input type="number" step="0.01" value={formData.desconto} onChange={(e) => setFormData({...formData, desconto: e.target.value})} placeholder="0.00" className="bg-white" />
                  </div>
                </div>

                {/* CLASSIFICAÇÃO */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Plano de Contas: *</Label>
                    <Select value={formData.plano_contas_id} onValueChange={(v) => setFormData({...formData, plano_contas_id: v})}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {planos.filter(p => p.tipo === (formData.tipo === 'Pagar' ? 'Despesa' : 'Receita')).map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.codigo} - {p.descricao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Centro de Custo:</Label>
                    <Select value={formData.centro_custo_id} onValueChange={(v) => setFormData({...formData, centro_custo_id: v})}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Opcional" />
                      </SelectTrigger>
                      <SelectContent>
                        {centros.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Forma Pagamento:</Label>
                    <Select value={formData.forma_pagamento} onValueChange={(v) => setFormData({...formData, forma_pagamento: v})}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="PIX">PIX</SelectItem>
                        <SelectItem value="Boleto">Boleto</SelectItem>
                        <SelectItem value="Cartão Crédito">Cartão Crédito</SelectItem>
                        <SelectItem value="Cartão Débito">Cartão Débito</SelectItem>
                        <SelectItem value="Transferência">Transferência</SelectItem>
                        <SelectItem value="Cheque">Cheque</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* OBSERVAÇÕES */}
                <div className="space-y-2">
                  <Label className="text-sm">Observações:</Label>
                  <Textarea value={formData.observacoes} onChange={(e) => setFormData({...formData, observacoes: e.target.value})} placeholder="OBSERVAÇÕES ADICIONAIS..." rows={3} className="bg-white uppercase" style={{ textTransform: 'uppercase' }} />
                </div>

                {/* BOTÕES */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button type="button" variant="outline" onClick={resetForm} className="gap-2">
                    <X className="w-4 h-4" />
                    {editingId ? 'Cancelar' : 'Limpar'}
                  </Button>
                  <Button type="submit" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                    <Save className="w-4 h-4" />
                    {editingId ? 'Atualizar' : 'Salvar'}
                  </Button>
                </div>
              </form>
            </TabsContent>

            {/* ABA PESQUISAR */}
            <TabsContent value="pesquisar" className="p-6">
              <div className="space-y-4">
                {/* FILTROS */}
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[300px]">
                    <Label className="text-sm mb-2 block">Pesquisa Rápida:</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        placeholder="Fornecedor, descrição, documento..." 
                        value={searchTerm} 
                        onChange={(e) => setSearchTerm(e.target.value)} 
                        className="pl-10 bg-white"
                      />
                    </div>
                  </div>

                  <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                    <SelectTrigger className="w-48 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="Pagar">Contas a Pagar</SelectItem>
                      <SelectItem value="Receber">Contas a Receber</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* TABELA */}
                <div className="border rounded-lg overflow-hidden bg-white">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="font-semibold">Nº</TableHead>
                        <TableHead className="font-semibold">Tipo</TableHead>
                        <TableHead className="font-semibold">Fornecedor/Cliente</TableHead>
                        <TableHead className="font-semibold">Descrição</TableHead>
                        <TableHead className="font-semibold">Doc</TableHead>
                        <TableHead className="font-semibold">Emissão</TableHead>
                        <TableHead className="font-semibold">Vencimento</TableHead>
                        <TableHead className="text-right font-semibold">Valor</TableHead>
                        <TableHead className="text-right font-semibold">Pago</TableHead>
                        <TableHead className="text-right font-semibold">Saldo</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="text-center font-semibold">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={12} className="text-center py-8 text-slate-400">
                            Carregando...
                          </TableCell>
                        </TableRow>
                      ) : lancamentosFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={12} className="text-center py-12">
                            <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                            <p className="text-slate-500">Nenhum lançamento encontrado</p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        lancamentosFiltrados.map((lanc) => {
                          const valorOriginal = lanc.valor_original || 0;
                          const valorPago = lanc.valor_pago || 0;
                          const saldo = valorOriginal - valorPago;

                          return (
                            <TableRow key={lanc.id} className="hover:bg-slate-50">
                              <TableCell className="font-bold">{lanc.numero_lancamento}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={lanc.tipo === 'Pagar' ? 'border-red-300 text-red-700' : 'border-green-300 text-green-700'}>
                                  {lanc.tipo}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate">{lanc.fornecedor_nome || '-'}</TableCell>
                              <TableCell className="max-w-[250px] truncate">{lanc.descricao}</TableCell>
                              <TableCell className="text-xs font-mono">{lanc.documento || '-'}</TableCell>
                              <TableCell className="text-xs">{formatarData(lanc.data_emissao)}</TableCell>
                              <TableCell className="text-xs">{formatarData(lanc.data_vencimento)}</TableCell>
                              <TableCell className="text-right font-mono font-semibold">{formatarMoeda(valorOriginal)}</TableCell>
                              <TableCell className="text-right font-mono text-blue-600">{formatarMoeda(valorPago)}</TableCell>
                              <TableCell className="text-right font-mono font-bold text-red-600">{formatarMoeda(saldo)}</TableCell>
                              <TableCell>
                                <Badge className={
                                  lanc.status === 'Pago' ? 'bg-green-100 text-green-800' :
                                  lanc.status === 'Vencido' ? 'bg-red-100 text-red-800' :
                                  lanc.status === 'Parcial' ? 'bg-blue-100 text-blue-800' :
                                  'bg-yellow-100 text-yellow-800'
                                }>
                                  {lanc.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1 justify-center">
                                  <Button variant="ghost" size="icon" onClick={() => setDetalhesAberto(lanc)} className="h-8 w-8" title="Detalhes">
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => handleEdit(lanc)} className="h-8 w-8 text-blue-600" title="Editar">
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => handleDelete(lanc.id)} className="h-8 w-8 text-red-600" title="Excluir">
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>

            {/* ABA PAINEL */}
            <TabsContent value="painel" className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-red-200 bg-red-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingDown className="w-5 h-5 text-red-600" />
                      A Pagar
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-700">{formatarMoeda(totalPagar)}</div>
                    <p className="text-xs text-slate-600 mt-1">
                      {lancamentos.filter(l => l.tipo === 'Pagar' && l.status !== 'Pago').length} lançamento(s)
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-green-200 bg-green-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                      A Receber
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-700">{formatarMoeda(totalReceber)}</div>
                    <p className="text-xs text-slate-600 mt-1">
                      {lancamentos.filter(l => l.tipo === 'Receber' && l.status !== 'Pago').length} lançamento(s)
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-blue-200 bg-blue-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <DollarSign className="w-5 h-5 text-blue-600" />
                      Total Pago
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-700">{formatarMoeda(totalPago)}</div>
                    <p className="text-xs text-slate-600 mt-1">
                      {lancamentos.filter(l => l.status === 'Pago').length} lançamento(s)
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className="mt-6 border-amber-200 bg-amber-50">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-amber-600" />
                    Vencimentos Próximos (7 dias)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {lancamentos
                      .filter(l => {
                        if (l.status === 'Pago') return false;
                        const hoje = new Date();
                        const venc = new Date(l.data_vencimento);
                        const diff = Math.floor((venc - hoje) / (1000 * 60 * 60 * 24));
                        return diff >= 0 && diff <= 7;
                      })
                      .slice(0, 5)
                      .map(l => (
                        <div key={l.id} className="flex justify-between items-center p-3 bg-white rounded border">
                          <div className="flex-1">
                            <div className="font-semibold text-sm">{l.descricao}</div>
                            <div className="text-xs text-slate-600">{l.fornecedor_nome}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-sm">{formatarMoeda(l.valor_original || 0)}</div>
                            <div className="text-xs text-amber-700">{formatarData(l.data_vencimento)}</div>
                          </div>
                        </div>
                      ))}
                    {lancamentos.filter(l => {
                      if (l.status === 'Pago') return false;
                      const hoje = new Date();
                      const venc = new Date(l.data_vencimento);
                      const diff = Math.floor((venc - hoje) / (1000 * 60 * 60 * 24));
                      return diff >= 0 && diff <= 7;
                    }).length === 0 && (
                      <div className="text-center py-6 text-slate-500">
                        <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Nenhum vencimento próximo</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ABA VALORES */}
            <TabsContent value="valores" className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Por Status</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {['Pendente', 'Pago', 'Parcial', 'Vencido', 'Cancelado'].map(status => {
                      const total = lancamentos.filter(l => l.status === status).reduce((sum, l) => sum + (l.valor_original || 0), 0);
                      const count = lancamentos.filter(l => l.status === status).length;
                      
                      return (
                        <div key={status} className="flex justify-between items-center p-3 bg-slate-50 rounded">
                          <span className="font-medium">{status}</span>
                          <div className="text-right">
                            <div className="font-bold">{formatarMoeda(total)}</div>
                            <div className="text-xs text-slate-500">{count} item(ns)</div>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Por Forma de Pagamento</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {['Dinheiro', 'PIX', 'Boleto', 'Cartão Crédito', 'Transferência'].map(forma => {
                      const total = lancamentos.filter(l => l.forma_pagamento === forma).reduce((sum, l) => sum + (l.valor_original || 0), 0);
                      const count = lancamentos.filter(l => l.forma_pagamento === forma).length;
                      
                      if (count === 0) return null;
                      
                      return (
                        <div key={forma} className="flex justify-between items-center p-3 bg-slate-50 rounded">
                          <span className="font-medium">{forma}</span>
                          <div className="text-right">
                            <div className="font-bold">{formatarMoeda(total)}</div>
                            <div className="text-xs text-slate-500">{count} item(ns)</div>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>

      {/* DIALOG DETALHES */}
      <Dialog open={!!detalhesAberto} onOpenChange={(open) => !open && setDetalhesAberto(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes do Lançamento #{detalhesAberto?.numero_lancamento}</DialogTitle>
          </DialogHeader>
          {detalhesAberto && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><strong>Tipo:</strong> {detalhesAberto.tipo}</div>
                <div><strong>Status:</strong> <Badge>{detalhesAberto.status}</Badge></div>
                <div><strong>Fornecedor/Cliente:</strong> {detalhesAberto.fornecedor_nome || '-'}</div>
                <div><strong>Documento:</strong> {detalhesAberto.documento || '-'}</div>
                <div><strong>Emissão:</strong> {formatarData(detalhesAberto.data_emissao)}</div>
                <div><strong>Vencimento:</strong> {formatarData(detalhesAberto.data_vencimento)}</div>
                <div className="col-span-2"><strong>Descrição:</strong> {detalhesAberto.descricao}</div>
              </div>

              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Valor Original:</span>
                      <span className="font-bold">{formatarMoeda(detalhesAberto.valor_original || 0)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>+ Juros:</span>
                      <span>{formatarMoeda(detalhesAberto.juros || 0)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>+ Multa:</span>
                      <span>{formatarMoeda(detalhesAberto.multa || 0)}</span>
                    </div>
                    <div className="flex justify-between text-green-600">
                      <span>- Desconto:</span>
                      <span>{formatarMoeda(detalhesAberto.desconto || 0)}</span>
                    </div>
                    <div className="flex justify-between text-blue-600 pt-2 border-t">
                      <span>Valor Pago:</span>
                      <span className="font-bold">{formatarMoeda(detalhesAberto.valor_pago || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg pt-2 border-t-2">
                      <span>Saldo:</span>
                      <span className="text-red-700">{formatarMoeda((detalhesAberto.valor_original || 0) - (detalhesAberto.valor_pago || 0))}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {detalhesAberto.observacoes && (
                <div className="bg-slate-50 p-4 rounded">
                  <strong className="text-sm">Observações:</strong>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{detalhesAberto.observacoes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}