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
import { ShoppingCart, Save, X, Plus, Trash2, ChevronRight, ChevronLeft, FileText, Paperclip } from "lucide-react";
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
      numero_boleto: "",
      banco_boleto: "",
      cfop: "",
      safra_id: "",
      centro_custo_id: "",
      plano_contas_id: "",
      grupo_id: "",
      forma_pagamento_id: "",
      lancar_produtos: true,
      dar_entrada_estoque: true,
      valor_original: "",
      valor_juros: "0,00",
      valor_multa: "0,00",
      valor_desconto: "0,00",
      conta_paga: false,
      data_pagamento: "",
      valor_pago_total: "",
      forma_pagamento_paga_id: "",
      parcelar: false,
      parcelas: [],
      produtos_selecionados: [],
      observacoes: "",
      frete: "0,00",
      desconto_total: "0,00",
      outras_despesas: "0,00",
      local_estoque: "",
      anexos: []
    };

    if (!initialData) return defaults;

    return {
      ...defaults,
      ...initialData,
      lancar_produtos: initialData.lancar_produtos !== false,
      dar_entrada_estoque: initialData.dar_entrada_estoque !== false,
      conta_paga: initialData.conta_paga || false,
      valor_original: initialData.valor_original ? formatarNumero(initialData.valor_original) : "",
      valor_juros: initialData.valor_juros ? formatarNumero(initialData.valor_juros) : defaults.valor_juros,
      valor_multa: initialData.valor_multa ? formatarNumero(initialData.valor_multa) : defaults.valor_multa,
      valor_desconto: initialData.valor_desconto ? formatarNumero(initialData.valor_desconto) : defaults.valor_desconto,
      frete: initialData.frete ? formatarNumero(initialData.frete) : defaults.frete,
      desconto_total: initialData.desconto_total ? formatarNumero(initialData.desconto_total) : defaults.desconto_total,
      outras_despesas: initialData.outras_despesas ? formatarNumero(initialData.outras_despesas) : defaults.outras_despesas,
      produtos_selecionados: initialData.produtos_selecionados || [],
      parcelas: initialData.parcelas?.map(p => ({
        data: p.data,
        valor: formatarNumero(p.valor || 0)
      })) || [],
      anexos: initialData.anexos || []
    };
  });

  const [showDialogCentro, setShowDialogCentro] = useState(false);
  const [showDialogPlano, setShowDialogPlano] = useState(false);
  const [showDialogGrupo, setShowDialogGrupo] = useState(false);
  const [showDialogForma, setShowDialogForma] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

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

  const { data: locais = [] } = useQuery({
    queryKey: ['locais_compra'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  useEffect(() => {
    if (formData.parcelar && formData.parcelas.length === 0 && formData.data_vencimento) {
      const valorTotal = calcularValorTotal();
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

  const calcularValorTotal = () => {
    if (formData.lancar_produtos) {
      const subtotalProdutos = formData.produtos_selecionados.reduce((sum, p) => 
        sum + (parseNumero(p.quantidade || "0") * parseNumero(p.valor_unitario || "0")), 0
      );
      return subtotalProdutos + parseNumero(formData.frete) + parseNumero(formData.outras_despesas) - parseNumero(formData.desconto_total);
    } else {
      return parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);
    }
  };

  const adicionarParcela = () => {
    const ultimaParcela = formData.parcelas[formData.parcelas.length - 1];
    const proximaData = ultimaParcela ? calcularDataProximaMes(ultimaParcela.data) : formData.data_vencimento;
    const valorTotal = calcularValorTotal();
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
    const valorTotal = calcularValorTotal();
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

  const handleUploadAnexo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('Arquivo muito grande! Máximo 10MB');
      return;
    }

    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      setFormData(prev => ({
        ...prev,
        anexos: [...prev.anexos, {
          nome: file.name,
          url: file_url,
          tipo: file.type,
          tamanho: file.size
        }]
      }));
      
      toast.success('✅ Arquivo anexado!');
    } catch (error) {
      toast.error('Erro ao fazer upload');
    } finally {
      setUploadingFile(false);
      e.target.value = '';
    }
  };

  const handleRemoverAnexo = (index) => {
    setFormData(prev => ({
      ...prev,
      anexos: prev.anexos.filter((_, i) => i !== index)
    }));
    toast.success('Anexo removido!');
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

    if (formData.lancar_produtos) {
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

      if (formData.dar_entrada_estoque && !formData.local_estoque) {
        toast.error('❌ Selecione o local de estoque!');
        return;
      }
    } else {
      if (!formData.valor_original) {
        toast.error('❌ Preencha o valor original!');
        return;
      }
    }

    setEtapa(2);
  };

  const handleSubmit = async (e) => {
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

    if (formData.conta_paga) {
      if (!formData.data_pagamento) {
        toast.error('❌ Preencha a data de pagamento!');
        return;
      }
      if (!formData.valor_pago_total) {
        toast.error('❌ Preencha o valor pago!');
        return;
      }
      if (!formData.forma_pagamento_paga_id) {
        toast.error('❌ Selecione a forma de pagamento!');
        return;
      }
    }

    if (!formData.conta_paga && formData.parcelar && formData.parcelas.length < 2) {
      toast.error('❌ Mínimo 2 parcelas!');
      return;
    }

    if (!formData.conta_paga && formData.parcelar) {
      const valorTotal = calcularValorTotal();
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
    const formaPaga = formasPagamento.find(f => f.id === formData.forma_pagamento_paga_id);

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
      chave_nfe: formData.tipo_documento === 'NF-e' ? formData.chave_nfe : undefined,
      serie_documento: ['NF-e', 'NFC-e'].includes(formData.tipo_documento) ? formData.serie_documento : undefined,
      numero_boleto: formData.tipo_documento === 'Boleto' ? formData.numero_boleto : undefined,
      banco_boleto: formData.tipo_documento === 'Boleto' ? formData.banco_boleto : undefined,
      cfop: formData.tipo_documento === 'NF-e' ? formData.cfop : undefined,
      data_emissao: formData.data_emissao,
      data_vencimento: formData.data_vencimento,
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      lancar_produtos: formData.lancar_produtos,
      dar_entrada_estoque: formData.lancar_produtos ? formData.dar_entrada_estoque : false,
      local_estoque: formData.lancar_produtos && formData.dar_entrada_estoque ? formData.local_estoque : undefined,
      conta_paga: formData.conta_paga,
      data_pagamento: formData.conta_paga ? formData.data_pagamento : undefined,
      valor_pago_total: formData.conta_paga ? parseNumero(formData.valor_pago_total) : undefined,
      forma_pagamento_paga_id: formData.conta_paga ? formData.forma_pagamento_paga_id : undefined,
      forma_pagamento_paga_nome: formData.conta_paga ? formaPaga?.descricao : undefined,
      produtos_selecionados: formData.lancar_produtos ? formData.produtos_selecionados.map(p => ({
        produto_id: p.produto_id,
        produto_nome: p.produto_nome,
        quantidade: parseNumero(p.quantidade),
        unidade: p.unidade,
        valor_unitario: parseNumero(p.valor_unitario),
        desconto_item: parseNumero(p.desconto_item || "0,00")
      })) : [],
      valor_original: formData.lancar_produtos ? undefined : parseNumero(formData.valor_original),
      valor_juros: formData.lancar_produtos ? undefined : parseNumero(formData.valor_juros),
      valor_multa: formData.lancar_produtos ? undefined : parseNumero(formData.valor_multa),
      valor_desconto: formData.lancar_produtos ? undefined : parseNumero(formData.valor_desconto),
      frete: formData.lancar_produtos ? parseNumero(formData.frete) : 0,
      desconto_total: formData.lancar_produtos ? parseNumero(formData.desconto_total) : 0,
      outras_despesas: formData.lancar_produtos ? parseNumero(formData.outras_despesas) : 0,
      parcelar: !formData.conta_paga && formData.parcelar,
      parcelas: (!formData.conta_paga && formData.parcelar) ? formData.parcelas.map(p => ({ 
        data: p.data, 
        valor: parseNumero(p.valor) 
      })) : undefined,
      anexos: formData.anexos
    };

    await onSubmit(data);
  };

  const subtotalProdutos = formData.lancar_produtos ? formData.produtos_selecionados.reduce((sum, p) => {
    const qtd = parseNumero(p.quantidade || "0");
    const vlrUnit = parseNumero(p.valor_unitario || "0");
    const desc = parseNumero(p.desconto_item || "0,00");
    return sum + (qtd * vlrUnit - desc);
  }, 0) : 0;

  const valorTotal = calcularValorTotal();
  const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-xl border-slate-200 bg-white">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200 py-3">
            <CardTitle className="flex items-center gap-3 text-slate-900">
              <div className="w-9 h-9 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
                <ShoppingCart className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-base">Novo Lançamento</div>
                <div className="text-xs font-normal text-slate-600">Etapa {etapa} de 2</div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* ETAPA 1 */}
              {etapa === 1 && (
                <>
                  {/* CARD: DADOS BÁSICOS */}
                  <Card className="bg-blue-50 border-blue-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Dados Básicos</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Fornecedor *</Label>
                          <Select value={formData.fornecedor_id} onValueChange={(v) => handleChange('fornecedor_id', v)}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {fornecedores.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Tipo Documento *</Label>
                          <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NF-e" className="text-xs">NF-e</SelectItem>
                              <SelectItem value="NFC-e" className="text-xs">NFC-e</SelectItem>
                              <SelectItem value="Recibo" className="text-xs">Recibo</SelectItem>
                              <SelectItem value="Boleto" className="text-xs">Boleto</SelectItem>
                              <SelectItem value="Nota Manual" className="text-xs">Nota Manual</SelectItem>
                              <SelectItem value="Outros" className="text-xs">Outros</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Data Emissão *</Label>
                          <Input type="date" value={formData.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} required className="h-9 text-xs" />
                        </div>
                      </div>

                      {/* CAMPOS DINÂMICOS POR TIPO */}
                      {formData.tipo_documento === 'NF-e' && (
                        <div className="space-y-3 pt-2 border-t">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Número NF-e</Label>
                              <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="h-9 text-xs" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Série</Label>
                              <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="1" className="h-9 text-xs" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">CFOP</Label>
                              <Input value={formData.cfop} onChange={(e) => handleChange('cfop', e.target.value)} placeholder="5102" className="h-9 text-xs" maxLength={4} />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Chave NF-e (44 dígitos)</Label>
                            <Input 
                              value={formData.chave_nfe} 
                              onChange={(e) => handleChange('chave_nfe', e.target.value)} 
                              placeholder="00000000000000000000000000000000000000000000" 
                              maxLength={44}
                              className="font-mono text-xs h-9"
                            />
                          </div>
                        </div>
                      )}

                      {formData.tipo_documento === 'NFC-e' && (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Número NFC-e</Label>
                            <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Série</Label>
                            <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="1" className="h-9 text-xs" />
                          </div>
                        </div>
                      )}

                      {formData.tipo_documento === 'Recibo' && (
                        <div className="space-y-1.5 pt-2 border-t">
                          <Label className="text-xs">Número do Recibo</Label>
                          <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="0001" className="h-9 text-xs" />
                        </div>
                      )}

                      {formData.tipo_documento === 'Boleto' && (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Número do Boleto</Label>
                            <Input value={formData.numero_boleto} onChange={(e) => handleChange('numero_boleto', e.target.value)} placeholder="000000000000" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Banco</Label>
                            <Input value={formData.banco_boleto} onChange={(e) => handleChange('banco_boleto', e.target.value)} placeholder="Ex: Banco do Brasil" className="h-9 text-xs" />
                          </div>
                        </div>
                      )}

                      {formData.tipo_documento === 'Nota Manual' && (
                        <div className="space-y-1.5 pt-2 border-t">
                          <Label className="text-xs">Número da Nota</Label>
                          <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="0001" className="h-9 text-xs" />
                        </div>
                      )}

                      {formData.tipo_documento === 'Outros' && (
                        <div className="space-y-1.5 pt-2 border-t">
                          <Label className="text-xs">Número/Identificação</Label>
                          <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="Identificação" className="h-9 text-xs" />
                        </div>
                      )}

                      <div className="space-y-1.5 pt-2">
                        <Label className="text-xs">Safra (Opcional)</Label>
                        <Select value={formData.safra_id} onValueChange={(v) => handleChange('safra_id', v)}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                          <SelectContent>
                            {safras.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.ano_inicio}/{s.ano_fim} - {s.descricao}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>

                  {/* CARD: TIPO DE LANÇAMENTO */}
                  <Card className="bg-slate-50 border-slate-200">
                    <CardContent className="p-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          checked={formData.lancar_produtos} 
                          onCheckedChange={(v) => handleChange('lancar_produtos', v)} 
                          id="lancar_produtos" 
                        />
                        <label htmlFor="lancar_produtos" className="font-semibold cursor-pointer text-sm">
                          Lançar Produtos no Estoque
                        </label>
                      </div>
                    </CardContent>
                  </Card>

                  {/* CARD: PRODUTOS */}
                  {formData.lancar_produtos && (
                    <Card className="bg-green-50 border-green-200">
                      <CardHeader className="py-2 px-3">
                        <div className="flex justify-between items-center">
                          <CardTitle className="text-sm">Produtos</CardTitle>
                          <Button type="button" size="sm" onClick={handleAdicionarProduto} className="h-7 gap-1 text-xs">
                            <Plus className="w-3 h-3" />
                            Adicionar
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="p-3 space-y-3">
                        {formData.produtos_selecionados.length > 0 && (
                          <div className="border rounded overflow-auto max-h-72 bg-white">
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

                        <div className="space-y-2 p-2 bg-amber-50 rounded border border-amber-200">
                          <div className="flex items-center space-x-2">
                            <Checkbox 
                              checked={formData.dar_entrada_estoque} 
                              onCheckedChange={(v) => handleChange('dar_entrada_estoque', v)} 
                              id="dar_entrada_estoque" 
                            />
                            <label htmlFor="dar_entrada_estoque" className="font-semibold cursor-pointer text-xs">
                              Dar entrada no estoque?
                            </label>
                          </div>

                          {formData.dar_entrada_estoque && (
                            <div className="space-y-1.5 pt-1">
                              <Label className="text-xs">Local de Estoque *</Label>
                              <Select value={formData.local_estoque} onValueChange={(v) => handleChange('local_estoque', v)}>
                                <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                <SelectContent>
                                  {locais.map(l => <SelectItem key={l.id} value={l.nome} className="text-xs">{l.nome}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Frete</Label>
                            <Input value={formData.frete} onChange={(e) => handleChange('frete', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Desconto</Label>
                            <Input value={formData.desconto_total} onChange={(e) => handleChange('desconto_total', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Outras Desp.</Label>
                            <Input value={formData.outras_despesas} onChange={(e) => handleChange('outras_despesas', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <Card className="bg-white border-blue-200">
                            <CardContent className="p-2">
                              <div className="text-xs text-slate-600">Subtotal:</div>
                              <div className="text-base font-bold text-blue-700">{formatarMoeda(subtotalProdutos)}</div>
                            </CardContent>
                          </Card>
                          <Card className="bg-white border-emerald-200">
                            <CardContent className="p-2">
                              <div className="text-xs text-slate-600">Total:</div>
                              <div className="text-base font-bold text-emerald-700">{formatarMoeda(valorTotal)}</div>
                            </CardContent>
                          </Card>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* CARD: VALORES MANUAIS */}
                  {!formData.lancar_produtos && (
                    <Card className="bg-amber-50 border-amber-200">
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="text-sm">Valores</CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Valor Original *</Label>
                            <Input value={formData.valor_original} onChange={(e) => handleChange('valor_original', e.target.value)} placeholder="0,00" required className="h-9 text-xs font-semibold" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Juros</Label>
                            <Input value={formData.valor_juros} onChange={(e) => handleChange('valor_juros', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Multa</Label>
                            <Input value={formData.valor_multa} onChange={(e) => handleChange('valor_multa', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Desconto</Label>
                            <Input value={formData.valor_desconto} onChange={(e) => handleChange('valor_desconto', e.target.value)} placeholder="0,00" className="h-9 text-xs" />
                          </div>
                        </div>

                        <Card className="bg-white border-emerald-200">
                          <CardContent className="p-2">
                            <div className="text-xs text-slate-600">Valor Total:</div>
                            <div className="text-lg font-bold text-emerald-700">{formatarMoeda(valorTotal)}</div>
                          </CardContent>
                        </Card>
                      </CardContent>
                    </Card>
                  )}

                  {/* CARD: ANEXOS */}
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Paperclip className="w-4 h-4" />
                        Anexar Documentos
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-2">
                      <Input
                        type="file"
                        onChange={handleUploadAnexo}
                        disabled={uploadingFile}
                        accept=".pdf,.xml,.jpg,.jpeg,.png"
                        className="h-9 text-xs"
                      />
                      
                      {formData.anexos.length > 0 && (
                        <div className="space-y-1">
                          {formData.anexos.map((anexo, index) => (
                            <div key={index} className="flex items-center justify-between p-2 bg-white rounded border text-xs">
                              <div className="flex items-center gap-2">
                                <FileText className="w-3 h-3 text-slate-400" />
                                <span className="font-medium">{anexo.nome}</span>
                                <span className="text-slate-500">({(anexo.tamanho / 1024).toFixed(0)} KB)</span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoverAnexo(index)}
                                className="h-6 w-6 text-red-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="flex justify-end gap-3 pt-4 border-t">
                    <Button type="button" variant="outline" onClick={onCancel} className="gap-2 h-9 text-xs">
                      <X className="w-3 h-3" />
                      Cancelar
                    </Button>
                    <Button type="button" onClick={handleProximaEtapa} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg h-9 text-xs">
                      Próximo
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>
                </>
              )}

              {/* ETAPA 2: DADOS FINANCEIROS */}
              {etapa === 2 && (
                <>
                  {/* CARD: CLASSIFICAÇÃO */}
                  <Card className="bg-blue-50 border-blue-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Classificação Financeira</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1 text-xs">Plano de Contas <span className="text-red-600">*</span></Label>
                          <div className="flex gap-1.5">
                            <Select value={formData.plano_contas_id} onValueChange={(v) => handleChange('plano_contas_id', v)} className="flex-1">
                              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                              <SelectContent>
                                {planos.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.codigo} - {p.descricao}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button type="button" variant="outline" onClick={() => setShowDialogPlano(true)} className="h-9 px-2 text-xs">
                              Novo
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1 text-xs">Grupo Financeiro <span className="text-red-600">*</span></Label>
                          <div className="flex gap-1.5">
                            <Select value={formData.grupo_id} onValueChange={(v) => handleChange('grupo_id', v)} className="flex-1">
                              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                              <SelectContent>
                                {grupos.map(g => <SelectItem key={g.id} value={g.id} className="text-xs">{g.descricao}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button type="button" variant="outline" onClick={() => setShowDialogGrupo(true)} className="h-9 px-2 text-xs">
                              Novo
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Centro de Custo</Label>
                          <div className="flex gap-1.5">
                            <Select value={formData.centro_custo_id} onValueChange={(v) => handleChange('centro_custo_id', v)} className="flex-1">
                              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                              <SelectContent>
                                {centros.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button type="button" variant="outline" onClick={() => setShowDialogCentro(true)} className="h-9 px-2 text-xs">
                              Novo
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Forma de Pagamento</Label>
                          <div className="flex gap-1.5">
                            <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)} className="flex-1">
                              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                              <SelectContent>
                                {formasPagamento.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.descricao}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button type="button" variant="outline" onClick={() => setShowDialogForma(true)} className="h-9 px-2 text-xs">
                              Novo
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* CARD: PAGAMENTO */}
                  <Card className="bg-green-50 border-green-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Condições de Pagamento</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3">
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1 text-xs">Data de Vencimento <span className="text-red-600">*</span></Label>
                        <Input type="date" value={formData.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} required className="h-9 text-xs" />
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox checked={formData.conta_paga} onCheckedChange={(v) => handleChange('conta_paga', v)} id="conta_paga" />
                        <label htmlFor="conta_paga" className="font-semibold cursor-pointer text-sm">
                          Conta já está paga?
                        </label>
                      </div>

                      {formData.conta_paga && (
                        <Card className="bg-white border-green-300">
                          <CardContent className="p-3 space-y-3">
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Data Pgto *</Label>
                                <Input type="date" value={formData.data_pagamento} onChange={(e) => handleChange('data_pagamento', e.target.value)} required className="h-9 text-xs" />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs">Valor Pago *</Label>
                                <Input value={formData.valor_pago_total} onChange={(e) => handleChange('valor_pago_total', e.target.value)} placeholder="0,00" required className="h-9 text-xs" />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs">Forma *</Label>
                                <Select value={formData.forma_pagamento_paga_id} onValueChange={(v) => handleChange('forma_pagamento_paga_id', v)}>
                                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                  <SelectContent>
                                    {formasPagamento.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.descricao}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {!formData.conta_paga && (
                        <>
                          <div className="flex items-center space-x-2">
                            <Checkbox checked={formData.parcelar} onCheckedChange={(v) => handleChange('parcelar', v)} id="parcelar" />
                            <label htmlFor="parcelar" className="font-semibold cursor-pointer text-sm">Parcelar lançamento</label>
                          </div>

                          {formData.parcelar && (
                            <Card className="bg-white border-amber-200">
                              <CardContent className="p-3 space-y-2">
                                <div className="flex justify-between items-center">
                                  <Label className="text-xs">Parcelas ({formData.parcelas.length})</Label>
                                  <Button type="button" size="sm" onClick={adicionarParcela} className="h-7 gap-1 text-xs">
                                    <Plus className="w-3 h-3" />
                                    Adicionar
                                  </Button>
                                </div>

                                <div className="border rounded max-h-60 overflow-auto">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="w-12 text-xs">Nº</TableHead>
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
                                </div>

                                <Card className={`${Math.abs(totalParcelas - valorTotal) > 0.01 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                                  <CardContent className="p-2">
                                    <div className="grid grid-cols-2 gap-2 text-xs">
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
                                      <p className="text-xs text-red-600 mt-1 text-center">⚠️ Valores diferentes!</p>
                                    )}
                                  </CardContent>
                                </Card>
                              </CardContent>
                            </Card>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>

                  {/* CARD: OBSERVAÇÕES */}
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Observações</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3">
                      <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES..." className="uppercase text-xs" style={{ textTransform: 'uppercase' }} rows={3} />
                    </CardContent>
                  </Card>

                  <div className="flex justify-between gap-3 pt-4 border-t">
                    <Button type="button" variant="outline" onClick={() => setEtapa(1)} className="gap-2 h-9 text-xs">
                      <ChevronLeft className="w-3 h-3" />
                      Voltar
                    </Button>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={onCancel} className="gap-2 h-9 text-xs">
                        <X className="w-3 h-3" />
                        Cancelar
                      </Button>
                      <Button 
                        type="submit" 
                        className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg h-9 text-xs"
                        disabled={!formData.conta_paga && formData.parcelar && Math.abs(totalParcelas - valorTotal) > 0.01}
                      >
                        <Save className="w-3 h-3" />
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