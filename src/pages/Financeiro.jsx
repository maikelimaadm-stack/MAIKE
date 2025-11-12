import React, { useState, useEffect } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Save, X, FileText, Trash2, Plus, Upload, Download, Eye, Edit, Search, DollarSign, CheckCircle, AlertTriangle, AlertCircle } from "lucide-react";
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
  const [modoTela, setModoTela] = useState("lista"); // lista, criar, editar
  const [abaAtiva, setAbaAtiva] = useState("dados_financeiros");
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [formData, setFormData] = useState({
    // Dados Financeiros
    tipo: "Despesa",
    numero_referencia: "",
    status: "Pendente",
    data_documento: new Date().toISOString().split('T')[0],
    data_vencimento: new Date().toISOString().split('T')[0],
    data_baixa: "",
    valor_liquido: "",
    desconto: "0",
    juros_multa: "0",
    valor_total: "0",
    moeda: "BRL",
    taxa_cambio: "",
    conta_bancaria_id: "",
    forma_pagamento: "",
    parcelado: false,
    numero_parcelas: "",
    centro_custo_id: "",
    projeto_id: "",
    categoria_id: "",
    pessoa_id: "",
    plano_contas_id: "",
    origem: "Manual",
    tags: [],
    observacoes: "",
    // Fiscal
    tipo_documento_fiscal: "",
    numero_nf: "",
    chave_nf: "",
    data_emissao_fiscal: "",
    cfop: "",
    icms_base: "0",
    icms_aliquota: "0",
    icms_valor: "0",
    pis_base: "0",
    pis_aliquota: "0",
    pis_valor: "0",
    cofins_base: "0",
    cofins_aliquota: "0",
    cofins_valor: "0",
    iss_base: "0",
    iss_aliquota: "0",
    iss_valor: "0",
    irrf_valor: "0",
    inss_valor: "0",
    csll_valor: "0",
    // Arrays
    itens: [],
    rateio: [],
    anexos: [],
    // Aprovação
    requer_aprovacao: false,
    status_aprovacao: "Pendente"
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ['lancamentos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return [];
      const all = await base44.entities.LancamentoFinanceiro.list('-data_documento');
      return all.filter(l => l && l.empresa_id === empresaSelecionadaId) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_fin'],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list('nome');
      return all.filter(f => f.empresa_id === empresaSelecionadaId) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: planos = [] } = useQuery({
    queryKey: ['planos_fin'],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false && p.aceita_lancamento !== false) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_fin'],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  // Calcular valor total automaticamente
  useEffect(() => {
    const liquido = parseFloat(formData.valor_liquido) || 0;
    const desc = parseFloat(formData.desconto) || 0;
    const juros = parseFloat(formData.juros_multa) || 0;
    const total = liquido - desc + juros;
    setFormData(prev => ({ ...prev, valor_total: total.toFixed(2) }));
  }, [formData.valor_liquido, formData.desconto, formData.juros_multa]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const numero = await getNextNumber(empresaSelecionadaId);
      const pessoa = fornecedores.find(f => f.id === data.pessoa_id);
      const plano = planos.find(p => p.id === data.plano_contas_id);
      const centro = centros.find(c => c.id === data.centro_custo_id);

      return base44.entities.LancamentoFinanceiro.create({
        empresa_id: empresaSelecionadaId,
        numero_lancamento: String(numero),
        ...data,
        pessoa_nome: pessoa?.nome,
        pessoa_cpf_cnpj: pessoa?.cnpj || pessoa?.cpf,
        plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
        centro_custo_nome: centro?.nome,
        valor_liquido: parseFloat(data.valor_liquido) || 0,
        desconto: parseFloat(data.desconto) || 0,
        juros_multa: parseFloat(data.juros_multa) || 0,
        valor_total: parseFloat(data.valor_total) || 0,
        observacoes: data.observacoes?.toUpperCase()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      resetForm();
      setModoTela("lista");
      toast.success('✅ Lançamento cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      const pessoa = fornecedores.find(f => f.id === data.pessoa_id);
      const plano = planos.find(p => p.id === data.plano_contas_id);
      const centro = centros.find(c => c.id === data.centro_custo_id);

      return base44.entities.LancamentoFinanceiro.update(id, {
        ...data,
        pessoa_nome: pessoa?.nome,
        pessoa_cpf_cnpj: pessoa?.cnpj || pessoa?.cpf,
        plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
        centro_custo_nome: centro?.nome,
        valor_liquido: parseFloat(data.valor_liquido) || 0,
        desconto: parseFloat(data.desconto) || 0,
        juros_multa: parseFloat(data.juros_multa) || 0,
        valor_total: parseFloat(data.valor_total) || 0,
        observacoes: data.observacoes?.toUpperCase()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      resetForm();
      setModoTela("lista");
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
      tipo: "Despesa",
      numero_referencia: "",
      status: "Pendente",
      data_documento: new Date().toISOString().split('T')[0],
      data_vencimento: new Date().toISOString().split('T')[0],
      data_baixa: "",
      valor_liquido: "",
      desconto: "0",
      juros_multa: "0",
      valor_total: "0",
      moeda: "BRL",
      taxa_cambio: "",
      conta_bancaria_id: "",
      forma_pagamento: "",
      parcelado: false,
      numero_parcelas: "",
      centro_custo_id: "",
      projeto_id: "",
      categoria_id: "",
      pessoa_id: "",
      plano_contas_id: "",
      origem: "Manual",
      tags: [],
      observacoes: "",
      tipo_documento_fiscal: "",
      numero_nf: "",
      chave_nf: "",
      data_emissao_fiscal: "",
      cfop: "",
      icms_base: "0",
      icms_aliquota: "0",
      icms_valor: "0",
      pis_base: "0",
      pis_aliquota: "0",
      pis_valor: "0",
      cofins_base: "0",
      cofins_aliquota: "0",
      cofins_valor: "0",
      iss_base: "0",
      iss_aliquota: "0",
      iss_valor: "0",
      irrf_valor: "0",
      inss_valor: "0",
      csll_valor: "0",
      itens: [],
      rateio: [],
      anexos: [],
      requer_aprovacao: false,
      status_aprovacao: "Pendente"
    });
    setEditingId(null);
    setAbaAtiva("dados_financeiros");
  };

  const handleSubmit = (isDraft = false) => {
    if (!isDraft) {
      if (!formData.tipo || !formData.valor_liquido || !formData.data_vencimento) {
        toast.error('❌ Preencha os campos obrigatórios!');
        return;
      }
    }

    const dataToSave = {
      ...formData,
      status: isDraft ? "Rascunho" : formData.status
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
  };

  const handleEdit = (lancamento) => {
    setFormData({
      ...lancamento,
      valor_liquido: String(lancamento.valor_liquido || 0),
      desconto: String(lancamento.desconto || 0),
      juros_multa: String(lancamento.juros_multa || 0),
      valor_total: String(lancamento.valor_total || 0),
      itens: lancamento.itens || [],
      rateio: lancamento.rateio || [],
      anexos: lancamento.anexos || [],
      tags: lancamento.tags || []
    });
    setEditingId(lancamento.id);
    setModoTela("editar");
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ Deseja realmente excluir este lançamento?')) {
      deleteMutation.mutate(id);
    }
  };

  const lancamentosFiltrados = lancamentos.filter(l => {
    const searchLower = searchTerm.toLowerCase();
    return !searchTerm || 
      (l.pessoa_nome || '').toLowerCase().includes(searchLower) ||
      (l.numero_referencia || '').toLowerCase().includes(searchLower) ||
      (l.observacoes || '').toLowerCase().includes(searchLower);
  });

  const pessoaSelecionada = fornecedores.find(f => f.id === formData.pessoa_id);

  // MODO LISTA
  if (modoTela === "lista") {
    return (
      <div className="p-4 bg-white min-h-screen">
        <div className="max-w-7xl mx-auto">
          <Card className="border shadow-sm">
            <CardHeader className="border-b bg-slate-50">
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg">Lançamentos Financeiros</CardTitle>
                <Button size="sm" onClick={() => setModoTela("criar")} className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Lançamento
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input 
                    placeholder="Pesquisar por pessoa, referência, observações..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              </div>

              <div className="border rounded overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="h-8 text-xs">Nº</TableHead>
                      <TableHead className="h-8 text-xs">Tipo</TableHead>
                      <TableHead className="h-8 text-xs">Pessoa</TableHead>
                      <TableHead className="h-8 text-xs">Referência</TableHead>
                      <TableHead className="h-8 text-xs">Vencimento</TableHead>
                      <TableHead className="h-8 text-xs text-right">Valor</TableHead>
                      <TableHead className="h-8 text-xs">Status</TableHead>
                      <TableHead className="h-8 text-xs text-center">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-4 text-xs">Carregando...</TableCell>
                      </TableRow>
                    ) : lancamentosFiltrados.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">
                          <DollarSign className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                          <p className="text-xs text-slate-500">Nenhum lançamento encontrado</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      lancamentosFiltrados.map((lanc) => (
                        <TableRow key={lanc.id} className="hover:bg-slate-50">
                          <TableCell className="py-2 text-xs font-semibold">{lanc.numero_lancamento}</TableCell>
                          <TableCell className="py-2">
                            <Badge variant="outline" className="text-xs">{lanc.tipo}</Badge>
                          </TableCell>
                          <TableCell className="py-2 text-xs">{lanc.pessoa_nome || '-'}</TableCell>
                          <TableCell className="py-2 text-xs">{lanc.numero_referencia || '-'}</TableCell>
                          <TableCell className="py-2 text-xs">{formatarData(lanc.data_vencimento)}</TableCell>
                          <TableCell className="py-2 text-xs text-right font-mono">{formatarMoeda(lanc.valor_total)}</TableCell>
                          <TableCell className="py-2">
                            <Badge className={`text-xs ${
                              lanc.status === 'Pago' ? 'bg-green-100 text-green-800' :
                              lanc.status === 'Rascunho' ? 'bg-slate-100 text-slate-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {lanc.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="flex gap-1 justify-center">
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(lanc)} className="h-6 w-6">
                                <Edit className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(lanc.id)} className="h-6 w-6 text-red-600">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // MODO CRIAR/EDITAR
  return (
    <div className="p-4 bg-white min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-12 gap-4">
          {/* ÁREA PRINCIPAL - FORMULÁRIO */}
          <div className="col-span-9">
            <Card className="border shadow-sm">
              <CardHeader className="border-b bg-slate-50">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base">
                    {editingId ? 'Editar Lançamento' : 'Novo Lançamento'}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleSubmit(true)}>
                      <Save className="w-3 h-3 mr-1" />
                      Salvar Rascunho
                    </Button>
                    <Button size="sm" onClick={() => handleSubmit(false)} className="bg-blue-600">
                      <Save className="w-3 h-3 mr-1" />
                      Salvar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { resetForm(); setModoTela("lista"); }}>
                      <X className="w-3 h-3 mr-1" />
                      Cancelar
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
                <TabsList className="w-full justify-start bg-slate-50 border-b rounded-none h-10">
                  <TabsTrigger value="dados_financeiros" className="text-xs data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                    Dados Financeiros
                  </TabsTrigger>
                  <TabsTrigger value="itens" className="text-xs data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                    Produtos/Itens
                  </TabsTrigger>
                  <TabsTrigger value="fiscal" className="text-xs data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                    Informações Fiscais
                  </TabsTrigger>
                  <TabsTrigger value="rateio" className="text-xs data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                    Rateio
                  </TabsTrigger>
                  <TabsTrigger value="anexos" className="text-xs data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                    Anexos
                  </TabsTrigger>
                  <TabsTrigger value="aprovacao" className="text-xs data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
                    Aprovação
                  </TabsTrigger>
                </TabsList>

                {/* ABA 1 - DADOS FINANCEIROS */}
                <TabsContent value="dados_financeiros" className="p-4">
                  <div className="space-y-3">
                    {/* Tipo */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Tipo de Lançamento: *</Label>
                      <div className="col-span-9">
                        <Select value={formData.tipo} onValueChange={(v) => setFormData({...formData, tipo: v})}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Receita">Receita</SelectItem>
                            <SelectItem value="Despesa">Despesa</SelectItem>
                            <SelectItem value="Transferência">Transferência</SelectItem>
                            <SelectItem value="Ajuste">Ajuste</SelectItem>
                            <SelectItem value="Provisão">Provisão</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Número/Referência */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Número/Referência:</Label>
                      <div className="col-span-9">
                        <Input 
                          value={formData.numero_referencia} 
                          onChange={(e) => setFormData({...formData, numero_referencia: e.target.value})} 
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    {/* Pessoa */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">
                        {formData.tipo === 'Receita' ? 'Cliente' : 'Fornecedor'}: *
                      </Label>
                      <div className="col-span-9">
                        <Select value={formData.pessoa_id} onValueChange={(v) => setFormData({...formData, pessoa_id: v})}>
                          <SelectTrigger className="h-8 text-xs">
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

                    {/* CPF/CNPJ */}
                    {pessoaSelecionada && (
                      <div className="grid grid-cols-12 gap-3 items-center">
                        <Label className="col-span-3 text-right text-xs">CPF/CNPJ:</Label>
                        <div className="col-span-9">
                          <Input 
                            value={pessoaSelecionada.cnpj || pessoaSelecionada.cpf || ''} 
                            className="h-8 text-xs bg-slate-50" 
                            disabled 
                          />
                        </div>
                      </div>
                    )}

                    {/* Datas */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Data Documento: *</Label>
                      <div className="col-span-3">
                        <Input 
                          type="date" 
                          value={formData.data_documento} 
                          onChange={(e) => setFormData({...formData, data_documento: e.target.value})} 
                          className="h-8 text-xs"
                        />
                      </div>
                      <Label className="col-span-3 text-right text-xs">Data Vencimento: *</Label>
                      <div className="col-span-3">
                        <Input 
                          type="date" 
                          value={formData.data_vencimento} 
                          onChange={(e) => setFormData({...formData, data_vencimento: e.target.value})} 
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    {/* Valores */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Valor Líquido: *</Label>
                      <div className="col-span-3">
                        <Input 
                          type="number" 
                          step="0.01"
                          value={formData.valor_liquido} 
                          onChange={(e) => setFormData({...formData, valor_liquido: e.target.value})} 
                          className="h-8 text-xs"
                        />
                      </div>
                      <Label className="col-span-3 text-right text-xs">Desconto:</Label>
                      <div className="col-span-3">
                        <Input 
                          type="number" 
                          step="0.01"
                          value={formData.desconto} 
                          onChange={(e) => setFormData({...formData, desconto: e.target.value})} 
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Juros/Multa:</Label>
                      <div className="col-span-3">
                        <Input 
                          type="number" 
                          step="0.01"
                          value={formData.juros_multa} 
                          onChange={(e) => setFormData({...formData, juros_multa: e.target.value})} 
                          className="h-8 text-xs"
                        />
                      </div>
                      <Label className="col-span-3 text-right text-xs font-semibold">Valor Total:</Label>
                      <div className="col-span-3">
                        <Input 
                          value={formatarMoeda(parseFloat(formData.valor_total) || 0)} 
                          className="h-8 text-xs font-bold bg-green-50" 
                          disabled 
                        />
                      </div>
                    </div>

                    {/* Forma Pagamento */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Forma de Pagamento:</Label>
                      <div className="col-span-9">
                        <Select value={formData.forma_pagamento} onValueChange={(v) => setFormData({...formData, forma_pagamento: v})}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PIX">PIX</SelectItem>
                            <SelectItem value="Boleto">Boleto</SelectItem>
                            <SelectItem value="Transferência">Transferência (TED/DOC)</SelectItem>
                            <SelectItem value="Cartão">Cartão</SelectItem>
                            <SelectItem value="Cheque">Cheque</SelectItem>
                            <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Plano de Contas */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Plano de Contas: *</Label>
                      <div className="col-span-9">
                        <Select value={formData.plano_contas_id} onValueChange={(v) => setFormData({...formData, plano_contas_id: v})}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {planos.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.codigo} - {p.descricao}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Centro de Custo */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Centro de Custo:</Label>
                      <div className="col-span-9">
                        <Select value={formData.centro_custo_id} onValueChange={(v) => setFormData({...formData, centro_custo_id: v})}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {centros.map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Parcelamento */}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Parcelado:</Label>
                      <div className="col-span-2 flex items-center gap-2">
                        <Switch 
                          checked={formData.parcelado} 
                          onCheckedChange={(v) => setFormData({...formData, parcelado: v})}
                        />
                        <span className="text-xs">{formData.parcelado ? 'Sim' : 'Não'}</span>
                      </div>
                      {formData.parcelado && (
                        <>
                          <Label className="col-span-2 text-right text-xs">Nº Parcelas:</Label>
                          <div className="col-span-2">
                            <Input 
                              type="number"
                              value={formData.numero_parcelas} 
                              onChange={(e) => setFormData({...formData, numero_parcelas: e.target.value})} 
                              className="h-8 text-xs"
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Observações */}
                    <div className="grid grid-cols-12 gap-3 items-start">
                      <Label className="col-span-3 text-right text-xs pt-2">Observações:</Label>
                      <div className="col-span-9">
                        <Textarea 
                          value={formData.observacoes} 
                          onChange={(e) => setFormData({...formData, observacoes: e.target.value})} 
                          className="text-xs uppercase min-h-20"
                          style={{ textTransform: 'uppercase' }}
                          rows={3}
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* ABA 2 - PRODUTOS/ITENS */}
                <TabsContent value="itens" className="p-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-semibold">Itens do Lançamento</h3>
                      <Button 
                        size="sm" 
                        onClick={() => {
                          const novosItens = [...(formData.itens || []), {
                            id: Date.now(),
                            produto: "",
                            descricao: "",
                            quantidade: "1",
                            preco_unitario: "0",
                            total: "0",
                            cfop: ""
                          }];
                          setFormData({...formData, itens: novosItens});
                        }}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Adicionar Item
                      </Button>
                    </div>

                    <div className="border rounded overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="h-8 text-xs w-8">#</TableHead>
                            <TableHead className="h-8 text-xs">Produto/Serviço</TableHead>
                            <TableHead className="h-8 text-xs">Descrição</TableHead>
                            <TableHead className="h-8 text-xs w-24">Qtd</TableHead>
                            <TableHead className="h-8 text-xs w-32">Preço Unit.</TableHead>
                            <TableHead className="h-8 text-xs w-32">Total</TableHead>
                            <TableHead className="h-8 text-xs w-24">CFOP</TableHead>
                            <TableHead className="h-8 text-xs w-16"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(!formData.itens || formData.itens.length === 0) ? (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center py-6 text-xs text-slate-400">
                                Nenhum item adicionado. Clique em "Adicionar Item" para começar.
                              </TableCell>
                            </TableRow>
                          ) : (
                            formData.itens.map((item, index) => {
                              const total = (parseFloat(item.quantidade) || 0) * (parseFloat(item.preco_unitario) || 0);
                              return (
                                <TableRow key={item.id}>
                                  <TableCell className="py-2 text-xs">{index + 1}</TableCell>
                                  <TableCell className="py-2">
                                    <Input 
                                      value={item.produto} 
                                      onChange={(e) => {
                                        const novosItens = [...formData.itens];
                                        novosItens[index].produto = e.target.value;
                                        setFormData({...formData, itens: novosItens});
                                      }}
                                      className="h-7 text-xs"
                                      placeholder="Nome do produto"
                                    />
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Input 
                                      value={item.descricao} 
                                      onChange={(e) => {
                                        const novosItens = [...formData.itens];
                                        novosItens[index].descricao = e.target.value;
                                        setFormData({...formData, itens: novosItens});
                                      }}
                                      className="h-7 text-xs"
                                      placeholder="Descrição"
                                    />
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Input 
                                      type="number"
                                      step="0.01"
                                      value={item.quantidade} 
                                      onChange={(e) => {
                                        const novosItens = [...formData.itens];
                                        novosItens[index].quantidade = e.target.value;
                                        setFormData({...formData, itens: novosItens});
                                      }}
                                      className="h-7 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Input 
                                      type="number"
                                      step="0.01"
                                      value={item.preco_unitario} 
                                      onChange={(e) => {
                                        const novosItens = [...formData.itens];
                                        novosItens[index].preco_unitario = e.target.value;
                                        setFormData({...formData, itens: novosItens});
                                      }}
                                      className="h-7 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="py-2 text-xs font-mono font-semibold">
                                    {formatarMoeda(total)}
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Input 
                                      value={item.cfop} 
                                      onChange={(e) => {
                                        const novosItens = [...formData.itens];
                                        novosItens[index].cfop = e.target.value;
                                        setFormData({...formData, itens: novosItens});
                                      }}
                                      className="h-7 text-xs"
                                      placeholder="5102"
                                    />
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Button 
                                      variant="ghost" 
                                      size="icon"
                                      onClick={() => {
                                        const novosItens = formData.itens.filter((_, i) => i !== index);
                                        setFormData({...formData, itens: novosItens});
                                      }}
                                      className="h-7 w-7 text-red-600"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {formData.itens && formData.itens.length > 0 && (
                      <div className="bg-slate-50 p-3 rounded border">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-semibold">Subtotal dos Itens:</span>
                          <span className="text-lg font-bold text-blue-600">
                            {formatarMoeda(
                              formData.itens.reduce((sum, item) => {
                                return sum + ((parseFloat(item.quantidade) || 0) * (parseFloat(item.preco_unitario) || 0));
                              }, 0)
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* ABA 3 - INFORMAÇÕES FISCAIS */}
                <TabsContent value="fiscal" className="p-4">
                  <div className="space-y-3">
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Tipo Documento Fiscal:</Label>
                      <div className="col-span-9">
                        <Select value={formData.tipo_documento_fiscal} onValueChange={(v) => setFormData({...formData, tipo_documento_fiscal: v})}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NF-e">NF-e</SelectItem>
                            <SelectItem value="NFS-e">NFS-e</SelectItem>
                            <SelectItem value="NFC-e">NFC-e</SelectItem>
                            <SelectItem value="Sem Documento">Sem Documento</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Número NF:</Label>
                      <div className="col-span-3">
                        <Input value={formData.numero_nf} onChange={(e) => setFormData({...formData, numero_nf: e.target.value})} className="h-8 text-xs" />
                      </div>
                      <Label className="col-span-3 text-right text-xs">Chave NF-e:</Label>
                      <div className="col-span-3">
                        <Input value={formData.chave_nf} onChange={(e) => setFormData({...formData, chave_nf: e.target.value})} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">CFOP:</Label>
                      <div className="col-span-9">
                        <Input value={formData.cfop} onChange={(e) => setFormData({...formData, cfop: e.target.value})} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="mt-4 mb-2 pb-2 border-b">
                      <h3 className="text-xs font-semibold">ICMS</h3>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Base ICMS:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.icms_base} onChange={(e) => setFormData({...formData, icms_base: e.target.value})} className="h-8 text-xs" />
                      </div>
                      <Label className="col-span-3 text-right text-xs">Alíquota %:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.icms_aliquota} onChange={(e) => setFormData({...formData, icms_aliquota: e.target.value})} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="mt-4 mb-2 pb-2 border-b">
                      <h3 className="text-xs font-semibold">PIS / COFINS</h3>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Base PIS:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.pis_base} onChange={(e) => setFormData({...formData, pis_base: e.target.value})} className="h-8 text-xs" />
                      </div>
                      <Label className="col-span-3 text-right text-xs">Alíquota %:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.pis_aliquota} onChange={(e) => setFormData({...formData, pis_aliquota: e.target.value})} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Base COFINS:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.cofins_base} onChange={(e) => setFormData({...formData, cofins_base: e.target.value})} className="h-8 text-xs" />
                      </div>
                      <Label className="col-span-3 text-right text-xs">Alíquota %:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.cofins_aliquota} onChange={(e) => setFormData({...formData, cofins_aliquota: e.target.value})} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="mt-4 mb-2 pb-2 border-b">
                      <h3 className="text-xs font-semibold">ISS</h3>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Base ISS:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.iss_base} onChange={(e) => setFormData({...formData, iss_base: e.target.value})} className="h-8 text-xs" />
                      </div>
                      <Label className="col-span-3 text-right text-xs">Alíquota %:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.iss_aliquota} onChange={(e) => setFormData({...formData, iss_aliquota: e.target.value})} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="mt-4 mb-2 pb-2 border-b">
                      <h3 className="text-xs font-semibold">Retenções na Fonte</h3>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">IRRF:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.irrf_valor} onChange={(e) => setFormData({...formData, irrf_valor: e.target.value})} className="h-8 text-xs" />
                      </div>
                      <Label className="col-span-3 text-right text-xs">INSS:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.inss_valor} onChange={(e) => setFormData({...formData, inss_valor: e.target.value})} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">CSLL:</Label>
                      <div className="col-span-3">
                        <Input type="number" step="0.01" value={formData.csll_valor} onChange={(e) => setFormData({...formData, csll_valor: e.target.value})} className="h-8 text-xs" />
                      </div>
                    </div>

                    <div className="mt-4 bg-blue-50 p-3 rounded border border-blue-200">
                      <div className="flex gap-2">
                        <Upload className="w-4 h-4 text-blue-600 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-blue-900">Importar XML da NF-e</p>
                          <p className="text-xs text-blue-700 mt-1">Faça upload do arquivo XML para preencher automaticamente os dados fiscais</p>
                          <Button size="sm" variant="outline" className="mt-2">
                            <Upload className="w-3 h-3 mr-1" />
                            Selecionar XML
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* ABA 4 - RATEIO */}
                <TabsContent value="rateio" className="p-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-sm font-semibold">Rateio de Centro de Custo</h3>
                        <p className="text-xs text-slate-600">Distribua o valor entre diferentes centros de custo</p>
                      </div>
                      <Button 
                        size="sm" 
                        onClick={() => {
                          const novosRateios = [...(formData.rateio || []), {
                            id: Date.now(),
                            centro_custo_id: "",
                            percentual: "0",
                            valor: "0",
                            observacao: ""
                          }];
                          setFormData({...formData, rateio: novosRateios});
                        }}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Adicionar Rateio
                      </Button>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center bg-slate-50 p-3 rounded">
                      <Label className="col-span-3 text-xs">Tipo de Rateio:</Label>
                      <div className="col-span-9">
                        <Select defaultValue="percentual">
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentual">Percentual (%)</SelectItem>
                            <SelectItem value="valor">Valor Fixo (R$)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="border rounded overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="h-8 text-xs w-8">#</TableHead>
                            <TableHead className="h-8 text-xs">Centro de Custo</TableHead>
                            <TableHead className="h-8 text-xs w-32">Percentual %</TableHead>
                            <TableHead className="h-8 text-xs w-32">Valor R$</TableHead>
                            <TableHead className="h-8 text-xs">Observação</TableHead>
                            <TableHead className="h-8 text-xs w-16"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(!formData.rateio || formData.rateio.length === 0) ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-6 text-xs text-slate-400">
                                Nenhum rateio configurado. Use o centro de custo principal ou adicione rateios.
                              </TableCell>
                            </TableRow>
                          ) : (
                            formData.rateio.map((rat, index) => {
                              const valorTotal = parseFloat(formData.valor_total) || 0;
                              const valorCalculado = (valorTotal * (parseFloat(rat.percentual) || 0)) / 100;
                              return (
                                <TableRow key={rat.id}>
                                  <TableCell className="py-2 text-xs">{index + 1}</TableCell>
                                  <TableCell className="py-2">
                                    <Select 
                                      value={rat.centro_custo_id} 
                                      onValueChange={(v) => {
                                        const novosRateios = [...formData.rateio];
                                        novosRateios[index].centro_custo_id = v;
                                        setFormData({...formData, rateio: novosRateios});
                                      }}
                                    >
                                      <SelectTrigger className="h-7 text-xs">
                                        <SelectValue placeholder="Selecione" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {centros.map(c => (
                                          <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Input 
                                      type="number"
                                      step="0.01"
                                      value={rat.percentual} 
                                      onChange={(e) => {
                                        const novosRateios = [...formData.rateio];
                                        novosRateios[index].percentual = e.target.value;
                                        setFormData({...formData, rateio: novosRateios});
                                      }}
                                      className="h-7 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="py-2 text-xs font-mono">
                                    {formatarMoeda(valorCalculado)}
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Input 
                                      value={rat.observacao} 
                                      onChange={(e) => {
                                        const novosRateios = [...formData.rateio];
                                        novosRateios[index].observacao = e.target.value;
                                        setFormData({...formData, rateio: novosRateios});
                                      }}
                                      className="h-7 text-xs"
                                      placeholder="Observação..."
                                    />
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Button 
                                      variant="ghost" 
                                      size="icon"
                                      onClick={() => {
                                        const novosRateios = formData.rateio.filter((_, i) => i !== index);
                                        setFormData({...formData, rateio: novosRateios});
                                      }}
                                      className="h-7 w-7 text-red-600"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {formData.rateio && formData.rateio.length > 0 && (
                      <div className="bg-slate-50 p-3 rounded border">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-semibold">Total Rateado:</span>
                          <span className={`text-lg font-bold ${
                            Math.abs(formData.rateio.reduce((sum, r) => sum + (parseFloat(r.percentual) || 0), 0) - 100) < 0.01
                              ? 'text-green-600'
                              : 'text-red-600'
                          }`}>
                            {formData.rateio.reduce((sum, r) => sum + (parseFloat(r.percentual) || 0), 0).toFixed(2)}%
                          </span>
                        </div>
                        {Math.abs(formData.rateio.reduce((sum, r) => sum + (parseFloat(r.percentual) || 0), 0) - 100) >= 0.01 && (
                          <div className="flex items-center gap-2 mt-2 text-xs text-red-600">
                            <AlertTriangle className="w-3 h-3" />
                            <span>O total deve somar 100%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* ABA 5 - ANEXOS */}
                <TabsContent value="anexos" className="p-4">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Documentos e Anexos</h3>
                      <p className="text-xs text-slate-600">Adicione comprovantes, notas fiscais, contratos e outros documentos</p>
                    </div>

                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                      <Upload className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                      <p className="text-sm text-slate-600 mb-2">Arraste arquivos aqui ou clique para selecionar</p>
                      <p className="text-xs text-slate-500">PDF, XML, JPG, PNG até 10MB</p>
                      <Button size="sm" variant="outline" className="mt-3">
                        <Upload className="w-3 h-3 mr-1" />
                        Escolher Arquivos
                      </Button>
                    </div>

                    {formData.anexos && formData.anexos.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold">Arquivos Anexados:</h4>
                        <div className="grid grid-cols-2 gap-2">
                          {formData.anexos.map((anexo, index) => (
                            <div key={index} className="flex items-center gap-2 p-2 border rounded hover:bg-slate-50">
                              <FileText className="w-8 h-8 text-blue-600" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{anexo}</p>
                                <p className="text-xs text-slate-500">-</p>
                              </div>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => {
                                  const novosAnexos = formData.anexos.filter((_, i) => i !== index);
                                  setFormData({...formData, anexos: novosAnexos});
                                }}
                                className="h-6 w-6 text-red-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="border-t pt-4 mt-4">
                      <h4 className="text-sm font-semibold mb-3">Histórico de Ações</h4>
                      <div className="space-y-2">
                        <div className="flex gap-3 text-xs">
                          <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5"></div>
                          <div className="flex-1">
                            <p className="font-medium">Lançamento criado</p>
                            <p className="text-slate-500">Por: {formData.origem} • Hoje às 14:30</p>
                          </div>
                        </div>
                        {editingId && (
                          <div className="flex gap-3 text-xs">
                            <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5"></div>
                            <div className="flex-1">
                              <p className="font-medium">Lançamento em edição</p>
                              <p className="text-slate-500">Última modificação: Agora</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="border-t pt-4 mt-4">
                      <h4 className="text-sm font-semibold mb-3">Comentários Internos</h4>
                      <div className="space-y-2">
                        <Textarea 
                          placeholder="Adicione um comentário para a equipe financeira..."
                          className="text-xs min-h-20"
                          rows={3}
                        />
                        <div className="flex justify-end">
                          <Button size="sm">
                            <Plus className="w-3 h-3 mr-1" />
                            Adicionar Comentário
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* ABA 6 - APROVAÇÃO */}
                <TabsContent value="aprovacao" className="p-4">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Controle de Aprovação</h3>
                      <p className="text-xs text-slate-600">Configure o fluxo de aprovação para este lançamento</p>
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <Label className="col-span-3 text-right text-xs">Requer Aprovação:</Label>
                      <div className="col-span-9 flex items-center gap-2">
                        <Switch 
                          checked={formData.requer_aprovacao} 
                          onCheckedChange={(v) => setFormData({...formData, requer_aprovacao: v})}
                        />
                        <span className="text-xs font-medium">{formData.requer_aprovacao ? 'Sim' : 'Não'}</span>
                      </div>
                    </div>

                    {formData.requer_aprovacao && (
                      <>
                        <div className="grid grid-cols-12 gap-3 items-center">
                          <Label className="col-span-3 text-right text-xs">Status Aprovação:</Label>
                          <div className="col-span-9">
                            <Select value={formData.status_aprovacao} onValueChange={(v) => setFormData({...formData, status_aprovacao: v})}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Pendente">Pendente</SelectItem>
                                <SelectItem value="Aprovado">Aprovado</SelectItem>
                                <SelectItem value="Rejeitado">Rejeitado</SelectItem>
                                <SelectItem value="Em Revisão">Em Revisão</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="bg-slate-50 p-4 rounded border">
                          <h4 className="text-xs font-semibold mb-3">Linha do Tempo de Aprovação</h4>
                          <div className="space-y-3">
                            <div className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                  formData.status_aprovacao === 'Pendente' ? 'bg-yellow-100' :
                                  formData.status_aprovacao === 'Aprovado' ? 'bg-green-100' :
                                  formData.status_aprovacao === 'Rejeitado' ? 'bg-red-100' :
                                  'bg-blue-100'
                                }`}>
                                  {formData.status_aprovacao === 'Aprovado' ? (
                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                  ) : formData.status_aprovacao === 'Rejeitado' ? (
                                    <X className="w-4 h-4 text-red-600" />
                                  ) : (
                                    <AlertTriangle className="w-4 h-4 text-yellow-600" />
                                  )}
                                </div>
                                <div className="w-0.5 h-8 bg-slate-200"></div>
                              </div>
                              <div className="flex-1 pb-4">
                                <p className="text-xs font-semibold">Status Atual: {formData.status_aprovacao}</p>
                                <p className="text-xs text-slate-500 mt-1">
                                  {formData.status_aprovacao === 'Pendente' && 'Aguardando aprovação do responsável'}
                                  {formData.status_aprovacao === 'Aprovado' && 'Lançamento aprovado e liberado'}
                                  {formData.status_aprovacao === 'Rejeitado' && 'Lançamento rejeitado - verificar observações'}
                                  {formData.status_aprovacao === 'Em Revisão' && 'Em análise pela equipe financeira'}
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                                  <Eye className="w-4 h-4 text-slate-400" />
                                </div>
                              </div>
                              <div className="flex-1">
                                <p className="text-xs font-semibold">Lançamento Criado</p>
                                <p className="text-xs text-slate-500 mt-1">Por: {formData.origem}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-12 gap-3 items-start">
                          <Label className="col-span-3 text-right text-xs pt-2">Justificativa:</Label>
                          <div className="col-span-9">
                            <Textarea 
                              placeholder="Adicione uma justificativa para aprovação/rejeição..."
                              className="text-xs min-h-20"
                              rows={3}
                            />
                          </div>
                        </div>

                        <div className="flex gap-2 justify-end pt-3 border-t">
                          <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50">
                            <X className="w-3 h-3 mr-1" />
                            Rejeitar
                          </Button>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Aprovar
                          </Button>
                        </div>
                      </>
                    )}

                    {!formData.requer_aprovacao && (
                      <div className="text-center py-8 text-slate-500">
                        <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">Aprovação não necessária para este lançamento</p>
                        <p className="text-xs mt-1">Ative a opção acima para configurar o fluxo de aprovação</p>
                      </div>
                    )}

                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                      <div className="flex gap-2">
                        <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-blue-900">Regras de Aprovação</p>
                          <p className="text-xs text-blue-700 mt-1">
                            • Valores acima de R$ 10.000,00 requerem aprovação automática<br/>
                            • Lançamentos com status "Rascunho" não precisam de aprovação<br/>
                            • Apenas usuários com permissão podem aprovar/rejeitar
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </Card>
          </div>

          {/* PAINEL LATERAL - RESUMO */}
          <div className="col-span-3">
            <Card className="border shadow-sm sticky top-4">
              <CardHeader className="border-b bg-slate-50 pb-3">
                <CardTitle className="text-sm">Resumo Financeiro</CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-600">Valor Líquido:</span>
                    <span className="font-semibold">{formatarMoeda(parseFloat(formData.valor_liquido) || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-600">Desconto:</span>
                    <span className="text-green-600">- {formatarMoeda(parseFloat(formData.desconto) || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-600">Juros/Multa:</span>
                    <span className="text-red-600">+ {formatarMoeda(parseFloat(formData.juros_multa) || 0)}</span>
                  </div>
                  <div className="pt-2 border-t flex justify-between items-center">
                    <span className="text-xs font-semibold">Valor Total:</span>
                    <span className="text-base font-bold text-blue-600">{formatarMoeda(parseFloat(formData.valor_total) || 0)}</span>
                  </div>
                </div>

                {/* Alertas */}
                <div className="space-y-2 pt-3 border-t">
                  {!formData.pessoa_id && (
                    <div className="flex items-start gap-2 p-2 bg-yellow-50 rounded text-xs">
                      <AlertTriangle className="w-3 h-3 text-yellow-600 mt-0.5" />
                      <span className="text-yellow-800">Selecione uma pessoa</span>
                    </div>
                  )}
                  {!formData.plano_contas_id && (
                    <div className="flex items-start gap-2 p-2 bg-yellow-50 rounded text-xs">
                      <AlertTriangle className="w-3 h-3 text-yellow-600 mt-0.5" />
                      <span className="text-yellow-800">Selecione um plano de contas</span>
                    </div>
                  )}
                  {formData.valor_liquido && parseFloat(formData.valor_liquido) > 0 && (
                    <div className="flex items-start gap-2 p-2 bg-green-50 rounded text-xs">
                      <CheckCircle className="w-3 h-3 text-green-600 mt-0.5" />
                      <span className="text-green-800">Dados financeiros OK</span>
                    </div>
                  )}
                </div>

                {/* Informações */}
                <div className="pt-3 border-t space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Tipo:</span>
                    <Badge variant="outline" className="text-xs">{formData.tipo}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Status:</span>
                    <Badge variant="outline" className="text-xs">{formData.status}</Badge>
                  </div>
                  {formData.parcelado && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Parcelas:</span>
                      <span className="font-medium">{formData.numero_parcelas || '-'}x</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}