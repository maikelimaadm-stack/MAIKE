import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  return String(num).replace('.', ',');
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(',', '.')) || 0;
};

export default function FormularioFinanceiro({ onSubmit, onCancel, initialData, fornecedores, produtos, safras }) {
  const [formData, setFormData] = useState(initialData || {
    tipo: "Pagar",
    fornecedor_id: "",
    cliente_nome: "",
    safra_id: "",
    produto_id: "",
    centro_custo_id: "",
    plano_contas_id: "",
    grupo_id: "",
    forma_pagamento_id: "",
    numero_documento: "",
    chave_nfe: "",
    data_emissao: new Date().toISOString().split('T')[0],
    data_vencimento: new Date().toISOString().split('T')[0],
    valor_original: "",
    valor_juros: "0,00",
    valor_multa: "0,00",
    valor_desconto: "0,00",
    observacoes: "",
    total_parcelas: 1,
    parcelar: false
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

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

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.data_emissao || !formData.data_vencimento || !formData.valor_original) {
      toast.error('Preencha os campos obrigatórios!');
      return;
    }

    if (formData.tipo === 'Pagar' && !formData.fornecedor_id) {
      toast.error('Selecione o fornecedor!');
      return;
    }

    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const safra = safras.find(s => s.id === formData.safra_id);
    const produto = produtos.find(p => p.id === formData.produto_id);
    const centro = centros.find(c => c.id === formData.centro_custo_id);
    const plano = planos.find(p => p.id === formData.plano_contas_id);
    const grupo = grupos.find(g => g.id === formData.grupo_id);
    const forma = formasPagamento.find(f => f.id === formData.forma_pagamento_id);

    const data = {
      tipo: formData.tipo,
      fornecedor_id: formData.fornecedor_id || undefined,
      fornecedor_nome: fornecedor?.nome,
      cliente_nome: formData.cliente_nome?.toUpperCase() || undefined,
      safra_id: formData.safra_id || undefined,
      safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : undefined,
      produto_id: formData.produto_id || undefined,
      produto_nome: produto?.nome_produto,
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
      total_parcelas: formData.parcelar ? parseInt(formData.total_parcelas) || 1 : 1
    };

    onSubmit(data);
  };

  const valorTotal = parseNumero(formData.valor_original) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            {initialData ? 'Editar Lançamento' : 'Novo Lançamento Financeiro'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select value={formData.tipo} onValueChange={(v) => handleChange('tipo', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pagar">Conta a Pagar</SelectItem>
                    <SelectItem value="Receber">Conta a Receber</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.tipo === 'Pagar' && (
                <div className="space-y-2">
                  <Label>Fornecedor *</Label>
                  <Select value={formData.fornecedor_id} onValueChange={(v) => handleChange('fornecedor_id', v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {fornecedores.map(f => (
                        <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.tipo === 'Receber' && (
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Input value={formData.cliente_nome} onChange={(e) => handleChange('cliente_nome', e.target.value)} placeholder="NOME DO CLIENTE" className="uppercase" style={{ textTransform: 'uppercase' }} />
                </div>
              )}

              <div className="space-y-2">
                <Label>Nº Documento</Label>
                <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Safra</Label>
                <Select value={formData.safra_id} onValueChange={(v) => handleChange('safra_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {safras.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.ano_inicio}/{s.ano_fim} - {s.descricao}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Produto</Label>
                <Select value={formData.produto_id} onValueChange={(v) => handleChange('produto_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.nome_produto}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Centro de Custo</Label>
                <Select value={formData.centro_custo_id} onValueChange={(v) => handleChange('centro_custo_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {centros.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Plano de Contas</Label>
                <Select value={formData.plano_contas_id} onValueChange={(v) => handleChange('plano_contas_id', v)}>
                  <SelectTrigger>
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
                <Label>Grupo</Label>
                <Select value={formData.grupo_id} onValueChange={(v) => handleChange('grupo_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {grupos.filter(g => g.tipo === (formData.tipo === 'Pagar' ? 'Despesa' : 'Receita')).map(g => (
                      <SelectItem key={g.id} value={g.id}>{g.descricao}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Data Emissão *</Label>
                <Input type="date" value={formData.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label>Data Vencimento *</Label>
                <Input type="date" value={formData.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label>Forma de Pagamento</Label>
                <Select value={formData.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {formasPagamento.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.descricao}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <CardContent className="p-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700">Valor Total:</span>
                  <span className="text-2xl font-bold text-blue-700">R$ {formatarNumero(valorTotal.toFixed(2))}</span>
                </div>
              </CardContent>
            </Card>

            {!initialData && (
              <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Checkbox checked={formData.parcelar} onCheckedChange={(v) => handleChange('parcelar', v)} />
                  <label className="font-semibold">Parcelar este lançamento</label>
                </div>

                {formData.parcelar && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Número de Parcelas</Label>
                      <Input type="number" min="2" max="120" value={formData.total_parcelas} onChange={(e) => handleChange('total_parcelas', e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Valor da Parcela</Label>
                      <Input value={formatarNumero((valorTotal / (parseInt(formData.total_parcelas) || 1)).toFixed(2))} readOnly className="bg-white" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES..." className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                <X className="w-4 h-4" />
                Cancelar
              </Button>
              <Button type="submit" className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg">
                <Save className="w-4 h-4" />
                {initialData ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}