
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
import { Save, X, Plus, Trash2, MoreVertical, DollarSign } from "lucide-react";
import { toast } from "sonner";
import DialogCadastroRapido from "./DialogCadastroRapido.jsx";
import ComboboxFornecedor from "./ComboboxFornecedor.jsx";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// FORMAS_PAGAMENTO_PADRAO removed as per outline, now fetched dynamically
// const FORMAS_PAGAMENTO_PADRAO = [
//   'Dinheiro', 'PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto Bancário',
//   'Transferência Bancária', 'Cheque', 'Crédito Loja', 'Vale Alimentação',
//   'Vale Refeição', 'Depósito Bancário', 'Outros'
// ];

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  const numStr = String(num).replace('.', ',');
  const [inteiro, decimal] = numStr.split(',');
  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${inteiroFormatado},${decimal}` : inteiroFormatado;
};

const parseNumero = (str) => {
  if (!str) return 0;
  const cleanedStr = String(str).replace(/[R$ ]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleanedStr) || 0;
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const parseMoeda = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
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

export default function FormularioCompraFinanceiro({ onSubmit, onCancel, initialData, fornecedores, produtos, safras, centrosCusto, planosContas, gruposFinanceiros, tipoLancamento }) {
  // Removed etapa state and mostrarCamposNFe state
  const [formData, setFormData] = useState(() => {
    const defaults = {
      tipo: tipoLancamento || "Pagar",
      tipo_documento: "Recibo",
      fornecedor_id: "",
      cliente_nome: "", // New field
      data_emissao: new Date().toISOString().split('T')[0],
      data_vencimento: new Date().toISOString().split('T')[0],
      numero_documento: "",
      // Removed NF-e, Boleto specific fields
      safra_id: "",
      centro_custo_id: "",
      plano_contas_id: "",
      grupo_id: "",
      forma_pagamento_id: "",
      conta_bancaria_id: "", // New field
      // Removed lancar_produtos, dar_entrada_estoque, produtos_selecionados
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
      observacoes: "",
      // Removed observacoes_nfe, frete, outras_despesas, local_estoque, and all value_xxx NFe fields
      anexos: [], // Kept as empty, assuming no more file uploads
    };

    if (!initialData) return defaults;

    // Removed initialData logic related to NFe and products
    return {
      ...defaults,
      ...initialData,
      tipo: initialData.tipo || (tipoLancamento || "Pagar"),
      conta_paga: initialData.conta_paga || false,
      parcelar: initialData.parcelar || false,
      valor_original: initialData.valor_original ? formatarNumero(initialData.valor_original) : "",
      valor_juros: initialData.valor_juros ? formatarNumero(initialData.valor_juros) : defaults.valor_juros,
      valor_multa: initialData.valor_multa ? formatarNumero(initialData.valor_multa) : defaults.valor_multa,
      valor_desconto: initialData.valor_desconto ? formatarNumero(initialData.valor_desconto) : defaults.valor_desconto,
      valor_pago_total: initialData.valor_pago_total ? formatarNumero(initialData.valor_pago_total) : "", // Only for paid accounts
      parcelas: initialData.parcelas?.map(p => ({
        data: p.data,
        valor: formatarNumero(p.valor || 0)
      })) || [],
      anexos: initialData.anexos || [],
      cliente_nome: initialData.cliente_nome || "",
      conta_bancaria_id: initialData.conta_bancaria_id || "",
    };
  });

  const [showDialogCentro, setShowDialogCentro] = useState(false);
  // Removed showDialogLocal state as local_estoque is no longer part of this form
  const [showDialogPlano, setShowDialogPlano] = useState(false);
  const [showDialogGrupo, setShowDialogGrupo] = useState(false);
  // Removed uploadingFile state as file uploads are no longer part of this form

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // Safras, centros, planos, grupos, produtos are now passed as props.
  // Removed respective useQuery calls.

  const { data: formasPagamento = [] } = useQuery({
    queryKey: ['formas_form', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FormaPagamento.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId && f.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: contasBancarias = [] } = useQuery({
    queryKey: ['contas_bancarias_form', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ContaBancaria.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    // Adjusted to use new calcularValorTotal
    if (formData.conta_paga && !formData.data_pagamento) {
      const valorTotal = calcularValorTotal();
      setFormData(prev => ({
        ...prev,
        data_pagamento: prev.data_emissao,
        valor_pago_total: formatarNumero(valorTotal)
      }));
    }
  }, [formData.conta_paga, formData.data_emissao, formData.valor_original, formData.valor_juros, formData.valor_multa, formData.valor_desconto]); // Added dependencies for calcularValorTotal

  useEffect(() => {
    if (formData.data_emissao && !formData.data_vencimento && !initialData) {
      setFormData(prev => ({ ...prev, data_vencimento: prev.data_emissao }));
    }
  }, [formData.data_emissao, initialData]);

  useEffect(() => {
    // Adjusted to use new calcularValorTotal
    if (formData.parcelar && formData.parcelas.length === 0 && formData.data_vencimento) {
      const valorTotal = calcularValorTotal();
      const valorParcela = valorTotal > 0 ? valorTotal : 0;
      setFormData(prev => ({
        ...prev,
        parcelas: [{ data: prev.data_vencimento, valor: formatarNumero(valorParcela) }]
      }));
    }
  }, [formData.parcelar, formData.data_vencimento, formData.valor_original, formData.valor_juros, formData.valor_multa, formData.valor_desconto]); // Added dependencies for calcularValorTotal

  const calcularValorTotal = () => {
    // Simplified calculation for generic financial launch
    return parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);
  };

  const adicionarParcela = () => {
    const valorTotal = calcularValorTotal();
    const newNumberOfParcelas = formData.parcelas.length + 1;
    const equalParcelValue = valorTotal / newNumberOfParcelas;

    const updatedParcelas = Array.from({ length: newNumberOfParcelas }, (_, i) => {
      const currentParcel = formData.parcelas[i];
      let date = currentParcel?.data;
      if (!date) {
        if (i === 0) {
          date = formData.data_vencimento;
        } else {
          date = calcularDataProximaMes(formData.parcelas[i - 1]?.data || formData.data_vencimento);
        }
      }
      return { data: date, valor: equalParcelValue.toFixed(2).replace('.', ',') };
    });

    setFormData(prev => ({ ...prev, parcelas: updatedParcelas }));
  };

  const removerParcela = (index) => {
    // Validation for minimum parcels for new records.
    if (!initialData?.id && formData.parcelas.length <= 2) {
      toast.error('Mínimo de 2 parcelas para novos lançamentos parcelados!');
      return;
    } else if (initialData?.id && formData.parcelas.length <= 1) { // Allow 1 parcel for existing records
      toast.error('Mínimo de 1 parcela!');
      return;
    }

    const newParcelas = formData.parcelas.filter((_, i) => i !== index);
    const valorTotal = calcularValorTotal();
    const equalParcelValue = newParcelas.length > 0 ? valorTotal / newParcelas.length : 0;
    const updatedParcelas = newParcelas.map(p => ({ ...p, valor: equalParcelValue.toFixed(2).replace('.', ',') }));
    setFormData(prev => ({ ...prev, parcelas: updatedParcelas }));
  };

  const atualizarParcela = (index, campo, valor) => {
    setFormData(prev => ({
      ...prev,
      parcelas: prev.parcelas.map((p, i) => i === index ? { ...p, [campo]: valor } : p)
    }));
  };

  const handleChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };

      if (field === 'parcelar' && value === true) {
        updated.conta_paga = false;
      }

      if (field === 'conta_paga' && value === true) {
        updated.parcelar = false;
      }

      return updated;
    });
  };

  // Removed product related handlers
  // Removed attachment related handlers
  // Removed handleProximaEtapa and handleVoltarEtapa as form is single step

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.data_emissao || !formData.data_vencimento || parseNumero(formData.valor_original) <= 0) {
      toast.error('❌ Preencha: Data Emissão, Data Vencimento e Valor Original!');
      return;
    }

    if (formData.tipo === 'Pagar' && !formData.fornecedor_id) {
      toast.error('❌ Selecione o fornecedor!');
      return;
    }

    if (formData.tipo === 'Receber' && !formData.cliente_nome) {
      toast.error('❌ Digite o nome do cliente!');
      return;
    }

    if (!formData.conta_bancaria_id) {
      toast.error('❌ Selecione a conta bancária!');
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

    if (formData.parcelar) {
      if (!formData.forma_pagamento_id) {
        toast.error('❌ Selecione a forma de pagamento!');
        return;
      }
      if (!initialData?.id && formData.parcelas.length < 2) { // New validation for new records
        toast.error('❌ Mínimo 2 parcelas para novos lançamentos parcelados!');
        return;
      }
      if (formData.parcelas.length < 1) { // General check for any records
        toast.error('❌ Adicione pelo menos 1 parcela!');
        return;
      }

      const valorTotalCalculado = calcularValorTotal();
      const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);

      if (Math.abs(totalParcelas - valorTotalCalculado) > 0.01) {
        toast.error('❌ Total das parcelas diferente do valor total!');
        return;
      }
      if (formData.parcelas.some(p => parseNumero(p.valor) <= 0)) {
        toast.error('Todas as parcelas devem ter valor > 0!');
        return;
      }
    } else if (formData.conta_paga) {
      if (!formData.forma_pagamento_paga_id) {
        toast.error('❌ Selecione a forma de pagamento!');
        return;
      }
      if (!formData.data_pagamento) {
        toast.error('❌ Preencha a data de pagamento!');
        return;
      }
      if (parseNumero(formData.valor_pago_total) <= 0) {
        toast.error('❌ Preencha o valor pago!');
        return;
      }
    } else { // Single payment (neither parcelar nor conta_paga)
      if (!formData.data_vencimento) {
        toast.error('❌ Preencha a data de vencimento!');
        return;
      }
      if (!formData.forma_pagamento_id) { // This form needs a payment method even if not paid
        toast.error('❌ Selecione a forma de pagamento!');
        return;
      }
    }

    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const safra = safras?.find(s => s.id === formData.safra_id);
    const centro = centrosCusto.find(c => c.id === formData.centro_custo_id);
    const plano = planosContas.find(p => p.id === formData.plano_contas_id);
    const grupo = gruposFinanceiros.find(g => g.id === formData.grupo_id);
    const forma = formasPagamento.find(f => f.id === (formData.parcelar ? formData.forma_pagamento_id : (formData.conta_paga ? formData.forma_pagamento_paga_id : formData.forma_pagamento_id)));
    const conta = contasBancarias.find(c => c.id === formData.conta_bancaria_id);

    const data = {
      tipo: formData.tipo,
      tipo_documento: formData.tipo_documento,
      fornecedor_id: formData.tipo === 'Pagar' ? (formData.fornecedor_id || undefined) : undefined,
      fornecedor_nome: formData.tipo === 'Pagar' ? fornecedor?.nome : undefined,
      cliente_nome: formData.tipo === 'Receber' ? formData.cliente_nome?.toUpperCase() : undefined,
      safra_id: formData.safra_id || undefined,
      safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome,
      plano_contas_id: formData.plano_contas_id,
      plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
      grupo_id: formData.grupo_id,
      grupo_nome: grupo?.descricao,
      forma_pagamento_id: formData.parcelar ? formData.forma_pagamento_id : (formData.conta_paga ? formData.forma_pagamento_paga_id : formData.forma_pagamento_id),
      forma_pagamento_nome: forma?.nome,
      conta_bancaria_id: formData.conta_bancaria_id,
      conta_bancaria_nome: conta?.banco && conta?.numero ? `${conta.banco} - ${conta.agencia}/${conta.numero} - ${conta.titular}` : conta?.titular,
      numero_documento: formData.numero_documento?.toUpperCase() || undefined,
      // Removed chave_nfe, serie_documento, etc.
      data_emissao: formData.data_emissao,
      data_vencimento: formData.data_vencimento,
      valor_original: parseNumero(formData.valor_original),
      valor_juros: parseNumero(formData.valor_juros),
      valor_multa: parseNumero(formData.valor_multa),
      valor_desconto: parseNumero(formData.valor_desconto),
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      // Removed observacoes_nfe, lancar_produtos, dar_entrada_estoque, produtos_selecionados, NFe specific value fields
      conta_paga: formData.conta_paga,
      data_pagamento: formData.conta_paga ? formData.data_pagamento : undefined,
      valor_pago_total: formData.conta_paga ? parseNumero(formData.valor_pago_total) : undefined,
      forma_pagamento_paga_id: formData.conta_paga ? formData.forma_pagamento_paga_id : undefined,
      forma_pagamento_paga_nome: formData.conta_paga ? formasPagamento.find(f => f.id === formData.forma_pagamento_paga_id)?.nome : undefined,
      parcelar: formData.parcelar,
      parcelas: (!initialData?.id && formData.parcelar) ? formData.parcelas.map(p => ({ data: p.data, valor: parseNumero(p.valor) })) : undefined, // Only send parcels for new records when parcelled
      anexos: formData.anexos,
    };

    await onSubmit(data);
  };

  // Removed product related total calculations

  const valorTotal = calcularValorTotal();
  const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-xl border-slate-200 bg-white">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
            <CardTitle className="flex items-center gap-3 text-slate-900">
              <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              {initialData?.id ? 'Editar Lançamento' : 'Novo Lançamento Financeiro'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Tipo *</Label>
                  <Select value={formData.tipo} onValueChange={(v) => handleChange('tipo', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pagar">Conta a Pagar</SelectItem>
                      <SelectItem value="Receber">Conta a Receber</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Tipo Documento *</Label>
                  <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Nº Documento</Label>
                  <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="uppercase" style={{ textTransform: 'uppercase' }} />
                </div>

                <div className="space-y-2">
                  <Label>Safra</Label>
                  <Select value={formData.safra_id} onValueChange={(v) => handleChange('safra_id', v)}>
                    <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>
                      {safras?.map(s => <SelectItem key={s.id} value={s.id}>{s.ano_inicio}/{s.ano_fim} - {s.descricao}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formData.tipo === 'Pagar' && (
                <div className="space-y-2">
                  <Label>Fornecedor *</Label>
                  <ComboboxFornecedor
                    fornecedores={fornecedores}
                    value={formData.fornecedor_id}
                    onChange={(v) => handleChange('fornecedor_id', v)}
                    className="w-full"
                  />
                </div>
              )}

              {formData.tipo === 'Receber' && (
                <div className="space-y-2">
                  <Label>Cliente *</Label>
                  <Input value={formData.cliente_nome} onChange={(e) => handleChange('cliente_nome', e.target.value)} placeholder="NOME DO CLIENTE" className="uppercase" style={{ textTransform: 'uppercase' }} required />
                </div>
              )}

              <div className="space-y-2">
                <Label>Conta Bancária *</Label>
                <Select value={formData.conta_bancaria_id} onValueChange={(v) => handleChange('conta_bancaria_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                  <SelectContent>
                    {contasBancarias.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.banco} - {c.agencia}/{c.numero} - {c.titular}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Plano de Contas *</Label>
                  <div className="flex gap-1">
                    <AutocompleteGenerico
                      items={planosContas}
                      value={formData.plano_contas_id}
                      onChange={(v) => handleChange('plano_contas_id', v)}
                      placeholder="Buscar plano..."
                      displayField="descricao"
                      searchFields={["codigo", "descricao"]}
                      renderItem={(p) => (
                        <>
                          <div className="text-xs font-medium text-slate-900">{p.codigo} - {p.descricao}</div>
                        </>
                      )}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogPlano(true)} className="h-9 w-9">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Grupo Financeiro *</Label>
                  <div className="flex gap-1">
                    <AutocompleteGenerico
                      items={gruposFinanceiros}
                      value={formData.grupo_id}
                      onChange={(v) => handleChange('grupo_id', v)}
                      placeholder="Buscar grupo..."
                      displayField="descricao"
                      searchFields={["codigo", "descricao"]}
                      renderItem={(g) => (
                        <>
                          <div className="text-xs font-medium text-slate-900">{g.codigo} - {g.descricao}</div>
                        </>
                      )}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogGrupo(true)} className="h-9 w-9">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Centro de Custo</Label>
                <div className="flex gap-1">
                  <AutocompleteGenerico
                    items={centrosCusto}
                    value={formData.centro_custo_id}
                    onChange={(v) => handleChange('centro_custo_id', v)}
                    placeholder="Buscar centro..."
                    displayField="nome"
                    searchFields={["nome", "codigo"]}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)} className="h-9 w-9">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-4 border border-slate-200 rounded-lg p-4 bg-slate-50">
                <h3 className="font-semibold text-slate-800">Valores</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>Valor Original *</Label>
                    <Input value={formData.valor_original} onChange={(e) => handleChange('valor_original', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Juros</Label>
                    <Input value={formData.valor_juros} onChange={(e) => handleChange('valor_juros', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" />
                  </div>
                  <div className="space-y-2">
                    <Label>Multa</Label>
                    <Input value={formData.valor_multa} onChange={(e) => handleChange('valor_multa', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" />
                  </div>
                  <div className="space-y-2">
                    <Label>Desconto</Label>
                    <Input value={formData.valor_desconto} onChange={(e) => handleChange('valor_desconto', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" />
                  </div>
                </div>
                <div className="bg-white border border-slate-300 rounded p-2 flex justify-between items-center text-lg font-bold">
                  <span>Total a Pagar:</span>
                  <span>{formatarMoeda(valorTotal)}</span>
                </div>
              </div>

              <div className="space-y-4 border border-slate-200 rounded-lg p-4 bg-slate-50">
                <h3 className="font-semibold text-slate-800">Condições de Pagamento</h3>

                <div className="flex gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={formData.parcelar}
                      onCheckedChange={(v) => handleChange('parcelar', v)}
                      id="parcelar"
                      disabled={formData.conta_paga}
                    />
                    <label htmlFor="parcelar" className={`font-medium cursor-pointer ${formData.conta_paga ? 'text-slate-400' : 'text-slate-700'}`}>Parcelar</label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={formData.conta_paga}
                      onCheckedChange={(v) => handleChange('conta_paga', v)}
                      id="conta_paga"
                      disabled={formData.parcelar}
                    />
                    <label htmlFor="conta_paga" className={`font-medium cursor-pointer ${formData.parcelar ? 'text-slate-400' : 'text-slate-700'}`}>Conta já paga</label>
                  </div>
                </div>

                {formData.parcelar && (
                  <div className="bg-white border border-slate-300 rounded p-3 space-y-3">
                    <div className="space-y-2">
                      <Label>Forma de Pagamento *</Label>
                      <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {formasPagamento.map(forma => (
                            <SelectItem key={forma.id} value={forma.id}>{forma.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex justify-between items-center">
                      <Label>Parcelas ({formData.parcelas.length})</Label>
                      <Button type="button" size="sm" onClick={adicionarParcela} variant="outline" className="h-8 gap-1">
                        <Plus className="w-4 h-4" />
                        Adicionar
                      </Button>
                    </div>

                    <div className="border rounded max-h-48 overflow-auto bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="w-10">Nº</TableHead>
                            <TableHead>Vencimento</TableHead>
                            <TableHead className="text-right">Valor</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {formData.parcelas.map((parcela, index) => (
                            <TableRow key={index}>
                              <TableCell className="font-semibold">{index + 1}</TableCell>
                              <TableCell>
                                <Input type="date" value={parcela.data} onChange={(e) => atualizarParcela(index, 'data', e.target.value)} className="h-8" />
                              </TableCell>
                              <TableCell>
                                <Input value={parcela.valor} onChange={(e) => atualizarParcela(index, 'valor', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="text-right h-8" />
                              </TableCell>
                              <TableCell>
                                <Button type="button" variant="ghost" size="icon" onClick={() => removerParcela(index)} disabled={(!initialData?.id && formData.parcelas.length <= 2) || (initialData?.id && formData.parcelas.length <= 1)} className="h-8 w-8">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className={`p-2 rounded ${Math.abs(totalParcelas - valorTotal) > 0.01 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-50 border border-slate-200'}`}>
                      <div className="flex justify-between text-sm">
                        <span>Total Parcelas:</span>
                        <span className="font-semibold">{formatarMoeda(totalParcelas)}</span>
                      </div>
                      {Math.abs(totalParcelas - valorTotal) > 0.01 && <p className="text-center mt-1 text-xs">O total das parcelas deve ser igual ao valor total do lançamento.</p>}
                    </div>
                  </div>
                )}

                {formData.conta_paga && (
                  <div className="bg-white border border-slate-300 rounded p-3 space-y-3">
                    <div className="space-y-2">
                      <Label>Forma de Pagamento *</Label>
                      <Select value={formData.forma_pagamento_paga_id} onValueChange={(v) => handleChange('forma_pagamento_paga_id', v)}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {formasPagamento.map(forma => (
                            <SelectItem key={forma.id} value={forma.id}>{forma.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Data Pagamento *</Label>
                        <Input type="date" value={formData.data_pagamento} onChange={(e) => handleChange('data_pagamento', e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label>Valor Pago *</Label>
                        <Input value={formData.valor_pago_total} onChange={(e) => handleChange('valor_pago_total', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" required />
                      </div>
                    </div>
                  </div>
                )}

                {!formData.parcelar && !formData.conta_paga && (
                  <div className="bg-white border border-slate-300 rounded p-3 space-y-3">
                    <div className="space-y-2">
                      <Label>Vencimento *</Label>
                      <Input type="date" value={formData.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Forma de Pagamento *</Label>
                      <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {formasPagamento.map(forma => (
                            <SelectItem key={forma.id} value={forma.id}>{forma.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES..." className="uppercase min-h-[60px]" style={{ textTransform: 'uppercase' }} rows={3} />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
                <Button type="submit" className="bg-slate-700 hover:bg-slate-800" disabled={formData.parcelar && Math.abs(totalParcelas - valorTotal) > 0.01}>
                  <Save className="w-4 h-4 mr-2" />
                  Salvar Lançamento
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['centros_compra'] }); handleChange('centro_custo_id', id); setShowDialogCentro(false); }} />
      {/* DialogCadastroRapido for local_estoque removed */}
      <DialogCadastroRapido tipo="plano_contas" open={showDialogPlano} onClose={() => setShowDialogPlano(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['planos_compra'] }); handleChange('plano_contas_id', id); setShowDialogPlano(false); }} />
      <DialogCadastroRapido tipo="grupo_financeiro" open={showDialogGrupo} onClose={() => setShowDialogGrupo(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['grupos_compra'] }); handleChange('grupo_id', id); setShowDialogGrupo(false); }} />
    </>
  );
}
