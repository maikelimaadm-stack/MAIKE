import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ShoppingCart, ClipboardList, BarChart3, HelpCircle, Layers3 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

const SISTEMAS = ["Cria", "Recria", "Engorda", "Ciclo Completo"];
const UPPERCASE_FIELDS = [
  "nome",
  "raca_predominante",
  "cidade_origem",
  "estado_origem",
  "nota_fiscal",
  "chave_nfe",
  "numero_gta",
  "motivo_ajuste",
  "motivo_outros",
  "observacoes",
];

export default function FormularioLote({ onSubmit, onCancel, initialData, isEditing }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState(initialData || {
    nome: "",
    quantidade_cabecas: "",
    categoria: "",
    categoria_manejo_id: "",
    sexo: "",
    peso_medio_kg: "",
    idade_media_meses: "",
    area_entrada_id: "",
    raca_predominante: "",
    sistema_produtivo: "",
    data_entrada: new Date().toISOString().split('T')[0],
    motivo_entrada: "",
    fornecedor_id: "",
    fornecedor_nome: "",
    nota_fiscal: "",
    chave_nfe: "",
    numero_gta: "",
    cidade_origem: "",
    estado_origem: "",
    valor_total_compra: "",
    valor_por_cabeca: "",
    valor_frete: "",
    motivo_ajuste: "",
    motivo_outros: "",
    observacoes: ""
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ['categorias-manejo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const handleChange = (field, value) => {
    const normalizedValue = UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    const newData = { ...formData, [field]: normalizedValue };

    if (field === 'categoria_manejo_id') {
      const catManejo = categoriasManejo.find(c => c.id === value);
      if (catManejo) {
        newData.categoria = catManejo.categoria_oficial;
        if (catManejo.sexo) newData.sexo = catManejo.sexo;
        if (catManejo.raca) newData.raca_predominante = String(catManejo.raca).toUpperCase();
      }
    }

    if (field === 'fornecedor_id') {
      const forn = fornecedores.find(f => f.id === value);
      if (forn) {
        newData.fornecedor_nome = forn.nome;
        if (forn.cidade) newData.cidade_origem = String(forn.cidade).toUpperCase();
        if (forn.estado) newData.estado_origem = String(forn.estado).toUpperCase();
      }
    }

    if (field === 'quantidade_cabecas' || field === 'valor_total_compra') {
      const qtd = parseFloat(field === 'quantidade_cabecas' ? value : newData.quantidade_cabecas) || 0;
      const total = parseFloat(field === 'valor_total_compra' ? value : newData.valor_total_compra) || 0;
      if (qtd > 0 && total > 0) {
        newData.valor_por_cabeca = (total / qtd).toFixed(2);
      }
    }

    setErrors((prev) => ({ ...prev, [field]: false }));
    setFormData(newData);
  };

  const validateForm = () => {
    const nextErrors = {};
    const missing = [];

    if (!formData.motivo_entrada) {
      nextErrors.motivo_entrada = true;
      missing.push('Motivo da Entrada');
    }
    if (!formData.nome?.trim()) {
      nextErrors.nome = true;
      missing.push('Nome do Lote');
    }
    if (!formData.quantidade_cabecas) {
      nextErrors.quantidade_cabecas = true;
      missing.push('Quantidade de Cabeças');
    }
    if (!formData.data_entrada) {
      nextErrors.data_entrada = true;
      missing.push('Data de Entrada');
    }
    if (formData.motivo_entrada === 'Ajuste' && !formData.motivo_ajuste?.trim()) {
      nextErrors.motivo_ajuste = true;
      missing.push('Motivo do Ajuste');
    }
    if (formData.motivo_entrada === 'Outros' && !formData.motivo_outros?.trim()) {
      nextErrors.motivo_outros = true;
      missing.push('Motivo');
    }

    setErrors(nextErrors);

    if (!missing.length) return true;

    toast.error(`Preencha os campos obrigatórios: ${missing.join(', ')}.`);
    const firstField = Object.keys(nextErrors)[0];
    const element = document.querySelector(`[data-field="${firstField}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element?.focus?.();
    return false;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const area = areas.find(a => a.id === formData.area_entrada_id);
    const catManejo = categoriasManejo.find(c => c.id === formData.categoria_manejo_id);
    const qtd = parseInt(formData.quantidade_cabecas) || 0;
    const peso = parseFloat(formData.peso_medio_kg) || 0;

    const dataToSave = {
      ...formData,
      nome: formData.nome.toUpperCase(),
      area_entrada_nome: area?.nome || '',
      area_atual_id: formData.area_entrada_id,
      area_atual_nome: area?.nome || '',
      categoria_manejo_nome: catManejo?.nome || '',
      origem: formData.motivo_entrada?.toUpperCase() || '',
      observacoes: formData.observacoes?.toUpperCase(),
      quantidade_cabecas: qtd,
      peso_medio_kg: peso,
      idade_media_meses: parseInt(formData.idade_media_meses) || 0,
      valor_total_compra: parseFloat(formData.valor_total_compra) || 0,
      valor_por_cabeca: parseFloat(formData.valor_por_cabeca) || 0,
      valor_frete: parseFloat(formData.valor_frete) || 0,
      ...(!isEditing ? {
        quantidade_entrada: qtd,
        peso_entrada_kg: peso,
        categoria_entrada: formData.categoria || '',
        categoria_manejo_entrada_id: formData.categoria_manejo_id || '',
        categoria_manejo_entrada_nome: catManejo?.nome || '',
      } : {})
    };

    onSubmit(dataToSave);
  };

  const motivo = formData.motivo_entrada;

  const motivoIcon = {
    Compra: <ShoppingCart className="w-4 h-4 text-emerald-600" />,
    Ajuste: <ClipboardList className="w-4 h-4 text-amber-600" />,
    'Inventário': <BarChart3 className="w-4 h-4 text-blue-600" />,
    Outros: <HelpCircle className="w-4 h-4 text-slate-600" />,
  };

  const inputErrorClass = "aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-red-500";

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-slate-50 border-b py-3 px-4">
          <CardTitle className="font-semibold text-sm text-slate-700 flex items-center gap-2">
            <Layers3 className="w-4 h-4" />
            {isEditing ? 'Editar Lote' : 'Cadastrar Novo Lote'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4 max-h-[calc(100vh-180px)] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-1">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Motivo da Entrada *</Label>
              <div
                data-field="motivo_entrada"
                tabIndex={-1}
                className={`grid grid-cols-2 lg:grid-cols-4 gap-1 rounded-md ${errors.motivo_entrada ? 'ring-1 ring-red-500 p-1' : ''}`}
              >
                {["Compra", "Ajuste", "Inventário", "Outros"].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleChange('motivo_entrada', m)}
                    className={`flex items-center gap-2 p-2 border rounded-md text-xs font-medium transition-all text-left ${
                      motivo === m
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {motivoIcon[m]}
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t pt-3 space-y-1">
              <div className="font-semibold text-sm text-slate-700 flex items-center gap-2 mb-1">
                <Layers3 className="w-4 h-4" /> Dados do Lote
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="nome_lote" className="text-xs">Nome do Lote *</Label>
                  <Input id="nome_lote" data-field="nome" aria-invalid={errors.nome ? 'true' : 'false'} value={formData.nome || ""} onChange={(e) => handleChange('nome', e.target.value)} placeholder="LOTE 01" className={`h-8 text-xs ${inputErrorClass}`} style={{ textTransform: 'uppercase' }} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="quantidade_cabecas" className="text-xs">Quantidade de Cabeças *</Label>
                  <Input id="quantidade_cabecas" data-field="quantidade_cabecas" aria-invalid={errors.quantidade_cabecas ? 'true' : 'false'} type="number" value={formData.quantidade_cabecas || ""} onChange={(e) => handleChange('quantidade_cabecas', e.target.value)} placeholder="50" className={`h-8 text-xs ${inputErrorClass}`} required min="1" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="data_entrada" className="text-xs">Data de Entrada *</Label>
                  <Input id="data_entrada" data-field="data_entrada" aria-invalid={errors.data_entrada ? 'true' : 'false'} type="date" value={formData.data_entrada || ""} onChange={(e) => handleChange('data_entrada', e.target.value)} className={`h-8 text-xs ${inputErrorClass}`} required />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Categoria de Manejo</Label>
                  <Select value={formData.categoria_manejo_id || ""} onValueChange={(v) => handleChange('categoria_manejo_id', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {categoriasManejo.map(cat => (
                        <SelectItem key={cat.id} value={cat.id} className="text-xs">{cat.nome} {cat.categoria_oficial ? `(${cat.categoria_oficial})` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sexo</Label>
                  <Select value={formData.sexo || ""} onValueChange={(v) => handleChange('sexo', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                      <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                      <SelectItem value="Misto" className="text-xs">Misto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Raça Predominante</Label>
                  <Input value={formData.raca_predominante || ""} onChange={(e) => handleChange('raca_predominante', e.target.value)} placeholder="NELORE" className="h-8 text-xs" style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso Médio (kg)</Label>
                  <Input type="number" step="0.1" value={formData.peso_medio_kg || ""} onChange={(e) => handleChange('peso_medio_kg', e.target.value)} placeholder="0.0" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Idade Média (meses)</Label>
                  <Input type="number" value={formData.idade_media_meses || ""} onChange={(e) => handleChange('idade_media_meses', e.target.value)} placeholder="0" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Área de Entrada</Label>
                  <Select value={formData.area_entrada_id || ""} onValueChange={(v) => handleChange('area_entrada_id', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sistema Produtivo</Label>
                  <Select value={formData.sistema_produtivo || ""} onValueChange={(v) => handleChange('sistema_produtivo', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {SISTEMAS.map(sys => (
                        <SelectItem key={sys} value={sys} className="text-xs">{sys}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {motivo === 'Compra' && (
              <div className="border-t pt-3 space-y-1">
                <div className="font-semibold text-sm text-slate-700 flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4" /> Dados da Compra
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Fornecedor</Label>
                    <Select value={formData.fornecedor_id || ""} onValueChange={(v) => handleChange('fornecedor_id', v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {fornecedores.map(f => (
                          <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cidade Origem</Label>
                    <Input value={formData.cidade_origem || ""} onChange={(e) => handleChange('cidade_origem', e.target.value)} placeholder="CIDADE" className="h-8 text-xs" style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Estado Origem</Label>
                    <Input value={formData.estado_origem || ""} onChange={(e) => handleChange('estado_origem', e.target.value)} placeholder="UF" className="h-8 text-xs" maxLength={2} style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nota Fiscal</Label>
                    <Input value={formData.nota_fiscal || ""} onChange={(e) => handleChange('nota_fiscal', e.target.value)} placeholder="Nº DA NF" className="h-8 text-xs" style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Chave NF-e</Label>
                    <Input value={formData.chave_nfe || ""} onChange={(e) => handleChange('chave_nfe', e.target.value)} placeholder="44 DÍGITOS" className="h-8 text-xs" style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nº GTA</Label>
                    <Input value={formData.numero_gta || ""} onChange={(e) => handleChange('numero_gta', e.target.value)} placeholder="GTA" className="h-8 text-xs" style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valor Total (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_total_compra || ""} onChange={(e) => handleChange('valor_total_compra', e.target.value)} placeholder="0.00" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valor por Cabeça (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_por_cabeca || ""} readOnly placeholder="Calculado" className="h-8 text-xs bg-slate-50" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valor Frete (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_frete || ""} onChange={(e) => handleChange('valor_frete', e.target.value)} placeholder="0.00" className="h-8 text-xs" />
                  </div>
                </div>
              </div>
            )}

            {motivo === 'Ajuste' && (
              <div className="border-t pt-3 space-y-1">
                <div className="font-semibold text-sm text-slate-700 flex items-center gap-2 mb-1">
                  <ClipboardList className="w-4 h-4" /> Dados do Ajuste
                </div>
                <div className="space-y-1">
                  <Label htmlFor="motivo_ajuste" className="text-xs">Motivo do Ajuste *</Label>
                  <Textarea id="motivo_ajuste" data-field="motivo_ajuste" aria-invalid={errors.motivo_ajuste ? 'true' : 'false'} value={formData.motivo_ajuste || ""} onChange={(e) => handleChange('motivo_ajuste', e.target.value)} placeholder="DESCREVA O MOTIVO DO AJUSTE" className={`text-xs ${inputErrorClass}`} rows={2} style={{ textTransform: 'uppercase' }} required />
                </div>
              </div>
            )}

            {motivo === 'Inventário' && (
              <div className="border-t pt-3 p-3 bg-blue-50 rounded-md border border-blue-200">
                <p className="text-xs text-blue-700 flex items-center gap-1">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Lote de inventário — registro para contagem e conferência do rebanho.
                </p>
              </div>
            )}

            {motivo === 'Outros' && (
              <div className="border-t pt-3 space-y-1">
                <div className="font-semibold text-sm text-slate-700 flex items-center gap-2 mb-1">
                  <HelpCircle className="w-4 h-4" /> Descrição
                </div>
                <div className="space-y-1">
                  <Label htmlFor="motivo_outros" className="text-xs">Motivo *</Label>
                  <Textarea id="motivo_outros" data-field="motivo_outros" aria-invalid={errors.motivo_outros ? 'true' : 'false'} value={formData.motivo_outros || ""} onChange={(e) => handleChange('motivo_outros', e.target.value)} placeholder="DESCREVA O MOTIVO" className={`text-xs ${inputErrorClass}`} rows={2} style={{ textTransform: 'uppercase' }} required />
                </div>
              </div>
            )}

            <div className="border-t pt-3 space-y-1">
              <div className="font-semibold text-sm text-slate-700">Observações</div>
              <Textarea value={formData.observacoes || ""} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES SOBRE O LOTE" className="text-xs" rows={2} style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
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
  );
}