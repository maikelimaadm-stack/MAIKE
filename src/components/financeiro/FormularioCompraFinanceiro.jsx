import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, X, Plus, Trash2, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ComboboxFornecedor from "./ComboboxFornecedor.jsx";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";
import DialogCadastroRapido from "./DialogCadastroRapido.jsx";
import RateioGruposSection from "./RateioGruposSection.jsx";
import RateioCentrosCustoSection from "./RateioCentrosCustoSection.jsx";
import ParcelasSection from "./ParcelasSection.jsx";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  const numStr = String(num).replace('.', ',');
  const [inteiro, decimal] = numStr.split(',');
  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${inteiroFormatado},${decimal}` : inteiroFormatado;
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[R$ ]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const REQUIRED_FIELDS = ['tipo', 'descricao', 'valor_total', 'data_emissao', 'data_vencimento', 'conta_financeira_id', 'forma_pagamento_id'];

export default function FormularioCompraFinanceiro({ onSubmit, onCancel, initialData, fornecedores = [], tipoLancamento }) {
  const isEditing = !!initialData?.id;
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Dialogs cadastro rápido
  const [dialogCadastro, setDialogCadastro] = useState({ open: false, tipo: '' });

  const [form, setForm] = useState(() => {
    const hoje = new Date().toISOString().split('T')[0];
    const defaults = {
      tipo: tipoLancamento || 'Pagar',
      descricao: '',
      status: 'Aberto',
      valor_total: '',
      data_emissao: hoje,
      data_vencimento: hoje,
      data_pagamento: '',
      fornecedor_id: '',
      cliente_id: '',
      tipo_documento_id: '',
      numero_documento: '',
      conta_financeira_id: '',
      forma_pagamento_id: '',
      motivo_compra_id: '',
      plano_contas_id: '',
      parcelado: false,
      quantidade_parcelas: 1,
      parcelas: [],
      rateio_grupos: [],
      rateio_centros_custo: [],
      observacao: '',
      anexos_urls: [],
    };

    if (!initialData) return defaults;

    return {
      ...defaults,
      ...initialData,
      valor_total: initialData.valor_total ? formatarNumero(initialData.valor_total) : '',
      parcelas: initialData.parcelas || [],
      rateio_grupos: initialData.rateio_grupos || [],
      rateio_centros_custo: initialData.rateio_centros_custo || [],
      anexos_urls: initialData.anexos_urls || [],
    };
  });

  // === QUERIES ===
  const { data: tiposDocumento = [] } = useQuery({
    queryKey: ['tipos_doc_form', empresaId],
    queryFn: async () => {
      const all = await base44.entities.TipoDocumento.list();
      return all.filter(t => t.empresa_id === empresaId && t.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const { data: contasFinanceiras = [] } = useQuery({
    queryKey: ['contas_fin_form', empresaId],
    queryFn: async () => {
      const all = await base44.entities.ContaFinanceira.list();
      return all.filter(c => c.empresa_id === empresaId && c.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const { data: formasPagamento = [] } = useQuery({
    queryKey: ['formas_pag_form', empresaId],
    queryFn: async () => {
      const all = await base44.entities.FormaPagamento.list();
      return all.filter(f => f.empresa_id === empresaId && f.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const { data: motivosCompra = [] } = useQuery({
    queryKey: ['motivos_compra_form', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MotivoCompra.list();
      return all.filter(m => m.empresa_id === empresaId && m.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const { data: gruposFinanceiros = [] } = useQuery({
    queryKey: ['grupos_fin_form', empresaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      const tipoGrupo = form.tipo === 'Pagar' ? 'Despesa' : 'Receita';
      return all.filter(g => g.empresa_id === empresaId && g.ativo !== false && g.tipo === tipoGrupo);
    },
    enabled: !!empresaId,
  });

  const { data: centrosCusto = [] } = useQuery({
    queryKey: ['centros_custo_form', empresaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaId && c.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const { data: planosContas = [] } = useQuery({
    queryKey: ['planos_contas_form', empresaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaId && p.ativo !== false && p.aceita_lancamento !== false);
    },
    enabled: !!empresaId,
  });

  // Valor total numérico
  const valorTotalNum = useMemo(() => parseNumero(form.valor_total), [form.valor_total]);

  // Filtra formas de pagamento pelo tipo
  const formasFiltradas = useMemo(() => {
    const tipoFiltro = form.tipo === 'Pagar' ? 'Saida' : 'Entrada';
    return formasPagamento.filter(f => f.tipo === tipoFiltro || f.tipo === 'Ambos');
  }, [formasPagamento, form.tipo]);

  // Filtra tipos de documento pelo tipo
  const tiposDocFiltrados = useMemo(() => {
    const tipoFiltro = form.tipo === 'Pagar' ? 'Entrada' : 'Saida';
    return tiposDocumento.filter(t => t.tipo_movimento === tipoFiltro || t.tipo_movimento === 'Ambos');
  }, [tiposDocumento, form.tipo]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const getFieldClassName = (field) => {
    if (!tentouSalvar) return 'h-8 text-xs';
    const val = form[field];
    const isEmpty = val === '' || val === null || val === undefined;
    if (REQUIRED_FIELDS.includes(field) && isEmpty) {
      return 'h-8 text-xs border-red-500 bg-red-50 focus-visible:ring-red-500';
    }
    return 'h-8 text-xs';
  };

  // Upload de anexo
  const [uploadingFile, setUploadingFile] = useState(false);
  const handleUploadAnexo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Arquivo muito grande! Máximo 10MB');
      return;
    }
    setUploadingFile(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(prev => ({ ...prev, anexos_urls: [...prev.anexos_urls, file_url] }));
    toast.success('Arquivo anexado!');
    e.target.value = '';
    setUploadingFile(false);
  };

  // === SUBMIT ===
  const handleSubmit = async (e) => {
    e.preventDefault();
    setTentouSalvar(true);

    // Validação dos campos obrigatórios
    for (const field of REQUIRED_FIELDS) {
      const val = form[field];
      if (val === '' || val === null || val === undefined) {
        toast.error('Preencha todos os campos obrigatórios!');
        return;
      }
    }

    if (parseNumero(form.valor_total) <= 0) {
      toast.error('Valor total deve ser maior que zero!');
      return;
    }

    // Validar rateio de grupos
    if (form.rateio_grupos.length > 0) {
      const totalGrupos = form.rateio_grupos.reduce((sum, r) => sum + (r.valor || 0), 0);
      if (Math.abs(totalGrupos - valorTotalNum) > 0.01) {
        toast.error(`Rateio de grupos (${formatarMoeda(totalGrupos)}) diferente do valor total (${formatarMoeda(valorTotalNum)})!`);
        return;
      }
    }

    // Validar rateio de centros de custo
    if (form.rateio_centros_custo.length > 0) {
      const totalCentros = form.rateio_centros_custo.reduce((sum, r) => sum + (r.valor || 0), 0);
      if (Math.abs(totalCentros - valorTotalNum) > 0.01) {
        toast.error(`Rateio de centros de custo (${formatarMoeda(totalCentros)}) diferente do valor total (${formatarMoeda(valorTotalNum)})!`);
        return;
      }
    }

    // Validar parcelas
    if (form.parcelado && form.parcelas.length > 0) {
      const totalParcelas = form.parcelas.reduce((sum, p) => sum + (p.valor || 0), 0);
      if (Math.abs(totalParcelas - valorTotalNum) > 0.01) {
        toast.error(`Total das parcelas (${formatarMoeda(totalParcelas)}) diferente do valor total (${formatarMoeda(valorTotalNum)})!`);
        return;
      }
    }

    setSalvando(true);

    // Montar dados para salvar
    const fornecedor = fornecedores.find(f => f.id === form.fornecedor_id);
    const tipoDoc = tiposDocumento.find(t => t.id === form.tipo_documento_id);
    const contaFin = contasFinanceiras.find(c => c.id === form.conta_financeira_id);
    const formaPag = formasPagamento.find(f => f.id === form.forma_pagamento_id);
    const motivoC = motivosCompra.find(m => m.id === form.motivo_compra_id);
    const plano = planosContas.find(p => p.id === form.plano_contas_id);

    const data = {
      empresa_id: empresaId,
      tipo: form.tipo,
      descricao: form.descricao?.toUpperCase() || '',
      status: form.status || 'Aberto',
      valor_total: valorTotalNum,
      valor_pago: 0,
      data_emissao: form.data_emissao,
      data_vencimento: form.data_vencimento,
      data_pagamento: form.data_pagamento || undefined,
      fornecedor_id: form.fornecedor_id || undefined,
      fornecedor_nome: fornecedor?.nome || undefined,
      cliente_id: form.cliente_id || undefined,
      cliente_nome: fornecedor?.nome || undefined,
      tipo_documento_id: form.tipo_documento_id || undefined,
      tipo_documento_nome: tipoDoc?.nome || undefined,
      numero_documento: form.numero_documento?.toUpperCase() || undefined,
      conta_financeira_id: form.conta_financeira_id,
      conta_financeira_nome: contaFin?.nome || undefined,
      forma_pagamento_id: form.forma_pagamento_id,
      forma_pagamento_nome: formaPag?.nome || undefined,
      motivo_compra_id: form.motivo_compra_id || undefined,
      motivo_compra_nome: motivoC?.nome || undefined,
      plano_contas_id: form.plano_contas_id || undefined,
      plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
      parcelado: form.parcelado,
      quantidade_parcelas: form.parcelado ? form.parcelas.length : 1,
      parcelas: form.parcelado ? form.parcelas : [],
      rateio_grupos: form.rateio_grupos,
      rateio_centros_custo: form.rateio_centros_custo,
      observacao: form.observacao?.toUpperCase() || undefined,
      anexos_urls: form.anexos_urls,
    };

    await onSubmit(data);
    setSalvando(false);
  };

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-sm border-slate-300 bg-white">
          <CardHeader className="bg-slate-50 border-b border-slate-200 py-1.5 px-3">
            <CardTitle className="text-sm font-semibold text-slate-800">
              {isEditing ? 'Editar Lançamento Financeiro' : 'Novo Lançamento Financeiro'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <form onSubmit={handleSubmit} className="space-y-3">

              {/* === SEÇÃO 1: DADOS PRINCIPAIS === */}
              <div className="space-y-2 border border-slate-200 rounded-lg p-2.5 bg-white">
                <h3 className="text-xs font-bold text-slate-700 uppercase">Dados Principais</h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {/* Tipo */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Tipo *</Label>
                    <Select value={form.tipo} onValueChange={(v) => handleChange('tipo', v)}>
                      <SelectTrigger className={getFieldClassName('tipo')}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pagar" className="text-xs">PAGAR</SelectItem>
                        <SelectItem value="Receber" className="text-xs">RECEBER</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Valor Total */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Valor Total *</Label>
                    <Input
                      value={form.valor_total}
                      onChange={(e) => handleChange('valor_total', e.target.value.replace(/[^\d,]/g, ''))}
                      placeholder="0,00"
                      className={`${getFieldClassName('valor_total')} text-right font-mono`}
                    />
                  </div>

                  {/* Data Emissão */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Data Emissão *</Label>
                    <Input type="date" value={form.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} className={getFieldClassName('data_emissao')} />
                  </div>

                  {/* Data Vencimento */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Data Vencimento *</Label>
                    <Input type="date" value={form.data_vencimento} onChange={(e) => handleChange('data_vencimento', e.target.value)} className={getFieldClassName('data_vencimento')} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {/* Descrição */}
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs uppercase">Descrição *</Label>
                    <Input
                      value={form.descricao}
                      onChange={(e) => handleChange('descricao', e.target.value)}
                      placeholder="DESCRIÇÃO DO LANÇAMENTO"
                      className={`${getFieldClassName('descricao')} uppercase`}
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {/* Fornecedor / Cliente */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">{form.tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'}</Label>
                    <ComboboxFornecedor
                      fornecedores={fornecedores}
                      value={form.tipo === 'Pagar' ? form.fornecedor_id : form.cliente_id}
                      onChange={(v) => handleChange(form.tipo === 'Pagar' ? 'fornecedor_id' : 'cliente_id', v)}
                      className="w-full"
                    />
                  </div>

                  {/* Tipo Documento */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Tipo Documento</Label>
                    <Select value={form.tipo_documento_id} onValueChange={(v) => handleChange('tipo_documento_id', v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                      <SelectContent>
                        {tiposDocFiltrados.map(t => (
                          <SelectItem key={t.id} value={t.id} className="text-xs uppercase">{t.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Número Documento */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Nº Documento</Label>
                    <Input
                      value={form.numero_documento}
                      onChange={(e) => handleChange('numero_documento', e.target.value)}
                      placeholder="000000"
                      className="h-8 text-xs uppercase"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>
                </div>
              </div>

              {/* === SEÇÃO 2: CONTA E PAGAMENTO === */}
              <div className="space-y-2 border border-slate-200 rounded-lg p-2.5 bg-white">
                <h3 className="text-xs font-bold text-slate-700 uppercase">Conta e Pagamento</h3>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {/* Conta Financeira */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Conta Financeira *</Label>
                    <Select value={form.conta_financeira_id} onValueChange={(v) => handleChange('conta_financeira_id', v)}>
                      <SelectTrigger className={getFieldClassName('conta_financeira_id')}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                      <SelectContent>
                        {contasFinanceiras.map(c => (
                          <SelectItem key={c.id} value={c.id} className="text-xs uppercase">{c.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Forma de Pagamento */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Forma Pagamento *</Label>
                    <Select value={form.forma_pagamento_id} onValueChange={(v) => handleChange('forma_pagamento_id', v)}>
                      <SelectTrigger className={getFieldClassName('forma_pagamento_id')}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                      <SelectContent>
                        {formasFiltradas.map(f => (
                          <SelectItem key={f.id} value={f.id} className="text-xs uppercase">{f.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Motivo de Compra */}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Motivo de Compra</Label>
                    <Select value={form.motivo_compra_id} onValueChange={(v) => handleChange('motivo_compra_id', v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                      <SelectContent>
                        {motivosCompra.map(m => (
                          <SelectItem key={m.id} value={m.id} className="text-xs uppercase">{m.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Plano de Contas */}
                <div className="grid grid-cols-1 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Plano de Contas</Label>
                    <AutocompleteGenerico
                      items={planosContas}
                      value={form.plano_contas_id}
                      onChange={(v) => handleChange('plano_contas_id', v)}
                      placeholder="BUSCAR PLANO DE CONTAS..."
                      displayField="descricao"
                      searchFields={["codigo", "descricao"]}
                      renderItem={(p) => (
                        <div className="text-xs font-medium text-slate-900">{p.codigo} - {p.descricao}</div>
                      )}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              {/* === SEÇÃO 3: RATEIO GRUPO FINANCEIRO === */}
              <RateioGruposSection
                rateios={form.rateio_grupos}
                onChange={(rateios) => handleChange('rateio_grupos', rateios)}
                grupos={gruposFinanceiros}
                valorTotal={valorTotalNum}
                tipoLancamento={form.tipo}
              />

              {/* === SEÇÃO 4: RATEIO CENTRO DE CUSTO === */}
              <RateioCentrosCustoSection
                rateios={form.rateio_centros_custo}
                onChange={(rateios) => handleChange('rateio_centros_custo', rateios)}
                centros={centrosCusto}
                valorTotal={valorTotalNum}
              />

              {/* === SEÇÃO 5: PARCELAMENTO === */}
              <ParcelasSection
                parcelado={form.parcelado}
                parcelas={form.parcelas}
                onParceladoChange={(v) => handleChange('parcelado', v)}
                onParcelasChange={(p) => handleChange('parcelas', p)}
                valorTotal={valorTotalNum}
                dataVencimento={form.data_vencimento}
              />

              {/* === SEÇÃO 6: OBSERVAÇÕES E ANEXOS === */}
              <div className="space-y-2 border border-slate-200 rounded-lg p-2.5 bg-white">
                <h3 className="text-xs font-bold text-slate-700 uppercase">Observações e Anexos</h3>

                <div className="space-y-1">
                  <Label className="text-xs uppercase">Observações</Label>
                  <Textarea
                    value={form.observacao}
                    onChange={(e) => handleChange('observacao', e.target.value)}
                    placeholder="OBSERVAÇÕES..."
                    className="min-h-16 text-xs uppercase"
                    style={{ textTransform: 'uppercase' }}
                    rows={2}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs uppercase">Anexos</Label>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" onChange={handleUploadAnexo} accept=".pdf,.xml,.jpg,.jpeg,.png" />
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
                        <span>
                          {uploadingFile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                          {uploadingFile ? 'Enviando...' : 'Anexar Arquivo'}
                        </span>
                      </Button>
                    </label>
                  </div>
                  {form.anexos_urls.length > 0 && (
                    <div className="space-y-1 mt-1">
                      {form.anexos_urls.map((url, i) => (
                        <div key={i} className="flex items-center justify-between bg-slate-50 rounded px-2 py-1 text-xs">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[250px]">
                            Anexo {i + 1}
                          </a>
                          <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => setForm(prev => ({ ...prev, anexos_urls: prev.anexos_urls.filter((_, idx) => idx !== i) }))}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* === RESUMO === */}
              <div className="bg-slate-100 border border-slate-300 rounded-lg p-2.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800 uppercase">Valor Total do Lançamento:</span>
                  <span className="font-mono font-bold text-slate-900 text-base">{formatarMoeda(valorTotalNum)}</span>
                </div>
              </div>

              {/* === BOTÕES === */}
              <div className="flex flex-col-reverse lg:flex-row justify-end gap-2 pt-2 border-t border-slate-200">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs px-4">
                  <X className="w-3.5 h-3.5 mr-1" /> Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs px-4 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={salvando}>
                  {salvando ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                  {isEditing ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido
        tipo={dialogCadastro.tipo}
        open={dialogCadastro.open}
        onClose={() => setDialogCadastro({ open: false, tipo: '' })}
        onSuccess={(id) => {
          queryClient.invalidateQueries();
          setDialogCadastro({ open: false, tipo: '' });
        }}
        tipoFinanceiro={form.tipo === 'Pagar' ? 'Despesa' : 'Receita'}
      />
    </>
  );
}