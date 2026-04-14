import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";
import { formatarMoedaInput, parseMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";
import DialogCadastroRapido from "./DialogCadastroRapido.jsx";
import RateioGruposSection from "./RateioGruposSection.jsx";
import RateioCentrosCustoSection from "./RateioCentrosCustoSection.jsx";
import ParcelasSection from "./ParcelasSection.jsx";

const FL = ({ label, required, error, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

const parseNumero = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  // Se já é número, retorna diretamente
  if (typeof val === 'number') return val;
  return parseMoedaInput(val);
};





const calcularVencimento30Dias = (dataEmissao) => {
  if (!dataEmissao) return new Date().toISOString().split('T')[0];
  const d = new Date(dataEmissao + 'T00:00:00');
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
};

const REQUIRED_FIELDS = ['tipo', 'descricao', 'valor_total', 'data_emissao', 'conta_financeira_id', 'forma_pagamento_id', 'tipo_documento_id', 'numero_documento', 'motivo_compra_id'];
const INPUT_CLS = "h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent";
const SELECT_CLS = "h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent";
const AC_INPUT_CLS = "border-0 shadow-none focus-visible:ring-0 bg-transparent h-7";

export default function FormularioCompraFinanceiro({ onSubmit, onCancel, initialData, fornecedores = [], tipoLancamento }) {
  const isEditing = !!initialData?.id;
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [invalidFields, setInvalidFields] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [dialogCadastro, setDialogCadastro] = useState({ open: false, tipo: '' });
  const [uploadingFile, setUploadingFile] = useState(false);

  const [form, setForm] = useState(() => {
    const hoje = new Date().toISOString().split('T')[0];
    const defaults = {
      tipo: tipoLancamento || 'Pagar',
      descricao: '',
      valor_total: '', valor_desconto: '',
      data_emissao: hoje, data_pagamento: '',
      fornecedor_id: '', cliente_id: '',
      tipo_documento_id: '', numero_documento: '',
      conta_financeira_id: '', forma_pagamento_id: '',
      motivo_compra_id: '',
      parcelas: [], rateio_grupos: [], rateio_centros_custo: [],
      observacao: '', anexos_urls: [],
    };
    if (!initialData) return defaults;
    // Na edição do registro principal, usar valor_total_lancamento (valor total original)
    // e limpar o sufixo "- PARCELA X/Y" da descrição
    const isRegistroPrincipalGrupo = initialData.parcelamento_grupo_id && initialData.is_registro_principal;
    const valorEditar = isRegistroPrincipalGrupo
      ? (initialData.valor_total_lancamento || initialData.valor_total || 0)
      : (initialData.valor_total || 0);
    const descricaoLimpa = (initialData.descricao || '').replace(/\s*-\s*PARCELA\s+\d+\/\d+$/i, '');

    // Na edição, o registro individual não tem mais array de parcelas
    // Montamos uma parcela única a partir dos dados do registro
    const parcelasIniciais = initialData.parcelas || [];
    if (parcelasIniciais.length === 0 && initialData.id) {
      parcelasIniciais.push({
        numero: 1,
        data_vencimento: initialData.data_vencimento || '',
        valor: valorEditar,
        status: initialData.status || 'Aberto',
        observacao_parcela: initialData.observacao_parcela || '',
      });
    }
    return {
      ...defaults, ...initialData,
      descricao: descricaoLimpa,
      valor_total: valorEditar,
      valor_desconto: initialData.valor_desconto || '',
      parcelas: parcelasIniciais,
      rateio_grupos: initialData.rateio_grupos || [],
      rateio_centros_custo: initialData.rateio_centros_custo || [],
      anexos_urls: initialData.anexos_urls || [],
    };
  });

  // Queries
  const { data: tiposDocumento = [] } = useQuery({
    queryKey: ['tipos_doc_form', empresaId],
    queryFn: async () => { const all = await base44.entities.TipoDocumento.list(); return all.filter(t => t.empresa_id === empresaId && t.ativo !== false); },
    enabled: !!empresaId,
  });
  const { data: contasFinanceiras = [] } = useQuery({
    queryKey: ['contas_fin_form', empresaId],
    queryFn: async () => { const all = await base44.entities.ContaFinanceira.list(); return all.filter(c => c.empresa_id === empresaId && c.ativo !== false); },
    enabled: !!empresaId,
  });
  const { data: formasPagamento = [] } = useQuery({
    queryKey: ['formas_pag_form', empresaId],
    queryFn: async () => { const all = await base44.entities.FormaPagamento.list(); return all.filter(f => f.empresa_id === empresaId && f.ativo !== false); },
    enabled: !!empresaId,
  });
  const { data: motivosCompra = [] } = useQuery({
    queryKey: ['motivos_compra_form', empresaId],
    queryFn: async () => { const all = await base44.entities.MotivoCompra.list(); return all.filter(m => m.empresa_id === empresaId && m.ativo !== false); },
    enabled: !!empresaId,
  });
  const { data: gruposFinanceiros = [] } = useQuery({
    queryKey: ['grupos_fin_form', empresaId, form.tipo],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      const tipoGrupo = form.tipo === 'Pagar' ? 'Despesa' : 'Receita';
      return all.filter(g => g.empresa_id === empresaId && g.ativo !== false && g.tipo === tipoGrupo);
    },
    enabled: !!empresaId,
  });
  const { data: centrosCusto = [] } = useQuery({
    queryKey: ['centros_custo_form', empresaId],
    queryFn: async () => { const all = await base44.entities.CentroCusto.list(); return all.filter(c => c.empresa_id === empresaId && c.ativo !== false); },
    enabled: !!empresaId,
  });

  const valorTotalNum = useMemo(() => parseNumero(form.valor_total), [form.valor_total]);
  const valorDescontoNum = useMemo(() => parseNumero(form.valor_desconto), [form.valor_desconto]);
  const valorLiquidoNum = useMemo(() => Math.max(0, valorTotalNum - valorDescontoNum), [valorTotalNum, valorDescontoNum]);

  useEffect(() => {
    if (form.data_emissao && form.parcelas.length === 0) {
      const venc = calcularVencimento30Dias(form.data_emissao);
      setForm(prev => ({ ...prev, parcelas: [{ numero: 1, data_vencimento: venc, valor: valorLiquidoNum, status: 'Aberto' }] }));
    }
  }, [form.data_emissao]);

  // Auto-ajustar parcelas e rateios quando valor líquido mudar
  useEffect(() => {
    if (valorLiquidoNum <= 0) return;

    setForm(prev => {
      const updates = {};

      // Auto-ajustar parcelas proporcionalmente
      if (prev.parcelas.length > 0) {
        const totalParcelasAtual = prev.parcelas.reduce((s, p) => s + (p.valor || 0), 0);
        if (totalParcelasAtual > 0 && Math.abs(totalParcelasAtual - valorLiquidoNum) > 0.01) {
          const fator = valorLiquidoNum / totalParcelasAtual;
          let somaAjustada = 0;
          const novasParcelas = prev.parcelas.map((p, i) => {
            if (i === prev.parcelas.length - 1) {
              return { ...p, valor: Number((valorLiquidoNum - somaAjustada).toFixed(2)) };
            }
            const novoValor = Number((p.valor * fator).toFixed(2));
            somaAjustada += novoValor;
            return { ...p, valor: novoValor };
          });
          updates.parcelas = novasParcelas;
        } else if (prev.parcelas.length === 1) {
          updates.parcelas = [{ ...prev.parcelas[0], valor: valorLiquidoNum }];
        }
      }

      // Auto-ajustar rateio grupos proporcionalmente
      if (prev.rateio_grupos.length > 0) {
        const totalGrupos = prev.rateio_grupos.reduce((s, r) => s + (r.valor || 0), 0);
        if (totalGrupos > 0 && Math.abs(totalGrupos - valorLiquidoNum) > 0.01) {
          const fator = valorLiquidoNum / totalGrupos;
          let soma = 0;
          updates.rateio_grupos = prev.rateio_grupos.map((r, i) => {
            if (i === prev.rateio_grupos.length - 1) {
              const val = Number((valorLiquidoNum - soma).toFixed(2));
              return { ...r, valor: val, percentual: valorLiquidoNum > 0 ? Number(((val / valorLiquidoNum) * 100).toFixed(2)) : 0 };
            }
            const novoValor = Number((r.valor * fator).toFixed(2));
            soma += novoValor;
            return { ...r, valor: novoValor, percentual: valorLiquidoNum > 0 ? Number(((novoValor / valorLiquidoNum) * 100).toFixed(2)) : 0 };
          });
        }
      }

      // Auto-ajustar rateio centros de custo proporcionalmente
      if (prev.rateio_centros_custo.length > 0) {
        const totalCentros = prev.rateio_centros_custo.reduce((s, r) => s + (r.valor || 0), 0);
        if (totalCentros > 0 && Math.abs(totalCentros - valorLiquidoNum) > 0.01) {
          const fator = valorLiquidoNum / totalCentros;
          let soma = 0;
          updates.rateio_centros_custo = prev.rateio_centros_custo.map((r, i) => {
            if (i === prev.rateio_centros_custo.length - 1) {
              const val = Number((valorLiquidoNum - soma).toFixed(2));
              return { ...r, valor: val, percentual: valorLiquidoNum > 0 ? Number(((val / valorLiquidoNum) * 100).toFixed(2)) : 0 };
            }
            const novoValor = Number((r.valor * fator).toFixed(2));
            soma += novoValor;
            return { ...r, valor: novoValor, percentual: valorLiquidoNum > 0 ? Number(((novoValor / valorLiquidoNum) * 100).toFixed(2)) : 0 };
          });
        }
      }

      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, ...updates };
    });
  }, [valorLiquidoNum]);

  const formasFiltradas = useMemo(() => {
    const tipoFiltro = form.tipo === 'Pagar' ? 'Saida' : 'Entrada';
    return formasPagamento.filter(f => f.tipo === tipoFiltro || f.tipo === 'Ambos');
  }, [formasPagamento, form.tipo]);

  const tiposDocFiltrados = useMemo(() => {
    const tipoFiltro = form.tipo === 'Pagar' ? 'Entrada' : 'Saida';
    return tiposDocumento.filter(t => t.tipo_movimento === tipoFiltro || t.tipo_movimento === 'Ambos');
  }, [tiposDocumento, form.tipo]);

  const gruposComHierarquia = useMemo(() => {
    return gruposFinanceiros.map(g => {
      const pai = g.grupo_pai_id ? gruposFinanceiros.find(p => p.id === g.grupo_pai_id) : null;
      return { ...g, display_nome: pai ? `${pai.nome} > ${g.nome}` : g.nome };
    });
  }, [gruposFinanceiros]);

  const centrosComHierarquia = useMemo(() => {
    return centrosCusto.map(c => {
      const pai = c.centro_custo_pai_id ? centrosCusto.find(p => p.id === c.centro_custo_pai_id) : null;
      return { ...c, display_nome: pai ? `${pai.nome} > ${c.nome}` : c.nome };
    });
  }, [centrosCusto]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setInvalidFields(prev => prev.filter(f => f !== field));
  };

  const handleUploadAnexo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Arquivo muito grande! Máximo 10MB'); return; }
    setUploadingFile(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(prev => ({ ...prev, anexos_urls: [...prev.anexos_urls, file_url] }));
    toast.success('Arquivo anexado!');
    e.target.value = '';
    setUploadingFile(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Campos obrigatórios base + fornecedor/cliente dinâmico
    const allRequired = [...REQUIRED_FIELDS];
    if (form.tipo === 'Pagar') allRequired.push('fornecedor_id');
    else allRequired.push('cliente_id');
    // Se tipo documento exige anexo
    const tipoDocSel = tiposDocumento.find(t => t.id === form.tipo_documento_id);
    if (tipoDocSel?.exige_anexo && (!form.anexos_urls || form.anexos_urls.length === 0)) allRequired.push('anexos_urls');
    const missing = allRequired.filter(f => { const v = form[f]; if (f === 'anexos_urls') return !form.anexos_urls || form.anexos_urls.length === 0; return v === '' || v === null || v === undefined; });
    if (missing.length > 0) { setInvalidFields(missing); toast.error('PREENCHA OS CAMPOS OBRIGATÓRIOS.'); return; }
    if (valorLiquidoNum <= 0) { toast.error('Valor líquido deve ser maior que zero!'); return; }

    if (form.rateio_grupos.length === 0) {
      setInvalidFields(prev => [...prev, 'rateio_grupos']);
      toast.error('Adicione pelo menos um rateio de Grupo Financeiro!');
      return;
    } else {
      const total = form.rateio_grupos.reduce((s, r) => s + (r.valor || 0), 0);
      if (Math.abs(total - valorLiquidoNum) > 0.01) { toast.error(`Rateio de grupos (${formatarMoeda(total)}) diferente do valor líquido (${formatarMoeda(valorLiquidoNum)})!`); return; }
      const semGrupo = form.rateio_grupos.some(r => !r.grupo_financeiro_id);
      if (semGrupo) { toast.error('Selecione o grupo financeiro em todos os itens do rateio!'); return; }
    }
    if (form.rateio_centros_custo.length === 0) {
      setInvalidFields(prev => [...prev, 'rateio_centros_custo']);
      toast.error('Adicione pelo menos um rateio de Centro de Custo!');
      return;
    } else {
      const total = form.rateio_centros_custo.reduce((s, r) => s + (r.valor || 0), 0);
      if (Math.abs(total - valorLiquidoNum) > 0.01) { toast.error(`Rateio de centros (${formatarMoeda(total)}) diferente do valor líquido (${formatarMoeda(valorLiquidoNum)})!`); return; }
      const semCentro = form.rateio_centros_custo.some(r => !r.centro_custo_id);
      if (semCentro) { toast.error('Selecione o centro de custo em todos os itens do rateio!'); return; }
    }
    if (form.parcelas.length > 0) {
      const total = form.parcelas.reduce((s, p) => s + (p.valor || 0), 0);
      if (Math.abs(total - valorLiquidoNum) > 0.01) { toast.error(`Total das parcelas (${formatarMoeda(total)}) diferente do valor líquido (${formatarMoeda(valorLiquidoNum)})!`); return; }
    }

    setSalvando(true);
    const fornecedor = fornecedores.find(f => f.id === (form.fornecedor_id || form.cliente_id));
    const tipoDoc = tiposDocumento.find(t => t.id === form.tipo_documento_id);
    const contaFin = contasFinanceiras.find(c => c.id === form.conta_financeira_id);
    const formaPag = formasPagamento.find(f => f.id === form.forma_pagamento_id);
    const motivoC = motivosCompra.find(m => m.id === form.motivo_compra_id);

    const data = {
      empresa_id: empresaId, tipo: form.tipo,
      descricao: form.descricao?.toUpperCase() || '',
      status: 'Aberto',
      valor_total: valorTotalNum,
      valor_pago: 0,
      data_emissao: form.data_emissao,
      data_vencimento: form.parcelas[0]?.data_vencimento || calcularVencimento30Dias(form.data_emissao),
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
      parcelado: form.parcelas.length > 1,
      quantidade_parcelas: form.parcelas.length,
      parcelas: form.parcelas, // Usado pela página para gerar registros individuais
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
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {isEditing ? 'Editar Lançamento Financeiro' : 'Novo Lançamento Financeiro'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-1">
            <form onSubmit={handleSubmit} className="space-y-1">

              {/* LINHA 1: Tipo | Fornecedor/Cliente | Descrição */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-1">
                <div className="lg:col-span-2">
                  <FL label="Tipo" required error={invalidFields.includes('tipo')}>
                    <Select value={form.tipo} onValueChange={(v) => handleChange('tipo', v)}>
                      <SelectTrigger className={SELECT_CLS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pagar" className="text-xs">PAGAR</SelectItem>
                        <SelectItem value="Receber" className="text-xs">RECEBER</SelectItem>
                      </SelectContent>
                    </Select>
                  </FL>
                </div>
                <div className="lg:col-span-4">
                  <FL label={form.tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'} required error={invalidFields.includes(form.tipo === 'Pagar' ? 'fornecedor_id' : 'cliente_id')}>
                    <AutocompleteGenerico
                      items={fornecedores}
                      value={form.tipo === 'Pagar' ? form.fornecedor_id : form.cliente_id}
                      onChange={(v) => handleChange(form.tipo === 'Pagar' ? 'fornecedor_id' : 'cliente_id', v)}
                      placeholder={form.tipo === 'Pagar' ? 'BUSCAR FORNECEDOR...' : 'BUSCAR CLIENTE...'}
                      displayField="nome"
                      searchFields={["nome", "cnpj", "cpf"]}
                      renderItem={(f) => (
                        <>
                          <div className="text-xs font-medium text-slate-900">{f.nome}</div>
                          {(f.cnpj || f.cpf) && <div className="text-[10px] text-slate-500">{f.cnpj ? `CNPJ: ${f.cnpj}` : `CPF: ${f.cpf}`}</div>}
                        </>
                      )}
                      className="w-full"
                      inputClassName={AC_INPUT_CLS}
                    />
                  </FL>
                </div>
                <div className="lg:col-span-6">
                  <FL label="Descrição" required error={invalidFields.includes('descricao')}>
                    <Input value={form.descricao} onChange={(e) => handleChange('descricao', e.target.value.toUpperCase())} placeholder="DESCRIÇÃO DO LANÇAMENTO" className={`${INPUT_CLS} uppercase`} />
                  </FL>
                </div>
              </div>

              {/* LINHA 2: Tipo Doc | Nº Doc | Data Emissão | Valor Total | Desconto | Líquido */}
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-1">
                <FL label="Tipo Documento" required error={invalidFields.includes('tipo_documento_id')}>
                  <AutocompleteGenerico
                    items={tiposDocFiltrados}
                    value={form.tipo_documento_id}
                    onChange={(v) => handleChange('tipo_documento_id', v)}
                    placeholder="BUSCAR..."
                    displayField="nome"
                    searchFields={["nome", "sigla"]}
                    renderItem={(t) => <div className="text-xs text-slate-900">{t.sigla ? `${t.sigla} - ${t.nome}` : t.nome}</div>}
                    className="w-full"
                    inputClassName={AC_INPUT_CLS}
                  />
                </FL>
                <FL label="Nº Documento" required error={invalidFields.includes('numero_documento')}>
                  <Input value={form.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value.toUpperCase())} placeholder="000000" className={`${INPUT_CLS} uppercase`} />
                </FL>
                <FL label="Data Emissão" required error={invalidFields.includes('data_emissao')}>
                  <Input type="date" value={form.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} className={INPUT_CLS} />
                </FL>
                <FL label="Valor Total" required error={invalidFields.includes('valor_total')}>
                  <Input value={formatarMoedaInput(valorTotalNum)} onChange={(e) => handleChange('valor_total', e.target.value)} placeholder="0,00" className={`${INPUT_CLS} text-right font-mono`} />
                </FL>
                <FL label="Desconto">
                  <Input value={formatarMoedaInput(valorDescontoNum)} onChange={(e) => handleChange('valor_desconto', e.target.value)} placeholder="0,00" className={`${INPUT_CLS} text-right font-mono`} />
                </FL>
                <FL label="Valor Líquido">
                  <Input value={formatarMoeda(valorLiquidoNum)} readOnly className={`${INPUT_CLS} text-right font-mono bg-slate-100 font-bold`} />
                </FL>
              </div>

              {/* LINHA 3: Motivo Compra | Forma Pagamento | Conta Financeira */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <FL label="Motivo Compra" required error={invalidFields.includes('motivo_compra_id')}>
                  <AutocompleteGenerico
                    items={motivosCompra}
                    value={form.motivo_compra_id}
                    onChange={(v) => handleChange('motivo_compra_id', v)}
                    placeholder="BUSCAR..."
                    displayField="nome"
                    searchFields={["nome", "categoria"]}
                    renderItem={(m) => <div className="text-xs text-slate-900">{m.nome}</div>}
                    className="w-full"
                    inputClassName={AC_INPUT_CLS}
                  />
                </FL>
                <FL label="Forma Pagamento" required error={invalidFields.includes('forma_pagamento_id')}>
                  <AutocompleteGenerico
                    items={formasFiltradas}
                    value={form.forma_pagamento_id}
                    onChange={(v) => handleChange('forma_pagamento_id', v)}
                    placeholder="BUSCAR..."
                    displayField="nome"
                    searchFields={["nome", "categoria"]}
                    renderItem={(f) => <div className="text-xs text-slate-900">{f.nome}</div>}
                    className="w-full"
                    inputClassName={AC_INPUT_CLS}
                  />
                </FL>
                <FL label="Conta Financeira" required error={invalidFields.includes('conta_financeira_id')}>
                  <AutocompleteGenerico
                    items={contasFinanceiras}
                    value={form.conta_financeira_id}
                    onChange={(v) => handleChange('conta_financeira_id', v)}
                    placeholder="BUSCAR..."
                    displayField="nome"
                    searchFields={["nome", "banco", "conta"]}
                    renderItem={(c) => (
                      <>
                        <div className="text-xs font-medium text-slate-900">{c.nome}</div>
                        {c.banco && <div className="text-[10px] text-slate-500">{c.banco}</div>}
                      </>
                    )}
                    className="w-full"
                    inputClassName={AC_INPUT_CLS}
                  />
                </FL>
              </div>

              {/* LINHA 3: Parcelas (largura total) */}
              <ParcelasSection
                parcelas={form.parcelas}
                onParcelasChange={(p) => handleChange('parcelas', p)}
                valorTotal={valorLiquidoNum}
                dataEmissao={form.data_emissao}
              />

              {/* LINHA 5: Rateio Grupo | Rateio Centro de Custo */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
                <RateioGruposSection
                  rateios={form.rateio_grupos}
                  onChange={(r) => handleChange('rateio_grupos', r)}
                  grupos={gruposComHierarquia}
                  valorTotal={valorLiquidoNum}
                  required
                  error={invalidFields.includes('rateio_grupos')}
                />
                <RateioCentrosCustoSection
                  rateios={form.rateio_centros_custo}
                  onChange={(r) => handleChange('rateio_centros_custo', r)}
                  centros={centrosComHierarquia}
                  valorTotal={valorLiquidoNum}
                  required
                  error={invalidFields.includes('rateio_centros_custo')}
                />
              </div>

              {/* LINHA 6: Observações e Anexos */}
              <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
                <span className="font-semibold text-xs text-slate-700">Observações e Anexos</span>
                <FL label="Observações">
                  <Textarea value={form.observacao} onChange={(e) => handleChange('observacao', e.target.value.toUpperCase())} placeholder="OBSERVAÇÕES..." className="min-h-12 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" rows={2} />
                </FL>
                <div className="flex items-center gap-2 pt-1">
                  <label className="cursor-pointer">
                    <input type="file" className="hidden" onChange={handleUploadAnexo} accept=".pdf,.xml,.jpg,.jpeg,.png" />
                    <Button type="button" variant="outline" size="sm" className="h-6 text-xs gap-1" asChild>
                      <span>{uploadingFile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}{uploadingFile ? 'Enviando...' : 'Anexar'}</span>
                    </Button>
                  </label>
                </div>
                {form.anexos_urls.length > 0 && (
                  <div className="space-y-0.5 pt-0.5">
                    {form.anexos_urls.map((url, i) => (
                      <div key={i} className="flex items-center justify-between bg-white rounded px-2 py-0.5 text-xs border border-slate-200">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[250px]">Anexo {i + 1}</a>
                        <button type="button" className="text-slate-400 hover:text-red-500" onClick={() => setForm(prev => ({ ...prev, anexos_urls: prev.anexos_urls.filter((_, idx) => idx !== i) }))}>
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* BOTÕES */}
              <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
                <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={salvando}>
                  {salvando ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                  {isEditing ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido
        tipo={dialogCadastro.tipo} open={dialogCadastro.open}
        onClose={() => setDialogCadastro({ open: false, tipo: '' })}
        onSuccess={() => { queryClient.invalidateQueries(); setDialogCadastro({ open: false, tipo: '' }); }}
        tipoFinanceiro={form.tipo === 'Pagar' ? 'Despesa' : 'Receita'}
      />
    </>
  );
}