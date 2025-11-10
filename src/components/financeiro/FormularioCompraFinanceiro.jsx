import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ShoppingCart, Save, X, Plus, Trash2, ChevronRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import DialogCadastroRapido from "./DialogCadastroRapido.jsx";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  const numStr = String(num).replace('.', ',');
  const [inteiro, decimal] = numStr.split(',');
  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${inteiroFormatado},${decimal}` : inteiroFormatado;
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const calcularDataProximaMes = (dataBase) => {
  if (!dataBase) return new Date().toISOString().split('T')[0];
  try {
    const data = new Date(dataBase + "T00:00:00");
    if (isNaN(data.getTime())) return new Date().toISOString().split('T')[0];
    data.setMonth(data.getMonth() + 1);
    return data.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

export default function FormularioCompraFinanceiro({ onSubmit, onCancel, initialData, fornecedores, produtos }) {
  const [etapa, setEtapa] = useState(1);
  const [formData, setFormData] = useState(() => {
    const defaults = {
      tipo: "Pagar",
      tipo_documento: "NF-e",
      fornecedor_id: "",
      data_emissao: new Date().toISOString().split('T')[0],
      data_vencimento: new Date().toISOString().split('T')[0],
      numero_documento: "",
      chave_nfe: "",
      serie_documento: "",
      safra_id: "",
      centro_custo_id: "",
      plano_contas_id: "",
      grupo_id: "",
      forma_pagamento_id: "",
      parcelar: false,
      parcelas: [],
      produtos_selecionados: [],
      observacoes: "",
      frete: "0,00",
      desconto_total: "0,00",
      outras_despesas: "0,00"
    };

    if (!initialData) return defaults;

    return {
      ...defaults,
      ...initialData,
      frete: initialData.frete ? formatarNumero(initialData.frete) : defaults.frete,
      desconto_total: initialData.desconto_total ? formatarNumero(initialData.desconto_total) : defaults.desconto_total,
      outras_despesas: initialData.outras_despesas ? formatarNumero(initialData.outras_despesas) : defaults.outras_despesas,
      produtos_selecionados: initialData.produtos_selecionados || [],
      parcelas: initialData.parcelas?.map(p => ({
        data: p.data,
        valor: formatarNumero(p.valor || 0)
      })) || []
    };
  });

  const [showDialogCentro, setShowDialogCentro] = useState(false);
  const [showDialogPlano, setShowDialogPlano] = useState(false);
  const [showDialogGrupo, setShowDialogGrupo] = useState(false);
  const [showDialogForma, setShowDialogForma] = useState(false);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: safras = [] } = useQuery({
    queryKey: ['safras_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: planos = [] } = useQuery({
    queryKey: ['planos_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false && p.tipo === 'Despesa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.ativo !== false && g.tipo === 'Despesa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: formasPagamento = [] } = useQuery({
    queryKey: ['formas_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FormaPagamento.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId && f.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    if (formData.parcelar && formData.parcelas.length === 0 && formData.data_vencimento) {
      const subtotalProdutos = formData.produtos_selecionados.reduce((sum, p) => 
        sum + (parseNumero(p.quantidade || "0") * parseNumero(p.valor_unitario || "0")), 0
      );
      const valorTotal = subtotalProdutos + parseNumero(formData.frete) + parseNumero(formData.outras_despesas) - parseNumero(formData.desconto_total);
      const valorParcela = valorTotal / 2;
      
      setFormData(prev => ({
        ...prev,
        parcelas: [
          { data: prev.data_vencimento, valor: formatarNumero(valorParcela) },
          { data: calcularDataProximaMes(prev.data_vencimento), valor: formatarNumero(valorParcela) }
        ]
      }));
    }
  }, [formData.parcelar, formData.data_vencimento]);

  const adicionarParcela = () => {
    const ultimaParcela = formData.parcelas[formData.parcelas.length - 1];
    const proximaData = ultimaParcela ? calcularDataProximaMes(ultimaParcela.data) : formData.data_vencimento;
    
    const subtotalProdutos = formData.produtos_selecionados.reduce((sum, p) => 
      sum + (parseNumero(p.quantidade || "0") * parseNumero(p.valor_unitario || "0")), 0
    );
    const valorTotal = subtotalProdutos + parseNumero(formData.frete) + parseNumero(formData.outras_despesas) - parseNumero(formData.desconto_total);
    const newNumberOfParcelas = formData.parcelas.length + 1;
    const equalParcelValue = valorTotal / newNumberOfParcelas;

    const updatedParcelas = Array.from({ length: newNumberOfParcelas }, (_, i) => {
      const currentParcel = formData.parcelas[i];
      let date = currentParcel?.data || (i === 0 ? formData.data_vencimento : calcularDataProximaMes(formData.parcelas[i-1]?.data || formData.data_vencimento));
      if (i === newNumberOfParcelas - 1 && !ultimaParcela) {
        date = proximaData;
      } else if (i === newNumberOfParcelas - 1 && ultimaParcela) {
        date = calcularDataProximaMes(formData.parcelas[i-1]?.data || formData.data_vencimento);
      }

      return {
        data: date,
        valor: formatarNumero(equalParcelValue)
      };
    });
    
    setFormData(prev => ({ ...prev, parcelas: updatedParcelas }));
  };

  const removerParcela = (index) => {
    if (formData.parcelas.length <= 1) {
      toast.error('Mínimo de 1 parcela!');
      return;
    }
    const newParcelas = formData.parcelas.filter((_, i) => i !== index);
    const subtotalProdutos = formData.produtos_selecionados.reduce((sum, p) => 
      sum + (parseNumero(p.quantidade || "0") * parseNumero(p.valor_unitario || "0")), 0
    );
    const valorTotal = subtotalProdutos + parseNumero(formData.frete) + parseNumero(formData.outras_despesas) - parseNumero(formData.desconto_total);
    const equalParcelValue = valorTotal / newParcelas.length;

    const updatedParcelas = newParcelas.map(p => ({
      ...p,
      valor: formatarNumero(equalParcelValue)
    }));
    
    setFormData(prev => ({ ...prev, parcelas: updatedParcelas }));
  };

  const atualizarParcela = (index, campo, valor) => {
    setFormData(prev => ({
      ...prev,
      parcelas: prev.parcelas.map((p, i) => i === index ? { ...p, [campo]: valor } : p)
    }));
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAdicionarProduto = () => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: [
        ...prev.produtos_selecionados,
        { produto_id: "", produto_nome: "", quantidade: "", valor_unitario: "", desconto_item: "0,00" }
      ]
    }));
  };

  const handleRemoverProduto = (index) => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.filter((_, i) => i !== index)
    }));
  };

  const handleAtualizarProduto = (index, campo, valor) => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.map((p, i) => {
        if (i === index) {
          const updated = { ...p, [campo]: valor };
          
          if (campo === 'produto_id') {
            const produto = produtos.find(prod => prod.id === valor);
            if (produto) {
              updated.produto_nome = produto.nome_produto;
              updated.unidade = produto.unidade_medida;
              updated.valor_unitario = produto.preco_custo ? formatarNumero(produto.preco_custo) : "";
            }
          }
          
          return updated;
        }
        return p;
      })
    }));
  };

  const handleProximaEtapa = () => {
    if (!formData.fornecedor_id) {
      toast.error('❌ Selecione o fornecedor!');
      return;
    }

    if (!formData.data_emissao) {
      toast.error('❌ Preencha a data de emissão!');
      return;
    }

    if (formData.produtos_selecionados.length === 0) {
      toast.error('❌ Adicione pelo menos 1 produto!');
      return;
    }

    const produtosIncompletos = formData.produtos_selecionados.filter(p => 
      !p.produto_id || !p.quantidade || !p.valor_unitario
    );

    if (produtosIncompletos.length > 0) {
      toast.error('❌ Preencha todos os campos dos produtos!');
      return;
    }

    setEtapa(2);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.data_vencimento) {
      toast.error('❌ Preencha a data de vencimento!');
      return;
    }

    if (!formData.plano_contas_id) {
      toast.error('❌ Selecione o plano de contas!');
      return;
    }

    if (!formData.grupo_id) {
      toast.error('❌ Selecione o grupo financeiro!');
      return;
    }

    if (formData.parcelar && formData.parcelas.length < 2) {
      toast.error('❌ Mínimo 2 parcelas!');
      return;
    }

    if (formData.parcelar) {
      const subtotalProdutos = formData.produtos_selecionados.reduce((sum, p) => 
        sum + (parseNumero(p.quantidade || "0") * parseNumero(p.valor_unitario || "0")), 0
      );
      const valorTotal = subtotalProdutos + parseNumero(formData.frete) + parseNumero(formData.outras_despesas) - parseNumero(formData.desconto_total);
      const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);
      
      if (Math.abs(totalParcelas - valorTotal) > 0.01) {
        toast.error('❌ Total das parcelas diferente do valor total!');
        return;
      }
    }

    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const safra = safras.find(s => s.id === formData.safra_id);
    const centro = centros.find(c => c.id === formData.centro_custo_id);
    const plano = planos.find(p => p.id === formData.plano_contas_id);
    const grupo = grupos.find(g => g.id === formData.grupo_id);
    const forma = formasPagamento.find(f => f.id === formData.forma_pagamento_id);

    const data = {
      tipo: formData.tipo,
      tipo_documento: formData.tipo_documento,
      fornecedor_id: formData.fornecedor_id,
      fornecedor_nome: fornecedor?.nome,
      safra_id: formData.safra_id || undefined,
      safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome,
      plano_contas_id: formData.plano_contas_id,
      plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
      grupo_id: formData.grupo_id,
      grupo_nome: grupo?.descricao,
      forma_pagamento_id: formData.forma_pagamento_id || undefined,
      forma_pagamento_nome: forma?.descricao,
      numero_documento: formData.numero_documento?.toUpperCase() || undefined,
      chave_nfe: formData.chave_nfe || undefined,
      serie_documento: formData.serie_documento || undefined,
      data_emissao: formData.data_emissao,
      data_vencimento: formData.data_vencimento,
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      produtos_selecionados: formData.produtos_selecionados.map(p => ({
        produto_id: p.produto_id,
        produto_nome: p.produto_nome,
        quantidade: parseNumero(p.quantidade),
        unidade: p.unidade,
        valor_unitario: parseNumero(p.valor_unitario),
        desconto_item: parseNumero(p.desconto_item || "0,00")
      })),
      frete: parseNumero(formData.frete),
      desconto_total: parseNumero(formData.desconto_total),
      outras_despesas: parseNumero(formData.outras_despesas),
      parcelar: formData.parcelar,
      parcelas: formData.parcelar ? formData.parcelas.map(p => ({ 
        data: p.data, 
        valor: parseNumero(p.valor) 
      })) : undefined
    };

    onSubmit(data);
  };

  const subtotalProdutos = formData.produtos_selecionados.reduce((sum, p) => {
    const qtd = parseNumero(p.quantidade || "0");
    const vlrUnit = parseNumero(p.valor_unitario || "0");
    const desc = parseNumero(p.desconto_item || "0,00");
    return sum + (qtd * vlrUnit - desc);
  }, 0);

  const valorTotal = subtotalProdutos + parseNumero(formData.frete) + parseNumero(formData.outras_despesas) - parseNumero(formData.desconto_total);
  const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-xl border-slate-200 bg-white">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
            <CardTitle className="flex items-center gap-3 text-slate-900">
              <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-white" />
              </div>
              Novo Lançamento - Etapa {etapa} de 2
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* ETAPA 1: DADOS DA COMPRA */}
              {etapa === 1 && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label>Fornecedor *</Label>
                      <Select value={formData.fornecedor_id} onValueChange={(v) => handleChange('fornecedor_id', v)}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {fornecedores.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Tipo Documento *</Label>
                      <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NF-e">NF-e</SelectItem>
                          <SelectItem value="NFC-e">NFC-e</SelectItem>
                          <SelectItem value="Recibo">Recibo</SelectItem>
                          <SelectItem value="Boleto">Boleto</SelectItem>
                          <SelectItem value="Nota Manual">Nota Manual</SelectItem>
                          <SelectItem value="Outros">Outros</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Data Emissão *</Label>
                      <Input type="date" value={formData.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} required />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label>Nº Documento</Label>
                      <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>

                    <div className="space-y-2">
                      <Label>Série</Label>
                      <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="1" className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>

                    <div className="space-y-2">
                      <Label>Safra</Label>
                      <Select value={formData.safra_id} onValueChange={(v) => handleChange('safra_id', v)}>
                        <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                        <SelectContent>
                          {safras.map(s => <SelectItem key={s.id} value={s.id}>{s.ano_inicio}/{s.ano_fim} - {s.descricao}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Chave NF-e (44 dígitos)</Label>
                    <Input 
                      value={formData.chave_nfe} 
                      onChange={(e) => handleChange('chave_nfe', e.target.value)} 
                      placeholder="00000000000000000000000000000000000000000000" 
                      maxLength={44}
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <Label className="font-semibold">Produtos *</Label>
                      <Button type="button" size="sm" onClick={handleAdicionarProduto} className="h-8 gap-1 text-xs">
                        <Plus className="w-3 h-3" />
                        Adicionar
                      </Button>
                    </div>

                    {formData.produtos_selecionados.length > 0 && (
                      <div className="border rounded overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Produto *</TableHead>
                              <TableHead className="text-xs text-right">Qtd *</TableHead>
                              <TableHead className="text-xs text-right">Vlr Unit. *</TableHead>
                              <TableHead className="text-xs text-right">Desc.</TableHead>
                              <TableHead className="text-xs text-right">Total</TableHead>
                              <TableHead className="w-12"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {formData.produtos_selecionados.map((produto, index) => {
                              const total = parseNumero(produto.quantidade || "0") * parseNumero(produto.valor_unitario || "0") - parseNumero(produto.desconto_item || "0,00");
                              
                              return (
                                <TableRow key={index}>
                                  <TableCell>
                                    <Select 
                                      value={produto.produto_id} 
                                      onValueChange={(v) => handleAtualizarProduto(index, 'produto_id', v)}
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Selecione" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {produtos.map(p => (
                                          <SelectItem key={p.id} value={p.id} className="text-xs">
                                            {p.nome_produto}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={produto.quantidade}
                                      onChange={(e) => handleAtualizarProduto(index, 'quantidade', e.target.value)}
                                      placeholder="0,00"
                                      className="text-right h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={produto.valor_unitario}
                                      onChange={(e) => handleAtualizarProduto(index, 'valor_unitario', e.target.value)}
                                      placeholder="0,00"
                                      className="text-right h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={produto.desconto_item || "0,00"}
                                      onChange={(e) => handleAtualizarProduto(index, 'desconto_item', e.target.value)}
                                      placeholder="0,00"
                                      className="text-right h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <span className="font-mono font-bold text-green-700 text-xs">
                                      {formatarMoeda(total)}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleRemoverProduto(index)}
                                      className="h-7 w-7 text-red-600"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Frete</Label>
                      <Input value={formData.frete} onChange={(e) => handleChange('frete', e.target.value)} placeholder="0,00" />
                    </div>
                    <div className="space-y-2">
                      <Label>Desconto Geral</Label>
                      <Input value={formData.desconto_total} onChange={(e) => handleChange('desconto_total', e.target.value)} placeholder="0,00" />
                    </div>
                    <div className="space-y-2">
                      <Label>Outras Despesas</Label>
                      <Input value={formData.outras_despesas} onChange={(e) => handleChange('outras_despesas', e.target.value)} placeholder="0,00" />
                    </div>
                  </div>

                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="p-4 flex justify-between items-center">
                      <span className="font-semibold text-slate-700">Subtotal Produtos:</span>
                      <span className="text-2xl font-bold text-blue-700">{formatarMoeda(subtotalProdutos)}</span>
                    </CardContent>
                  </Card>

                  <Card className="bg-emerald-50 border-emerald-200">
                    <CardContent className="p-4">
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span>Subtotal:</span>
                          <span className="font-mono">{formatarMoeda(subtotalProdutos)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>+ Frete:</span>
                          <span className="font-mono">{formatarMoeda(parseNumero(formData.frete))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>+ Outras Despesas:</span>
                          <span className="font-mono">{formatarMoeda(parseNumero(formData.outras_despesas))}</span>
                        </div>
                        <div className="flex justify-between text-red-600">
                          <span>- Desconto:</span>
                          <span className="font-mono">{formatarMoeda(parseNumero(formData.desconto_total))}</span>
                        </div>
                        <div className="border-t-2 border-emerald-400 pt-2 flex justify-between text-lg font-bold text-emerald-700">
                          <span>TOTAL:</span>
                          <span>{formatarMoeda(valorTotal)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex justify-end gap-3 pt-6 border-t">
                    <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                      <X className="w-4 h-4" />
                      Cancelar
                    </Button>
                    <Button type="button" onClick={handleProximaEtapa} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg">
                      Próximo
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </>
              )}

              {/* ETAPA 2: DADOS FINANCEIROS */}
              {etapa === 2 && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">Plano de Contas <span className="text-red-600">*</span></Label>
                      <div className="flex gap-2">
                        <Select value={formData.plano_contas_id} onValueChange={(v) => handleChange('plano_contas_id', v)} className="flex-1">
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {planos.map(p => <SelectItem key={p.id} value={p.id}>{p.codigo} - {p.descricao}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogPlano(true)}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">Grupo Financeiro <span className="text-red-600">*</span></Label>
                      <div className="flex gap-2">
                        <Select value={formData.grupo_id} onValueChange={(v) => handleChange('grupo_id', v)} className="flex-1">
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.descricao}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogGrupo(true)}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Centro de Custo</Label>
                      <div className="flex gap-2">
                        <Select value={formData.centro_custo_id} onValueChange={(v) => handleChange('centro_custo_id', v)} className="flex-1">
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {centros.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Forma de Pagamento</Label>
                      <div className="flex gap-2">
                        <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)} className="flex-1">
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {formasPagamento.map(f => <SelectItem key={f.id} value={f.id}>{f.descricao}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogForma(true)}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">Data de Vencimento <span className="text-red-600">*</span></Label>
                      <Input type="date" value={formData.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} required />
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox checked={formData.parcelar} onCheckedChange={(v) => handleChange('parcelar', v)} id="parcelar" />
                      <label htmlFor="parcelar" className="font-semibold cursor-pointer">Parcelar lançamento</label>
                    </div>

                    {formData.parcelar && (
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <Label>Parcelas ({formData.parcelas.length})</Label>
                          <Button type="button" size="sm" onClick={adicionarParcela} className="h-8 gap-1 text-xs">
                            <Plus className="w-3 h-3" />
                            Adicionar
                          </Button>
                        </div>

                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16 text-xs">Nº</TableHead>
                              <TableHead className="text-xs">Vencimento *</TableHead>
                              <TableHead className="text-right text-xs">Valor *</TableHead>
                              <TableHead className="w-12"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {formData.parcelas.map((parcela, index) => (
                              <TableRow key={index}>
                                <TableCell className="font-bold text-xs">{index + 1}</TableCell>
                                <TableCell>
                                  <Input type="date" value={parcela.data} onChange={(e) => atualizarParcela(index, 'data', e.target.value)} className="h-8 text-xs" />
                                </TableCell>
                                <TableCell>
                                  <Input value={parcela.valor} onChange={(e) => atualizarParcela(index, 'valor', e.target.value)} placeholder="0,00" className="text-right h-8 text-xs" />
                                </TableCell>
                                <TableCell>
                                  <Button type="button" variant="ghost" size="icon" onClick={() => removerParcela(index)} disabled={formData.parcelas.length <= 1} className="h-7 w-7">
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        <Card className={`${Math.abs(totalParcelas - valorTotal) > 0.01 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                          <CardContent className="p-3">
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex justify-between">
                                <span>Total Parcelas:</span>
                                <span className="font-bold">{formatarMoeda(totalParcelas)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Valor Total:</span>
                                <span className="font-bold">{formatarMoeda(valorTotal)}</span>
                              </div>
                            </div>
                            {Math.abs(totalParcelas - valorTotal) > 0.01 && (
                              <p className="text-xs text-red-600 mt-2 text-center">⚠️ Valores diferentes!</p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Observações</Label>
                    <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES..." className="uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>

                  <div className="flex justify-between gap-3 pt-6 border-t">
                    <Button type="button" variant="outline" onClick={() => setEtapa(1)} className="gap-2">
                      <ChevronLeft className="w-4 h-4" />
                      Voltar
                    </Button>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                        <X className="w-4 h-4" />
                        Cancelar
                      </Button>
                      <Button 
                        type="submit" 
                        className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg"
                        disabled={formData.parcelar && Math.abs(totalParcelas - valorTotal) > 0.01}
                      >
                        <Save className="w-4 h-4" />
                        Salvar
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['centros_compra'] }); handleChange('centro_custo_id', id); setShowDialogCentro(false); }} />
      <DialogCadastroRapido tipo="plano_contas" open={showDialogPlano} onClose={() => setShowDialogPlano(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['planos_compra'] }); handleChange('plano_contas_id', id); setShowDialogPlano(false); }} tipoFinanceiro="Despesa" />
      <DialogCadastroRapido tipo="grupo_financeiro" open={showDialogGrupo} onClose={() => setShowDialogGrupo(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['grupos_compra'] }); handleChange('grupo_id', id); setShowDialogGrupo(false); }} tipoFinanceiro="Despesa" />
      <DialogCadastroRapido tipo="forma_pagamento" open={showDialogForma} onClose={() => setShowDialogForma(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['formas_compra'] }); handleChange('forma_pagamento_id', id); setShowDialogForma(false); }} />
    </>
  );
}