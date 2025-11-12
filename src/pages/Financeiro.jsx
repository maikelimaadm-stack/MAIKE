import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="p-4 bg-white min-h-screen">
      <div className="max-w-7xl mx-auto">
        <Card className="border shadow-sm">
          <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
            <TabsList className="w-full justify-start bg-slate-50 border-b rounded-none h-10">
              <TabsTrigger value="cadastrar" className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                Cadastrar
              </TabsTrigger>
              <TabsTrigger value="pesquisar" className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                Pesquisar
              </TabsTrigger>
              <TabsTrigger value="painel" className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                Painel
              </TabsTrigger>
              <TabsTrigger value="valores" className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                Valores
              </TabsTrigger>
            </TabsList>

            {/* ABA CADASTRAR */}
            <TabsContent value="cadastrar" className="p-4">
              <form onSubmit={handleSubmit}>
                {/* TIPO */}
                <div className="mb-4 pb-3 border-b">
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

                {/* LINHA 1 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">{formData.tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'}:</Label>
                  <div className="col-span-10">
                    <Select value={formData.fornecedor_id} onValueChange={(v) => setFormData({...formData, fornecedor_id: v})}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {fornecedores.map(f => (
                          <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* LINHA 2 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">CPF/CNPJ:</Label>
                  <div className="col-span-4">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.cnpj || fornecedores.find(f => f.id === formData.fornecedor_id)?.cpf || ''} />
                  </div>
                  <Label className="col-span-2 text-right text-sm">Razão Social:</Label>
                  <div className="col-span-4">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.razao_social || fornecedores.find(f => f.id === formData.fornecedor_id)?.nome || ''} />
                  </div>
                </div>

                {/* LINHA 3 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">Tipo:</Label>
                  <div className="col-span-4">
                    <Input className="h-8 text-sm" placeholder="Outro" />
                  </div>
                </div>

                {/* LINHA 4 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">Nome Fantasia:</Label>
                  <div className="col-span-10">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.nome || ''} />
                  </div>
                </div>

                {/* LINHA 5 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">Código RH:</Label>
                  <div className="col-span-4">
                    <Input className="h-8 text-sm" />
                  </div>
                </div>

                {/* LINHA 6 - ENDEREÇO */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">Endereço:</Label>
                  <div className="col-span-10">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.endereco || ''} />
                  </div>
                </div>

                {/* LINHA 7 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">CEP:</Label>
                  <div className="col-span-2">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.cep || ''} />
                  </div>
                  <Label className="col-span-1 text-right text-sm">Cidade:</Label>
                  <div className="col-span-3">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.cidade || ''} />
                  </div>
                  <Label className="col-span-1 text-right text-sm">UF:</Label>
                  <div className="col-span-1">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.estado || ''} />
                  </div>
                  <Label className="col-span-1 text-right text-sm">Código IBGE:</Label>
                  <div className="col-span-1">
                    <Input className="h-8 text-sm" />
                  </div>
                </div>

                {/* LINHA 8 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">Bairro:</Label>
                  <div className="col-span-4">
                    <Input className="h-8 text-sm" />
                  </div>
                </div>

                {/* LINHA 9 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">UF:</Label>
                  <div className="col-span-2">
                    <Select>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="MT" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MT">MT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Label className="col-span-2 text-right text-sm">Complemento:</Label>
                  <div className="col-span-6">
                    <Input className="h-8 text-sm" />
                  </div>
                </div>

                {/* LINHA 10 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">Referência:</Label>
                  <div className="col-span-10">
                    <Input className="h-8 text-sm" />
                  </div>
                </div>

                {/* SEÇÃO CONTATOS */}
                <div className="mt-4 mb-3 pb-2 border-b">
                  <h3 className="text-sm font-semibold">Contatos</h3>
                </div>

                {/* LINHA 11 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">Email:</Label>
                  <div className="col-span-10">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.email || ''} />
                  </div>
                </div>

                {/* LINHA 12 */}
                <div className="grid grid-cols-12 gap-3 mb-3 items-center">
                  <Label className="col-span-2 text-right text-sm">Telefone Comercial:</Label>
                  <div className="col-span-4">
                    <Input className="h-8 text-sm bg-slate-50" disabled value={fornecedores.find(f => f.id === formData.fornecedor_id)?.telefone || ''} />
                  </div>
                </div>

                {/* BOTÕES */}
                <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                  <Button type="button" variant="outline" onClick={resetForm} size="sm">
                    {editingId ? 'Cancelar' : 'Limpar'}
                  </Button>
                  <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-700">
                    {editingId ? 'Atualizar' : 'Salvar'}
                  </Button>
                </div>
              </form>
            </TabsContent>

            {/* ABA PESQUISAR */}
            <TabsContent value="pesquisar" className="p-4">
              <div className="space-y-4">
                {/* FILTROS */}
                <div className="flex gap-3 items-end mb-4">
                  <div className="flex-1">
                    <Label className="text-sm mb-2 block">Pesquisa Rápida:</Label>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        placeholder="Fornecedor, descrição, documento..." 
                        value={searchTerm} 
                        onChange={(e) => setSearchTerm(e.target.value)} 
                        className="pl-8 h-8 text-sm"
                      />
                    </div>
                  </div>

                  <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                    <SelectTrigger className="w-48 h-8 text-sm">
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
                <div className="border rounded overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="h-8 text-xs">Nº</TableHead>
                        <TableHead className="h-8 text-xs">Tipo</TableHead>
                        <TableHead className="h-8 text-xs">Fornecedor/Cliente</TableHead>
                        <TableHead className="h-8 text-xs">Descrição</TableHead>
                        <TableHead className="h-8 text-xs">Doc</TableHead>
                        <TableHead className="h-8 text-xs">Emissão</TableHead>
                        <TableHead className="h-8 text-xs">Vencimento</TableHead>
                        <TableHead className="h-8 text-xs text-right">Valor</TableHead>
                        <TableHead className="h-8 text-xs text-right">Pago</TableHead>
                        <TableHead className="h-8 text-xs text-right">Saldo</TableHead>
                        <TableHead className="h-8 text-xs">Status</TableHead>
                        <TableHead className="h-8 text-xs text-center">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={12} className="text-center py-4 text-xs text-slate-400">
                            Carregando...
                          </TableCell>
                        </TableRow>
                      ) : lancamentosFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={12} className="text-center py-8">
                            <DollarSign className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                            <p className="text-xs text-slate-500">Nenhum lançamento encontrado</p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        lancamentosFiltrados.map((lanc) => {
                          const valorOriginal = lanc.valor_original || 0;
                          const valorPago = lanc.valor_pago || 0;
                          const saldo = valorOriginal - valorPago;

                          return (
                            <TableRow key={lanc.id} className="hover:bg-slate-50">
                              <TableCell className="py-2 text-xs font-semibold">{lanc.numero_lancamento}</TableCell>
                              <TableCell className="py-2">
                                <Badge variant="outline" className={`text-xs ${lanc.tipo === 'Pagar' ? 'border-red-300 text-red-700' : 'border-green-300 text-green-700'}`}>
                                  {lanc.tipo}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-2 text-xs max-w-[150px] truncate">{lanc.fornecedor_nome || '-'}</TableCell>
                              <TableCell className="py-2 text-xs max-w-[200px] truncate">{lanc.descricao}</TableCell>
                              <TableCell className="py-2 text-xs font-mono">{lanc.documento || '-'}</TableCell>
                              <TableCell className="py-2 text-xs">{formatarData(lanc.data_emissao)}</TableCell>
                              <TableCell className="py-2 text-xs">{formatarData(lanc.data_vencimento)}</TableCell>
                              <TableCell className="py-2 text-xs text-right font-mono">{formatarMoeda(valorOriginal)}</TableCell>
                              <TableCell className="py-2 text-xs text-right font-mono text-blue-600">{formatarMoeda(valorPago)}</TableCell>
                              <TableCell className="py-2 text-xs text-right font-mono font-semibold text-red-600">{formatarMoeda(saldo)}</TableCell>
                              <TableCell className="py-2">
                                <Badge className={`text-xs ${
                                  lanc.status === 'Pago' ? 'bg-green-100 text-green-800' :
                                  lanc.status === 'Vencido' ? 'bg-red-100 text-red-800' :
                                  lanc.status === 'Parcial' ? 'bg-blue-100 text-blue-800' :
                                  'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {lanc.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-2">
                                <div className="flex gap-1 justify-center">
                                  <Button variant="ghost" size="icon" onClick={() => setDetalhesAberto(lanc)} className="h-6 w-6" title="Detalhes">
                                    <Eye className="w-3 h-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => handleEdit(lanc)} className="h-6 w-6 text-blue-600" title="Editar">
                                    <Edit className="w-3 h-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => handleDelete(lanc.id)} className="h-6 w-6 text-red-600" title="Excluir">
                                    <Trash2 className="w-3 h-3" />
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
            <TabsContent value="painel" className="p-4">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <Card className="border-red-200 bg-red-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingDown className="w-4 h-4 text-red-600" />
                      <span className="text-xs font-semibold">A Pagar</span>
                    </div>
                    <div className="text-xl font-bold text-red-700">{formatarMoeda(totalPagar)}</div>
                    <p className="text-xs text-slate-600 mt-1">
                      {lancamentos.filter(l => l.tipo === 'Pagar' && l.status !== 'Pago').length} lançamento(s)
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-green-200 bg-green-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-4 h-4 text-green-600" />
                      <span className="text-xs font-semibold">A Receber</span>
                    </div>
                    <div className="text-xl font-bold text-green-700">{formatarMoeda(totalReceber)}</div>
                    <p className="text-xs text-slate-600 mt-1">
                      {lancamentos.filter(l => l.tipo === 'Receber' && l.status !== 'Pago').length} lançamento(s)
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-blue-200 bg-blue-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-blue-600" />
                      <span className="text-xs font-semibold">Total Pago</span>
                    </div>
                    <div className="text-xl font-bold text-blue-700">{formatarMoeda(totalPago)}</div>
                    <p className="text-xs text-slate-600 mt-1">
                      {lancamentos.filter(l => l.status === 'Pago').length} lançamento(s)
                    </p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ABA VALORES */}
            <TabsContent value="valores" className="p-4">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <h3 className="text-sm font-semibold mb-3">Por Status</h3>
                    <div className="space-y-2">
                      {['Pendente', 'Pago', 'Parcial', 'Vencido', 'Cancelado'].map(status => {
                        const total = lancamentos.filter(l => l.status === status).reduce((sum, l) => sum + (l.valor_original || 0), 0);
                        const count = lancamentos.filter(l => l.status === status).length;
                        
                        return (
                          <div key={status} className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded text-sm">
                            <span>{status}</span>
                            <div className="text-right">
                              <div className="font-semibold">{formatarMoeda(total)}</div>
                              <div className="text-xs text-slate-500">{count} item(ns)</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <h3 className="text-sm font-semibold mb-3">Por Forma de Pagamento</h3>
                    <div className="space-y-2">
                      {['Dinheiro', 'PIX', 'Boleto', 'Cartão Crédito', 'Transferência'].map(forma => {
                        const total = lancamentos.filter(l => l.forma_pagamento === forma).reduce((sum, l) => sum + (l.valor_original || 0), 0);
                        const count = lancamentos.filter(l => l.forma_pagamento === forma).length;
                        
                        if (count === 0) return null;
                        
                        return (
                          <div key={forma} className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded text-sm">
                            <span>{forma}</span>
                            <div className="text-right">
                              <div className="font-semibold">{formatarMoeda(total)}</div>
                              <div className="text-xs text-slate-500">{count} item(ns)</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
            <DialogTitle className="text-sm">Detalhes do Lançamento #{detalhesAberto?.numero_lancamento}</DialogTitle>
          </DialogHeader>
          {detalhesAberto && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><strong>Tipo:</strong> {detalhesAberto.tipo}</div>
                <div><strong>Status:</strong> <Badge className="text-xs">{detalhesAberto.status}</Badge></div>
                <div><strong>Fornecedor/Cliente:</strong> {detalhesAberto.fornecedor_nome || '-'}</div>
                <div><strong>Documento:</strong> {detalhesAberto.documento || '-'}</div>
                <div><strong>Emissão:</strong> {formatarData(detalhesAberto.data_emissao)}</div>
                <div><strong>Vencimento:</strong> {formatarData(detalhesAberto.data_vencimento)}</div>
                <div className="col-span-2"><strong>Descrição:</strong> {detalhesAberto.descricao}</div>
              </div>

              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-3">
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>Valor Original:</span>
                      <span className="font-semibold">{formatarMoeda(detalhesAberto.valor_original || 0)}</span>
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
                    <div className="flex justify-between text-blue-600 pt-1 border-t">
                      <span>Valor Pago:</span>
                      <span className="font-semibold">{formatarMoeda(detalhesAberto.valor_pago || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-sm pt-1 border-t-2">
                      <span>Saldo:</span>
                      <span className="text-red-700">{formatarMoeda((detalhesAberto.valor_original || 0) - (detalhesAberto.valor_pago || 0))}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {detalhesAberto.observacoes && (
                <div className="bg-slate-50 p-3 rounded">
                  <strong className="text-xs">Observações:</strong>
                  <p className="text-xs mt-1 whitespace-pre-wrap">{detalhesAberto.observacoes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}