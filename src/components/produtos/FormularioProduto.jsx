import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Beaker, Package } from "lucide-react";
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
  const [formData, setFormData] = useState(initialData || {
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
    observacoes: ""
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

  const getFieldClassName = (field, baseClassName = "") => {
    const invalid = invalidFields.includes(field);
    return `${baseClassName} ${invalid ? 'border-slate-300 bg-slate-100 focus-visible:ring-slate-400' : ''}`.trim();
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
      if (firstMissingField === 'nome_produto') nomeProdutoRef.current?.focus();
      if (firstMissingField === 'codigo_interno') codigoInternoRef.current?.focus();
      if (firstMissingField === 'unidade_medida') unidadeTriggerRef.current?.focus();
      if (firstMissingField === 'peso_por_saco_kg') pesoSacoRef.current?.focus();
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
      observacoes: formData.observacoes?.toUpperCase() || undefined
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
        <Card className="shadow-sm border-slate-300 bg-white">
          <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {isEditing ? 'Editar Produto' : 'Novo Produto'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome do Produto *</Label>
                  <Input
                    ref={nomeProdutoRef}
                    value={formData.nome_produto}
                    onChange={(e) => handleChange('nome_produto', e.target.value)}
                    placeholder="NOME DO PRODUTO"
                    className={getFieldClassName('nome_produto', "h-8 text-xs uppercase")}
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Código Interno *</Label>
                  <Input
                    ref={codigoInternoRef}
                    value={formData.codigo_interno}
                    onChange={(e) => handleChange('codigo_interno', e.target.value)}
                    placeholder="CÓDIGO INTERNO"
                    className={getFieldClassName('codigo_interno', "h-8 text-xs uppercase")}
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Código de Barras</Label>
                  <Input
                    value={formData.codigo_barras}
                    onChange={(e) => handleChange('codigo_barras', e.target.value)}
                    placeholder="7891234567890"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Categoria</Label>
                  <div className="flex gap-2">
                    <Select value={formData.categoria} onValueChange={(value) => handleChange('categoria', value)}>
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {categoriasOptions.map(cat => (
                          <SelectItem key={cat.value} value={cat.value} className="text-xs">
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovaCategoria(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Unidade de Medida *</Label>
                  <div className="flex gap-2">
                    <Select value={formData.unidade_medida} onValueChange={(value) => handleChange('unidade_medida', value)}>
                      <SelectTrigger ref={unidadeTriggerRef} className={getFieldClassName('unidade_medida', "flex-1 h-8 text-xs")}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {unidadesOptions.map(un => (
                          <SelectItem key={un.value} value={un.value} className="text-xs">
                            {un.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovaUnidade(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Local de Estoque</Label>
                  <div className="flex gap-2">
                    <Select value={formData.local_estoque} onValueChange={(value) => handleChange('local_estoque', value)}>
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {locaisOptions.map(loc => (
                          <SelectItem key={loc.value} value={loc.value} className="text-xs">
                            {loc.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovoLocal(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Preço de Custo</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.preco_custo}
                    onChange={(e) => handleChange('preco_custo', e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Preço de Venda</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.preco_venda}
                    onChange={(e) => handleChange('preco_venda', e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Estoque Mínimo</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.estoque_minimo}
                    onChange={(e) => handleChange('estoque_minimo', e.target.value)}
                    placeholder="0"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Descrição</Label>
                <Textarea
                  value={formData.descricao}
                  onChange={(e) => handleChange('descricao', e.target.value)}
                  placeholder="DESCRIÇÃO DETALHADA DO PRODUTO..."
                  className="text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                  rows={2}
                />
              </div>

              {/* Seção de Suplementação - visível quando categoria é SUPLEMENTAÇÃO */}
              {formData.categoria?.toUpperCase()?.includes("SUPLEMENTA") && (
                <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Beaker className="w-4 h-4 text-indigo-600" />
                      <span className="font-semibold text-sm text-indigo-900">Configuração de Suplementação</span>
                    </div>
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

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Tipo de consumo</Label>
                      <Select value={formData.tipo_consumo || ""} onValueChange={(value) => handleChange('tipo_consumo', value)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CONSUMO_DIARIO" className="text-xs">Consumo Diário</SelectItem>
                          <SelectItem value="CONSUMO_LIVRE" className="text-xs">Consumo Livre</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">%PV consumo padrão</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={formData.percentual_consumo_pv}
                        onChange={(e) => handleChange('percentual_consumo_pv', e.target.value)}
                        placeholder="0.30"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">%PV mínimo</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={formData.consumo_minimo_pv}
                        onChange={(e) => handleChange('consumo_minimo_pv', e.target.value)}
                        placeholder="0.15"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">%PV máximo</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={formData.consumo_maximo_pv}
                        onChange={(e) => handleChange('consumo_maximo_pv', e.target.value)}
                        placeholder="0.60"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="text-[10px] text-indigo-700 bg-indigo-100 rounded px-2 py-1">
                    Fórmula: consumo esperado (kg/dia) = peso vivo médio × (%PV ÷ 100) × nº cabeças. Ex: 450kg × 0.3% = 1,35 kg/cab/dia
                  </div>
                </div>
              )}

              {/* Seção de Unidade de Estoque */}
              <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-600" />
                  <span className="font-semibold text-sm text-slate-700">Unidade de Estoque</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Unidade principal de estoque</Label>
                    <Select value={formData.unidade_principal_estoque || "KG"} onValueChange={(value) => handleChange('unidade_principal_estoque', value)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="KG" className="text-xs">Quilogramas (KG)</SelectItem>
                        <SelectItem value="SACO" className="text-xs">Sacos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.unidade_principal_estoque === "SACO" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Peso por saco (kg) *</Label>
                      <Input
                        ref={pesoSacoRef}
                        type="number"
                        step="0.1"
                        value={formData.peso_por_saco_kg}
                        onChange={(e) => handleChange('peso_por_saco_kg', e.target.value)}
                        placeholder="40"
                        className={getFieldClassName('peso_por_saco_kg', "h-8 text-xs")}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea
                  value={formData.observacoes}
                  onChange={(e) => handleChange('observacoes', e.target.value)}
                  placeholder="OBSERVAÇÕES GERAIS..."
                  className="text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
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
              <Label className="text-xs">Sigla *</Label>
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
              <Label className="text-xs">Descrição *</Label>
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
              <Label className="text-xs">Nome *</Label>
              <Input
                value={novaCategoria.nome}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })}
                placeholder="NOME DA CATEGORIA"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subcategoria</Label>
              <Input
                value={novaCategoria.subcategoria}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, subcategoria: e.target.value })}
                placeholder="SUBCATEGORIA"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
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
              <Label className="text-xs">Nome *</Label>
              <Input
                value={novoLocal.nome}
                onChange={(e) => setNovoLocal({ ...novoLocal, nome: e.target.value })}
                placeholder="NOME DO LOCAL"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
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
              <Label className="text-xs">Capacidade</Label>
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