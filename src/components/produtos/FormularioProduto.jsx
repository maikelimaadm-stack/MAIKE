import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { sugerirPercentualPV } from "../suplementacao/suplementacaoRules";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function FormularioProduto({ onSubmit, onCancel, initialData, isEditing }) {
  const [formData, setFormData] = useState(() => {
    const defaults = {
      nome_produto: "",
      codigo_interno: "",
      codigo_barras: "",
      categoria: "",
      descricao: "",
      unidade_medida: "",
      preco_custo: "",
      preco_venda: "",
      estoque_minimo: "0",
      local_estoque: "",
      tipo_consumo: "",
      percentual_consumo_pv: "",
      consumo_minimo_pv: "",
      consumo_maximo_pv: "",
      unidade_principal_estoque: "KG",
      peso_por_saco_kg: "",
      observacoes: "",
      ativo: true,
    };
    if (initialData) return { ...defaults, ...initialData, ativo: initialData.ativo !== false };
    return defaults;
  });

  const [showNovaUnidade, setShowNovaUnidade] = useState(false);
  const [showNovaCategoria, setShowNovaCategoria] = useState(false);
  const [showNovoLocal, setShowNovoLocal] = useState(false);
  const [invalidFields, setInvalidFields] = useState([]);
  const [novaUnidade, setNovaUnidade] = useState({ sigla: "", descricao: "" });
  const [novaCategoria, setNovaCategoria] = useState({ nome: "", subcategoria: "", descricao: "" });
  const [novoLocal, setNovoLocal] = useState({ nome: "", descricao: "", capacidade: "" });

  const queryClient = useQueryClient();
  const nomeProdutoRef = useRef(null);
  const codigoInternoRef = useRef(null);
  const pesoSacoRef = useRef(null);
  const unidadeTriggerRef = useRef(null);

  const { data: unidades = [] } = useQuery({
    queryKey: ['unidades'],
    queryFn: () => base44.entities.UnidadeMedida.list(),
    initialData: [],
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const createUnidadeMutation = useMutation({
    mutationFn: async (data) => {
      const allUnidades = await base44.entities.UnidadeMedida.list();
      const maxNum = allUnidades.reduce((max, u) => {
        const num = parseInt(u.numero_unidade);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const proximoNumero = maxNum + 1;
      return base44.entities.UnidadeMedida.create({ ...data, numero_unidade: String(proximoNumero) });
    },
    onSuccess: (newUnidade) => {
      queryClient.invalidateQueries({ queryKey: ['unidades'] });
      setFormData({ ...formData, unidade_medida: newUnidade.sigla });
      setShowNovaUnidade(false);
      setNovaUnidade({ sigla: "", descricao: "" });
      toast.success('Unidade cadastrada!');
    },
  });

  const createCategoriaMutation = useMutation({
    mutationFn: async (data) => {
      const allCategorias = await base44.entities.Categoria.list();
      const maxNum = allCategorias.reduce((max, c) => {
        const num = parseInt(c.numero_categoria);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const proximoNumero = maxNum + 1;
      return base44.entities.Categoria.create({ ...data, numero_categoria: String(proximoNumero) });
    },
    onSuccess: (newCategoria) => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setFormData({ ...formData, categoria: newCategoria.nome });
      setShowNovaCategoria(false);
      setNovaCategoria({ nome: "", subcategoria: "", descricao: "" });
      toast.success('Categoria cadastrada!');
    },
  });

  const createLocalMutation = useMutation({
    mutationFn: async (data) => {
      const allLocais = await base44.entities.LocalEstoque.list();
      const maxNum = allLocais.reduce((max, l) => {
        const num = parseInt(l.numero_local);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const proximoNumero = maxNum + 1;
      return base44.entities.LocalEstoque.create({ ...data, numero_local: String(proximoNumero) });
    },
    onSuccess: (newLocal) => {
      queryClient.invalidateQueries({ queryKey: ['locais'] });
      setFormData({ ...formData, local_estoque: newLocal.nome });
      setShowNovoLocal(false);
      setNovoLocal({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local cadastrado!');
    },
  });

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
    setInvalidFields((prev) => prev.filter((item) => item !== field));
  };

  const FL = ({ label, required, error, children, dataField }) => (
    <div data-field={dataField}>
      <label className="text-[12px] text-slate-500 pl-1 leading-none">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
        {children}
      </div>
    </div>
  );

  const getFieldClassName = (field, baseClassName = "") => {
    const invalid = invalidFields.includes(field);
    return `${baseClassName} ${invalid ? 'border-red-500 bg-red-50 focus-visible:ring-red-500' : ''}`.trim();
  };

  const scrollToField = (element) => {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => element.focus?.(), 250);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const missingFields = [];

    if (!formData.nome_produto?.trim()) missingFields.push('nome_produto');
    if (!formData.codigo_interno?.trim()) missingFields.push('codigo_interno');
    if (!formData.unidade_medida?.trim()) missingFields.push('unidade_medida');
    if (formData.unidade_principal_estoque === "SACO" && !formData.peso_por_saco_kg) {
      missingFields.push('peso_por_saco_kg');
    }

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);

      const firstMissingField = missingFields[0];
      if (firstMissingField === 'nome_produto') scrollToField(nomeProdutoRef.current);
      if (firstMissingField === 'codigo_interno') scrollToField(codigoInternoRef.current);
      if (firstMissingField === 'unidade_medida') scrollToField(unidadeTriggerRef.current);
      if (firstMissingField === 'peso_por_saco_kg') scrollToField(pesoSacoRef.current);
      return;
    }

    const data = {
      nome_produto: formData.nome_produto?.toUpperCase(),
      codigo_interno: formData.codigo_interno?.toUpperCase(),
      codigo_barras: formData.codigo_barras || undefined,
      categoria: formData.categoria?.toUpperCase() || undefined,
      descricao: formData.descricao?.toUpperCase() || undefined,
      unidade_medida: formData.unidade_medida?.toUpperCase(),
      preco_custo: parseFloat(formData.preco_custo) || 0,
      preco_venda: parseFloat(formData.preco_venda) || 0,
      estoque_minimo: parseFloat(formData.estoque_minimo) || 0,
      local_estoque: formData.local_estoque?.toUpperCase() || undefined,
      tipo_consumo: formData.tipo_consumo || undefined,
      percentual_consumo_pv: parseFloat(formData.percentual_consumo_pv) || undefined,
      consumo_minimo_pv: parseFloat(formData.consumo_minimo_pv) || undefined,
      consumo_maximo_pv: parseFloat(formData.consumo_maximo_pv) || undefined,
      unidade_principal_estoque: formData.unidade_principal_estoque || "KG",
      peso_por_saco_kg: formData.unidade_principal_estoque === "SACO" ? parseFloat(formData.peso_por_saco_kg) || undefined : undefined,
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      ativo: formData.ativo,
    };

    if (!isEditing) {
      data.estoque_atual = 0;
    }

    onSubmit(data);
  };

  const categoriasFixas = [{ value: 'SUPLEMENTAÇÃO', label: 'SUPLEMENTAÇÃO' }];
  const categoriasOptions = [...categoriasFixas, ...categorias.map(c => ({ value: c.nome, label: c.nome }))];
  const unidadesOptions = unidades.map(u => ({ value: u.sigla, label: `${u.sigla} - ${u.descricao}` }));
  const locaisOptions = locais.map(l => ({ value: l.nome, label: l.nome }));

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
      >
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
            <CardTitle className="text-sm font-semibold text-slate-700">
              {isEditing ? 'Editar Produto' : 'Novo Produto'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-1">
            <form onSubmit={handleSubmit} className="space-y-0.5">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <FL label="Nome do Produto" required error={invalidFields.includes('nome_produto')} dataField="nome_produto">
                  <Input ref={nomeProdutoRef} value={formData.nome_produto} onChange={(e) => handleChange('nome_produto', e.target.value)} placeholder="NOME DO PRODUTO" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: 'uppercase' }} />
                </FL>
                <FL label="Código Interno" required error={invalidFields.includes('codigo_interno')} dataField="codigo_interno">
                  <Input ref={codigoInternoRef} value={formData.codigo_interno} onChange={(e) => handleChange('codigo_interno', e.target.value)} placeholder="CÓDIGO INTERNO" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: 'uppercase' }} />
                </FL>
                <FL label="Código de Barras" dataField="codigo_barras">
                  <Input value={formData.codigo_barras} onChange={(e) => handleChange('codigo_barras', e.target.value)} placeholder="7891234567890" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </FL>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <div>
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Categoria</label>
                  <div className="flex gap-1">
                    <div className="flex-1 rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
                      <Select value={formData.categoria} onValueChange={(value) => handleChange('categoria', value)}>
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                        <SelectContent>{categoriasOptions.map(cat => (<SelectItem key={cat.value} value={cat.value} className="text-xs">{cat.label}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowNovaCategoria(true)} className="h-7 px-2 text-xs">Novo</Button>
                  </div>
                </div>
                <div>
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Unidade de Medida <span className="text-red-500">*</span></label>
                  <div className="flex gap-1">
                    <div className={`flex-1 rounded-md border ${invalidFields.includes('unidade_medida') ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
                      <Select value={formData.unidade_medida} onValueChange={(value) => handleChange('unidade_medida', value)}>
                        <SelectTrigger ref={unidadeTriggerRef} className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                        <SelectContent>{unidadesOptions.map(un => (<SelectItem key={un.value} value={un.value} className="text-xs">{un.label}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowNovaUnidade(true)} className="h-7 px-2 text-xs">Novo</Button>
                  </div>
                </div>
                <div>
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Local de Estoque</label>
                  <div className="flex gap-1">
                    <div className="flex-1 rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
                      <Select value={formData.local_estoque} onValueChange={(value) => handleChange('local_estoque', value)}>
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                        <SelectContent>{locaisOptions.map(loc => (<SelectItem key={loc.value} value={loc.value} className="text-xs">{loc.label}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowNovoLocal(true)} className="h-7 px-2 text-xs">Novo</Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <FL label="Preço de Custo" dataField="preco_custo">
                  <Input type="number" step="0.01" value={formData.preco_custo} onChange={(e) => handleChange('preco_custo', e.target.value)} placeholder="0.00" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </FL>
                <FL label="Preço de Venda" dataField="preco_venda">
                  <Input type="number" step="0.01" value={formData.preco_venda} onChange={(e) => handleChange('preco_venda', e.target.value)} placeholder="0.00" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </FL>
                <FL label="Estoque Mínimo" dataField="estoque_minimo">
                  <Input type="number" step="0.01" value={formData.estoque_minimo} onChange={(e) => handleChange('estoque_minimo', e.target.value)} placeholder="0" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </FL>
              </div>

              <FL label="Descrição" dataField="descricao">
                <Textarea value={formData.descricao} onChange={(e) => handleChange('descricao', e.target.value)} placeholder="DESCRIÇÃO DETALHADA DO PRODUTO..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: 'uppercase' }} rows={2} />
              </FL>

              {/* Seção de Suplementação */}
              {formData.categoria?.toUpperCase()?.includes("SUPLEMENTA") && (
                <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-1 space-y-0.5">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1">
                    <span className="font-semibold text-xs text-slate-700">Configuração de Suplementação</span>
                    {!formData.percentual_consumo_pv && formData.nome_produto && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-indigo-300 text-indigo-700"
                        onClick={() => {
                          const sugestao = sugerirPercentualPV(formData.nome_produto);
                          if (sugestao) {
                            setFormData(prev => ({
                              ...prev,
                              percentual_consumo_pv: sugestao.percentual_consumo_pv,
                              consumo_minimo_pv: sugestao.consumo_minimo_pv,
                              consumo_maximo_pv: sugestao.consumo_maximo_pv,
                              tipo_consumo: sugestao.tipo_consumo,
                            }));
                            toast.success(`Valores sugeridos para "${sugestao.label}" aplicados.`);
                          } else {
                            toast.info("Não há sugestão para este produto. Preencha manualmente.");
                          }
                        }}
                      >
                        Sugerir valores
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
                    <div>
                      <label className="text-[12px] text-slate-500 pl-1 leading-none">Tipo de consumo</label>
                      <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
                      <Select value={formData.tipo_consumo || ""} onValueChange={(value) => handleChange('tipo_consumo', value)}>
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CONSUMO_DIARIO" className="text-xs">CONSUMO DIÁRIO</SelectItem>
                          <SelectItem value="CONSUMO_LIVRE" className="text-xs">CONSUMO LIVRE</SelectItem>
                        </SelectContent>
                      </Select>
                      </div>
                    </div>
                    <FL label="%PV consumo padrão" dataField="percentual_consumo_pv">
                      <Input type="number" step="0.001" value={formData.percentual_consumo_pv} onChange={(e) => handleChange('percentual_consumo_pv', e.target.value)} placeholder="0.30" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                    </FL>
                    <FL label="%PV mínimo" dataField="consumo_minimo_pv">
                      <Input type="number" step="0.001" value={formData.consumo_minimo_pv} onChange={(e) => handleChange('consumo_minimo_pv', e.target.value)} placeholder="0.15" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                    </FL>
                    <FL label="%PV máximo" dataField="consumo_maximo_pv">
                      <Input type="number" step="0.001" value={formData.consumo_maximo_pv} onChange={(e) => handleChange('consumo_maximo_pv', e.target.value)} placeholder="0.60" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                    </FL>
                  </div>

                  <div className="text-[10px] text-indigo-700 bg-indigo-100 rounded px-2 py-1">
                    Fórmula: consumo esperado (kg/dia) = peso vivo médio × (%PV ÷ 100) × nº cabeças. Ex: 450kg × 0.3% = 1,35 kg/cab/dia
                  </div>
                </div>
              )}

              {/* Seção de Unidade de Estoque */}
              <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
                <div>
                  <span className="font-semibold text-xs text-slate-700">Unidade de Estoque</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
                  <div>
                    <label className="text-[12px] text-slate-500 pl-1 leading-none">Unidade principal de estoque</label>
                    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
                      <Select value={formData.unidade_principal_estoque || "KG"} onValueChange={(value) => handleChange('unidade_principal_estoque', value)}>
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="KG" className="text-xs">QUILOGRAMAS (KG)</SelectItem>
                          <SelectItem value="SACO" className="text-xs">SACOS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {formData.unidade_principal_estoque === "SACO" && (
                    <FL label="Peso por saco (kg)" required error={invalidFields.includes('peso_por_saco_kg')} dataField="peso_por_saco_kg">
                      <Input ref={pesoSacoRef} type="number" step="0.1" value={formData.peso_por_saco_kg} onChange={(e) => handleChange('peso_por_saco_kg', e.target.value)} placeholder="40" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                    </FL>
                  )}
                </div>
              </div>

              <FL label="Observações" dataField="observacoes">
                <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES GERAIS..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: 'uppercase' }} rows={2} />
              </FL>

              <div className="flex flex-wrap gap-6 py-1 px-1">
                <div className="flex items-center gap-2">
                  <Checkbox id="prod_ativo" checked={formData.ativo} onCheckedChange={(v) => handleChange("ativo", v)} />
                  <label htmlFor="prod_ativo" className="text-xs text-slate-700 cursor-pointer">Ativo</label>
                </div>
              </div>

              <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
                  {isEditing ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={showNovaUnidade} onOpenChange={setShowNovaUnidade}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Nova Unidade de Medida</DialogTitle>
            <DialogDescription className="text-xs">Cadastre uma nova unidade</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Sigla <span className="text-red-500">*</span></label>
              <Input
                value={novaUnidade.sigla}
                onChange={(e) => setNovaUnidade({ ...novaUnidade, sigla: e.target.value })}
                placeholder="EX: KG, UN, LT"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                maxLength={10}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Descrição <span className="text-red-500">*</span></label>
              <Input
                value={novaUnidade.descricao}
                onChange={(e) => setNovaUnidade({ ...novaUnidade, descricao: e.target.value })}
                placeholder="DESCRIÇÃO DA UNIDADE"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNovaUnidade(false); setNovaUnidade({ sigla: "", descricao: "" }); }} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={() => {
                if (!novaUnidade.sigla?.trim()) {
                  toast.error('❌ Sigla é obrigatória!');
                  return;
                }
                if (!novaUnidade.descricao?.trim()) {
                  toast.error('❌ Descrição é obrigatória!');
                  return;
                }
                createUnidadeMutation.mutate({ sigla: novaUnidade.sigla.toUpperCase(), descricao: novaUnidade.descricao.toUpperCase() });
              }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovaCategoria} onOpenChange={setShowNovaCategoria}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Nova Categoria</DialogTitle>
            <DialogDescription className="text-xs">Cadastre uma nova categoria</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Nome <span className="text-red-500">*</span></label>
              <Input
                value={novaCategoria.nome}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })}
                placeholder="NOME DA CATEGORIA"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Subcategoria</label>
              <Input
                value={novaCategoria.subcategoria}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, subcategoria: e.target.value })}
                placeholder="SUBCATEGORIA"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Descrição</label>
              <Textarea
                value={novaCategoria.descricao}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, descricao: e.target.value })}
                placeholder="DESCRIÇÃO"
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNovaCategoria(false); setNovaCategoria({ nome: "", subcategoria: "", descricao: "" }); }} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={() => {
                if (!novaCategoria.nome?.trim()) {
                  toast.error('❌ Nome da categoria é obrigatório!');
                  return;
                }
                createCategoriaMutation.mutate({ nome: novaCategoria.nome.toUpperCase(), subcategoria: novaCategoria.subcategoria?.toUpperCase(), descricao: novaCategoria.descricao?.toUpperCase() });
              }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoLocal} onOpenChange={setShowNovoLocal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Novo Local de Estoque</DialogTitle>
            <DialogDescription className="text-xs">Cadastre um novo local</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Nome <span className="text-red-500">*</span></label>
              <Input
                value={novoLocal.nome}
                onChange={(e) => setNovoLocal({ ...novoLocal, nome: e.target.value })}
                placeholder="NOME DO LOCAL"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Descrição</label>
              <Textarea
                value={novoLocal.descricao}
                onChange={(e) => setNovoLocal({ ...novoLocal, descricao: e.target.value })}
                placeholder="DESCRIÇÃO"
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Capacidade</label>
              <Input
                value={novoLocal.capacidade}
                onChange={(e) => setNovoLocal({ ...novoLocal, capacidade: e.target.value })}
                placeholder="CAPACIDADE"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNovoLocal(false); setNovoLocal({ nome: "", descricao: "", capacidade: "" }); }} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={() => {
                if (!novoLocal.nome?.trim()) {
                  toast.error('❌ Nome do local é obrigatório!');
                  return;
                }
                createLocalMutation.mutate({ nome: novoLocal.nome.toUpperCase(), descricao: novoLocal.descricao?.toUpperCase(), capacidade: novoLocal.capacidade?.toUpperCase() });
              }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}