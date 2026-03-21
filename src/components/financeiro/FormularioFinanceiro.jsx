import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Save, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2 } from "lucide-react";
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

export default function FormularioFinanceiro({ onSubmit, onCancel, initialData, fornecedores, produtos, safras }) {
  const [formData, setFormData] = useState(() => {
    const defaults = {
      tipo: "Pagar",
      fornecedor_id: "",
      cliente_nome: "",
      safra_id: "",
      centro_custo_id: "",
      plano_contas_id: "",
      grupo_id: "",
      forma_pagamento_id: "",
      numero_documento: "",
      chave_nfe: "",
      tipo_documento: "NF-e",
      data_emissao: new Date().toISOString().split('T')[0],
      data_vencimento: new Date().toISOString().split('T')[0],
      valor_original: "",
      valor_juros: "0,00",
      valor_multa: "0,00",
      valor_desconto: "0,00",
      observacoes: "",
      parcelar: false,
      parcelas: []
    };

    if (!initialData) return defaults;

    return {
      ...defaults,
      ...initialData,
      tipo: initialData.tipo || defaults.tipo,
      tipo_documento: initialData.tipo_documento || defaults.tipo_documento,
      valor_original: initialData.valor_original ? formatarNumero(initialData.valor_original) : defaults.valor_original,
      valor_juros: initialData.valor_juros ? formatarNumero(initialData.valor_juros) : defaults.valor_juros,
      valor_multa: initialData.valor_multa ? formatarNumero(initialData.valor_multa) : defaults.valor_multa,
      valor_desconto: initialData.valor_desconto ? formatarNumero(initialData.valor_desconto) : defaults.valor_desconto,
      numero_documento: initialData.numero_documento || '',
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

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_form', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: planos = [] } = useQuery({
    queryKey: ['planos_form', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_form', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: formasPagamento = [] } = useQuery({
    queryKey: ['formas_form', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FormaPagamento.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId && f.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    if (formData.parcelar && formData.parcelas.length === 0) {
      const valorTotal = parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);
      const valorParcela = valorTotal / 2;
      
      setFormData(prev => ({
        ...prev,
        parcelas: [
          { data: prev.data_vencimento, valor: formatarNumero(valorParcela) },
          { data: calcularDataProximaMes(prev.data_vencimento), valor: formatarNumero(valorParcela) }
        ]
      }));
    }
  }, [formData.parcelar]);

  const calcularDataProximaMes = (dataBase) => {
    const data = new Date(dataBase);
    data.setMonth(data.getMonth() + 1);
    return data.toISOString().split('T')[0];
  };

  const adicionarParcela = () => {
    const ultimaParcela = formData.parcelas[formData.parcelas.length - 1];
    const proximaData = ultimaParcela ? calcularDataProximaMes(ultimaParcela.data) : formData.data_vencimento;
    const valorTotal = parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);
    const valorParcela = valorTotal / (formData.parcelas.length + 1);
    
    setFormData(prev => ({
      ...prev,
      parcelas: [...prev.parcelas, { data: proximaData, valor: formatarNumero(valorParcela) }]
    }));
  };

  const removerParcela = (index) => {
    if (formData.parcelas.length <= 2) {
      toast.error('Mínimo de 2 parcelas!');
      return;
    }
    setFormData(prev => ({
      ...prev,
      parcelas: prev.parcelas.filter((_, i) => i !== index)
    }));
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

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.data_emissao || !formData.data_vencimento || !formData.valor_original) {
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

    if (!initialData?.id && formData.parcelar && formData.parcelas.length < 2) {
      toast.error('❌ Mínimo 2 parcelas!');
      return;
    }

    if (!initialData?.id && formData.parcelar) {
      const totalParcelas = formData.parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);
      const valorTotal = parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);
      
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
      fornecedor_id: formData.tipo === 'Pagar' ? (formData.fornecedor_id || undefined) : undefined,
      fornecedor_nome: formData.tipo === 'Pagar' ? fornecedor?.nome : undefined,
      cliente_nome: formData.tipo === 'Receber' ? formData.cliente_nome?.toUpperCase() : undefined,
      safra_id: formData.safra_id || undefined,
      safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome,
      plano_contas_id: formData.plano_contas_id || undefined,
      plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
      grupo_id: formData.grupo_id || undefined,
      grupo_nome: grupo?.descricao,
      forma_pagamento_id: formData.forma_pagamento_id || undefined,
      forma_pagamento_nome: forma?.descricao,
      numero_documento: formData.numero_documento?.toUpperCase() || undefined,
      chave_nfe: formData.chave_nfe || undefined,
      data_emissao: formData.data_emissao,
      data_vencimento: formData.data_vencimento,
      valor_original: parseNumero(formData.valor_original),
      valor_juros: parseNumero(formData.valor_juros),
      valor_multa: parseNumero(formData.valor_multa),
      valor_desconto: parseNumero(formData.valor_desconto),
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      parcelas: (!initialData?.id && formData.parcelar) ? formData.parcelas.map(p => ({ 
        data: p.data, 
        valor: parseNumero(p.valor) 
      })) : undefined
    };

    onSubmit(data);
  };

  const valorTotal = parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);
  const totalParcelas = (formData.parcelas || []).reduce((sum, p) => sum + parseNumero(p.valor), 0);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-sm border-slate-300 bg-white">
          <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {initialData?.id ? 'Editar Lançamento' : 'Novo Lançamento Financeiro'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-1">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo *</Label>
                  <Select value={formData.tipo} onValueChange={(v) => handleChange('tipo', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pagar" className="text-xs">Conta a Pagar</SelectItem>
                      <SelectItem value="Receber" className="text-xs">Conta a Receber</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Tipo Documento *</Label>
                  <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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

                <div className="space-y-1">
                  <Label className="text-xs">Data Emissão *</Label>
                  <Input type="date" value={formData.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} required className="h-8 text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
                <div className="space-y-1">
                  <Label className="text-xs">Nº Documento</Label>
                  <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Safra</Label>
                  <Select value={formData.safra_id} onValueChange={(v) => handleChange('safra_id', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>
                      {safras.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.ano_inicio}/{s.ano_fim} - {s.descricao}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formData.tipo === 'Pagar' && (
                <div className="space-y-1">
                  <Label className="text-xs">Fornecedor *</Label>
                  <Select value={formData.fornecedor_id} onValueChange={(v) => handleChange('fornecedor_id', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {fornecedores.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.tipo === 'Receber' && (
                <div className="space-y-1">
                  <Label className="text-xs">Cliente *</Label>
                  <Input value={formData.cliente_nome} onChange={(e) => handleChange('cliente_nome', e.target.value)} placeholder="NOME DO CLIENTE" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} required />
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <div className="space-y-1">
                  <Label className="text-xs">Centro de Custo</Label>
                  <div className="flex gap-2">
                    <Select value={formData.centro_custo_id} onValueChange={(v) => handleChange('centro_custo_id', v)} className="flex-1">
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {centros.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Plano de Contas</Label>
                  <div className="flex gap-2">
                    <Select value={formData.plano_contas_id} onValueChange={(v) => handleChange('plano_contas_id', v)} className="flex-1">
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {planos.filter(p => p.tipo === (formData.tipo === 'Pagar' ? 'Despesa' : 'Receita')).map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.codigo} - {p.descricao}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogPlano(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Grupo</Label>
                  <div className="flex gap-2">
                    <Select value={formData.grupo_id} onValueChange={(v) => handleChange('grupo_id', v)} className="flex-1">
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {grupos.filter(g => g.tipo === (formData.tipo === 'Pagar' ? 'Despesa' : 'Receita')).map(g => <SelectItem key={g.id} value={g.id} className="text-xs">{g.descricao}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogGrupo(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Forma de Pagamento</Label>
                <div className="flex gap-2">
                  <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)} className="flex-1">
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {formasPagamento.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.descricao}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogForma(true)} className="h-8 w-8">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">
                <div className="space-y-1">
                  <Label className="text-xs">Valor Original *</Label>
                  <Input value={formData.valor_original} onChange={(e) => handleChange('valor_original', e.target.value)} placeholder="0,00" required className="h-8 text-xs" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Juros</Label>
                  <Input value={formData.valor_juros} onChange={(e) => handleChange('valor_juros', e.target.value)} placeholder="0,00" className="h-8 text-xs" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Multa</Label>
                  <Input value={formData.valor_multa} onChange={(e) => handleChange('valor_multa', e.target.value)} placeholder="0,00" className="h-8 text-xs" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Desconto</Label>
                  <Input value={formData.valor_desconto} onChange={(e) => handleChange('valor_desconto', e.target.value)} placeholder="0,00" className="h-8 text-xs" />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Valor Total</Label>
                <Input value={formatarMoeda(valorTotal)} readOnly className="h-8 text-xs font-semibold bg-slate-50" />
              </div>

              <div className="space-y-3 p-3 bg-slate-50 rounded-lg">
                {!initialData?.id && (
                  <div className="flex items-center space-x-2">
                    <Checkbox checked={formData.parcelar} onCheckedChange={(v) => handleChange('parcelar', v)} id="parcelar" />
                    <label htmlFor="parcelar" className="text-xs font-semibold cursor-pointer">Parcelar lançamento</label>
                  </div>
                )}

                {!formData.parcelar && (
                  <div className="space-y-1">
                    <Label className="text-xs">Data de Vencimento *</Label>
                    <Input type="date" value={formData.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} required className="h-8 text-xs" />
                  </div>
                )}

                {formData.parcelar && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs">Parcelas ({formData.parcelas.length})</Label>
                      <Button type="button" size="sm" onClick={adicionarParcela} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700">
                        Adicionar
                      </Button>
                    </div>
                    
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="w-12 text-xs">Nº</TableHead>
                          <TableHead className="text-xs">Vencimento *</TableHead>
                          <TableHead className="text-right text-xs">Valor *</TableHead>
                          <TableHead className="w-8 text-xs"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {formData.parcelas.map((parcela, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-bold text-xs">{index + 1}</TableCell>
                            <TableCell>
                              <Input type="date" value={parcela.data} onChange={(e) => atualizarParcela(index, 'data', e.target.value)} required className="h-7 text-xs" />
                            </TableCell>
                            <TableCell>
                              <Input value={parcela.valor} onChange={(e) => atualizarParcela(index, 'valor', e.target.value)} placeholder="0,00" className="text-right h-7 text-xs" required />
                            </TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="icon" onClick={() => removerParcela(index)} disabled={formData.parcelas.length <= 2} className="h-6 w-6">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <div className="bg-slate-50 border border-slate-300 rounded p-2 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex justify-between">
                          <span>Total Parcelas:</span>
                          <span className="font-bold">{formatarMoeda(totalParcelas)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Valor:</span>
                          <span className="font-bold">{formatarMoeda(valorTotal)}</span>
                        </div>
                      </div>
                      {Math.abs(totalParcelas - valorTotal) > 0.01 && (
                        <p className="text-[10px] text-red-600 mt-1 text-center">⚠️ Valores diferentes!</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES..." className="text-xs uppercase" style={{ textTransform: 'uppercase' }} rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                  disabled={!initialData?.id && formData.parcelar && Math.abs(totalParcelas - valorTotal) > 0.01}
                >
                  {initialData?.id ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['centros_form'] }); handleChange('centro_custo_id', id); setShowDialogCentro(false); }} />
      <DialogCadastroRapido tipo="plano_contas" open={showDialogPlano} onClose={() => setShowDialogPlano(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['planos_form'] }); handleChange('plano_contas_id', id); setShowDialogPlano(false); }} tipoFinanceiro={formData.tipo === 'Pagar' ? 'Despesa' : 'Receita'} />
      <DialogCadastroRapido tipo="grupo_financeiro" open={showDialogGrupo} onClose={() => setShowDialogGrupo(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['grupos_form'] }); handleChange('grupo_id', id); setShowDialogGrupo(false); }} tipoFinanceiro={formData.tipo === 'Pagar' ? 'Despesa' : 'Receita'} />
      <DialogCadastroRapido tipo="forma_pagamento" open={showDialogForma} onClose={() => setShowDialogForma(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['formas_form'] }); handleChange('forma_pagamento_id', id); setShowDialogForma(false); }} />
    </>
  );
}