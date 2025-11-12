
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
                      {safras.map(s => <SelectItem key={s.id} value={s.id}>{s.ano_inicio}/{s.ano_fim} - {s.descricao}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formData.tipo === 'Pagar' && (
                <div className="space-y-2">
                  <Label>Fornecedor *</Label>
                  <Select value={formData.fornecedor_id} onValueChange={(v) => handleChange('fornecedor_id', v)}>
                    <SelectTrigger><SelectValue placeholder="Selecione o fornecedor" /></SelectTrigger>
                    <SelectContent>
                      {fornecedores.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.tipo === 'Receber' && (
                <div className="space-y-2">
                  <Label>Cliente *</Label>
                  <Input value={formData.cliente_nome} onChange={(e) => handleChange('cliente_nome', e.target.value)} placeholder="NOME DO CLIENTE" className="uppercase" style={{ textTransform: 'uppercase' }} required />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                  <Label>Plano de Contas</Label>
                  <div className="flex gap-2">
                    <Select value={formData.plano_contas_id} onValueChange={(v) => handleChange('plano_contas_id', v)} className="flex-1">
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {planos.filter(p => p.tipo === (formData.tipo === 'Pagar' ? 'Despesa' : 'Receita')).map(p => <SelectItem key={p.id} value={p.id}>{p.codigo} - {p.descricao}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogPlano(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Grupo</Label>
                  <div className="flex gap-2">
                    <Select value={formData.grupo_id} onValueChange={(v) => handleChange('grupo_id', v)} className="flex-1">
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {grupos.filter(g => g.tipo === (formData.tipo === 'Pagar' ? 'Despesa' : 'Receita')).map(g => <SelectItem key={g.id} value={g.id}>{g.descricao}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogGrupo(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
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

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="space-y-2">
                  <Label>Valor Original *</Label>
                  <Input value={formData.valor_original} onChange={(e) => handleChange('valor_original', e.target.value)} placeholder="0,00" required />
                </div>

                <div className="space-y-2">
                  <Label>Juros</Label>
                  <Input value={formData.valor_juros} onChange={(e) => handleChange('valor_juros', e.target.value)} placeholder="0,00" />
                </div>

                <div className="space-y-2">
                  <Label>Multa</Label>
                  <Input value={formData.valor_multa} onChange={(e) => handleChange('valor_multa', e.target.value)} placeholder="0,00" />
                </div>

                <div className="space-y-2">
                  <Label>Desconto</Label>
                  <Input value={formData.valor_desconto} onChange={(e) => handleChange('valor_desconto', e.target.value)} placeholder="0,00" />
                </div>
              </div>

              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4 flex justify-between items-center">
                  <span className="font-semibold text-slate-700">Vlr. Total:</span>
                  <span className="text-2xl font-bold text-blue-700">{formatarMoeda(valorTotal)}</span>
                </CardContent>
              </Card>

              <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
                {!initialData?.id && (
                  <div className="flex items-center space-x-2">
                    <Checkbox checked={formData.parcelar} onCheckedChange={(v) => handleChange('parcelar', v)} id="parcelar" />
                    <label htmlFor="parcelar" className="font-semibold cursor-pointer">Parcelar lançamento (cria lançamentos separados)</label>
                  </div>
                )}

                {!formData.parcelar && (
                  <div className="space-y-2">
                    <Label>Data de Vencimento *</Label>
                    <Input type="date" value={formData.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} required />
                  </div>
                )}

                {formData.parcelar && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <Label>Parcelas ({formData.parcelas.length})</Label>
                      <Button type="button" size="sm" onClick={adicionarParcela} className="gap-2">
                        <Plus className="w-4 h-4" />
                        Adicionar
                      </Button>
                    </div>
                    
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Nº</TableHead>
                          <TableHead>Vencimento *</TableHead>
                          <TableHead className="text-right">Valor *</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {formData.parcelas.map((parcela, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-bold">{index + 1}</TableCell>
                            <TableCell>
                              <Input type="date" value={parcela.data} onChange={(e) => atualizarParcela(index, 'data', e.target.value)} required />
                            </TableCell>
                            <TableCell>
                              <Input value={parcela.valor} onChange={(e) => atualizarParcela(index, 'valor', e.target.value)} placeholder="0,00" className="text-right" required />
                            </TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="icon" onClick={() => removerParcela(index)} disabled={formData.parcelas.length <= 2}>
                                <Trash2 className="w-4 h-4" />
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
                            <span>Valor:</span>
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

              <div className="flex justify-end gap-3 pt-6 border-t">
                <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                  <X className="w-4 h-4" />
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg"
                  disabled={!initialData?.id && formData.parcelar && Math.abs(totalParcelas - valorTotal) > 0.01}
                >
                  <Save className="w-4 h-4" />
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
