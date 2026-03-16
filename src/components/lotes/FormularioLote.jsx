import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X, ShoppingCart, ClipboardList, BarChart3, HelpCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const SISTEMAS = ["Cria", "Recria", "Engorda", "Ciclo Completo"];

export default function FormularioLote({ onSubmit, onCancel, initialData, isEditing }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

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
    const newData = { ...formData, [field]: value };
    
    if (field === 'categoria_manejo_id') {
      const catManejo = categoriasManejo.find(c => c.id === value);
      if (catManejo) {
        newData.categoria = catManejo.categoria_oficial;
        if (catManejo.sexo) newData.sexo = catManejo.sexo;
        if (catManejo.raca) newData.raca_predominante = catManejo.raca;
      }
    }
    
    if (field === 'fornecedor_id') {
      const forn = fornecedores.find(f => f.id === value);
      if (forn) {
        newData.fornecedor_nome = forn.nome;
        if (forn.cidade) newData.cidade_origem = forn.cidade;
        if (forn.estado) newData.estado_origem = forn.estado;
      }
    }

    if (field === 'quantidade_cabecas' || field === 'valor_total_compra') {
      const qtd = parseFloat(field === 'quantidade_cabecas' ? value : newData.quantidade_cabecas) || 0;
      const total = parseFloat(field === 'valor_total_compra' ? value : newData.valor_total_compra) || 0;
      if (qtd > 0 && total > 0) {
        newData.valor_por_cabeca = (total / qtd).toFixed(2);
      }
    }

    setFormData(newData);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const area = areas.find(a => a.id === formData.area_entrada_id);
    const catManejo = categoriasManejo.find(c => c.id === formData.categoria_manejo_id);
    
    const dataToSave = {
      ...formData,
      nome: formData.nome.toUpperCase(),
      area_entrada_nome: area?.nome || '',
      area_atual_id: formData.area_entrada_id,
      area_atual_nome: area?.nome || '',
      categoria_manejo_nome: catManejo?.nome || '',
      origem: formData.motivo_entrada?.toUpperCase() || '',
      observacoes: formData.observacoes?.toUpperCase(),
      quantidade_cabecas: parseInt(formData.quantidade_cabecas) || 0,
      peso_medio_kg: parseFloat(formData.peso_medio_kg) || 0,
      idade_media_meses: parseInt(formData.idade_media_meses) || 0,
      valor_total_compra: parseFloat(formData.valor_total_compra) || 0,
      valor_por_cabeca: parseFloat(formData.valor_por_cabeca) || 0,
      valor_frete: parseFloat(formData.valor_frete) || 0
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

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {isEditing ? 'Editar Lote' : 'Cadastrar Novo Lote'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* MOTIVO DA ENTRADA */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-700">Motivo da Entrada *</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {["Compra", "Ajuste", "Inventário", "Outros"].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleChange('motivo_entrada', m)}
                    className={`flex items-center gap-2 p-3 border rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      motivo === m 
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500' 
                        : 'border-slate-200 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {motivoIcon[m]}
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* DADOS BÁSICOS DO LOTE */}
            <div className="border-t pt-3">
              <Label className="text-xs font-semibold text-slate-700 mb-2 block">Dados do Lote</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome do Lote *</Label>
                  <Input value={formData.nome} onChange={(e) => handleChange('nome', e.target.value)} placeholder="LOTE 01, ENGORDA A..." className="h-8 text-xs uppercase" required />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quantidade de Cabeças *</Label>
                  <Input type="number" value={formData.quantidade_cabecas} onChange={(e) => handleChange('quantidade_cabecas', e.target.value)} placeholder="50" className="h-8 text-xs" required min="1" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data de Entrada *</Label>
                  <Input type="date" value={formData.data_entrada} onChange={(e) => handleChange('data_entrada', e.target.value)} className="h-8 text-xs" required />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Categoria de Manejo</Label>
                  <Select value={formData.categoria_manejo_id} onValueChange={(v) => handleChange('categoria_manejo_id', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {categoriasManejo.map(cat => (
                        <SelectItem key={cat.id} value={cat.id} className="text-xs">
                          {cat.nome} {cat.categoria_oficial ? `(${cat.categoria_oficial})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sexo</Label>
                  <Select value={formData.sexo} onValueChange={(v) => handleChange('sexo', v)}>
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
                  <Input value={formData.raca_predominante} onChange={(e) => handleChange('raca_predominante', e.target.value)} placeholder="NELORE, ANGUS..." className="h-8 text-xs uppercase" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso Médio (kg)</Label>
                  <Input type="number" step="0.1" value={formData.peso_medio_kg} onChange={(e) => handleChange('peso_medio_kg', e.target.value)} placeholder="0.0" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Idade Média (meses)</Label>
                  <Input type="number" value={formData.idade_media_meses} onChange={(e) => handleChange('idade_media_meses', e.target.value)} placeholder="0" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Área de Entrada</Label>
                  <Select value={formData.area_entrada_id} onValueChange={(v) => handleChange('area_entrada_id', v)}>
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
                  <Select value={formData.sistema_produtivo} onValueChange={(v) => handleChange('sistema_produtivo', v)}>
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

            {/* CAMPOS CONDICIONAIS POR MOTIVO */}
            {motivo === 'Compra' && (
              <div className="border-t pt-3">
                <Label className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1">
                  <ShoppingCart className="w-3.5 h-3.5" /> Dados da Compra
                </Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Fornecedor</Label>
                    <Select value={formData.fornecedor_id} onValueChange={(v) => handleChange('fornecedor_id', v)}>
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
                    <Input value={formData.cidade_origem} onChange={(e) => handleChange('cidade_origem', e.target.value)} placeholder="Cidade" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Estado Origem</Label>
                    <Input value={formData.estado_origem} onChange={(e) => handleChange('estado_origem', e.target.value)} placeholder="UF" className="h-8 text-xs uppercase" maxLength={2} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nota Fiscal</Label>
                    <Input value={formData.nota_fiscal} onChange={(e) => handleChange('nota_fiscal', e.target.value)} placeholder="Nº da NF" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Chave NF-e</Label>
                    <Input value={formData.chave_nfe} onChange={(e) => handleChange('chave_nfe', e.target.value)} placeholder="44 dígitos" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nº GTA</Label>
                    <Input value={formData.numero_gta} onChange={(e) => handleChange('numero_gta', e.target.value)} placeholder="GTA" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valor Total (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_total_compra} onChange={(e) => handleChange('valor_total_compra', e.target.value)} placeholder="0.00" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valor por Cabeça (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_por_cabeca} readOnly placeholder="Calculado" className="h-8 text-xs bg-slate-50" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valor Frete (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_frete} onChange={(e) => handleChange('valor_frete', e.target.value)} placeholder="0.00" className="h-8 text-xs" />
                  </div>
                </div>
              </div>
            )}

            {motivo === 'Ajuste' && (
              <div className="border-t pt-3">
                <Label className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1">
                  <ClipboardList className="w-3.5 h-3.5" /> Dados do Ajuste
                </Label>
                <div className="space-y-1">
                  <Label className="text-xs">Motivo do Ajuste *</Label>
                  <Textarea value={formData.motivo_ajuste} onChange={(e) => handleChange('motivo_ajuste', e.target.value)} placeholder="Descreva o motivo do ajuste..." className="text-xs uppercase" rows={2} required />
                </div>
              </div>
            )}

            {motivo === 'Inventário' && (
              <div className="border-t pt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs text-blue-700 flex items-center gap-1">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Lote de inventário — registro para contagem/conferência do rebanho.
                </p>
              </div>
            )}

            {motivo === 'Outros' && (
              <div className="border-t pt-3">
                <Label className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  <HelpCircle className="w-3.5 h-3.5" /> Descrição
                </Label>
                <div className="space-y-1">
                  <Label className="text-xs">Motivo *</Label>
                  <Textarea value={formData.motivo_outros} onChange={(e) => handleChange('motivo_outros', e.target.value)} placeholder="Descreva..." className="text-xs uppercase" rows={2} required />
                </div>
              </div>
            )}

            {/* OBSERVAÇÕES */}
            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES SOBRE O LOTE..." className="text-xs uppercase" rows={2} />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                <X className="w-3.5 h-3.5 mr-1" /> Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={!motivo}>
                <Save className="w-3.5 h-3.5 mr-1" /> {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}