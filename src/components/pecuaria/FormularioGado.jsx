import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function FormularioGado({ onSubmit, onCancel, initialData, isEditing, areas }) {
  const [formData, setFormData] = useState(initialData || {
    nome: "",
    categoria: "",
    sexo: "",
    idade_meses: "",
    peso_kg: "",
    origem: "",
    sistema_produtivo: "",
    area_atual_id: "",
    lote: "",
    raca: "",
    data_nascimento: "",
    observacoes: ""
  });

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome?.trim()) {
      toast.error('Nome é obrigatório!');
      return;
    }

    if (!formData.categoria) {
      toast.error('Categoria é obrigatória!');
      return;
    }

    if (!formData.sexo) {
      toast.error('Sexo é obrigatório!');
      return;
    }

    const data = {
      nome: formData.nome?.toUpperCase(),
      categoria: formData.categoria,
      sexo: formData.sexo,
      idade_meses: parseFloat(formData.idade_meses) || undefined,
      peso_kg: parseFloat(formData.peso_kg) || undefined,
      origem: formData.origem?.toUpperCase() || undefined,
      sistema_produtivo: formData.sistema_produtivo || undefined,
      area_atual_id: formData.area_atual_id || undefined,
      lote: formData.lote?.toUpperCase() || undefined,
      raca: formData.raca?.toUpperCase() || undefined,
      data_nascimento: formData.data_nascimento || undefined,
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      status: 'Ativo'
    };

    onSubmit(data);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {isEditing ? 'Editar Animal' : 'Novo Animal'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome/Identificação *</Label>
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange('nome', e.target.value)}
                  placeholder="NOME DO ANIMAL"
                  required
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Categoria *</Label>
                <Select value={formData.categoria} onValueChange={(v) => handleChange('categoria', v)} required>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Bezerro" className="text-xs">Bezerro</SelectItem>
                    <SelectItem value="Bezerro Desmamado" className="text-xs">Bezerro Desmamado</SelectItem>
                    <SelectItem value="Novilho" className="text-xs">Novilho</SelectItem>
                    <SelectItem value="Novilha" className="text-xs">Novilha</SelectItem>
                    <SelectItem value="Vaca" className="text-xs">Vaca</SelectItem>
                    <SelectItem value="Touro" className="text-xs">Touro</SelectItem>
                    <SelectItem value="Garrote" className="text-xs">Garrote</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sexo *</Label>
                <Select value={formData.sexo} onValueChange={(v) => handleChange('sexo', v)} required>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                    <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Idade (meses)</Label>
                <Input
                  type="number"
                  value={formData.idade_meses}
                  onChange={(e) => handleChange('idade_meses', e.target.value)}
                  placeholder="0"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Peso (kg)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.peso_kg}
                  onChange={(e) => handleChange('peso_kg', e.target.value)}
                  placeholder="0.00"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Data Nascimento</Label>
                <Input
                  type="date"
                  value={formData.data_nascimento}
                  onChange={(e) => handleChange('data_nascimento', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Raça</Label>
                <Input
                  value={formData.raca}
                  onChange={(e) => handleChange('raca', e.target.value)}
                  placeholder="RAÇA"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Lote</Label>
                <Input
                  value={formData.lote}
                  onChange={(e) => handleChange('lote', e.target.value)}
                  placeholder="LOTE"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Origem</Label>
                <Input
                  value={formData.origem}
                  onChange={(e) => handleChange('origem', e.target.value)}
                  placeholder="ORIGEM"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Sistema Produtivo</Label>
                <Select value={formData.sistema_produtivo} onValueChange={(v) => handleChange('sistema_produtivo', v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cria" className="text-xs">Cria</SelectItem>
                    <SelectItem value="Recria" className="text-xs">Recria</SelectItem>
                    <SelectItem value="Engorda" className="text-xs">Engorda</SelectItem>
                    <SelectItem value="Ciclo Completo" className="text-xs">Ciclo Completo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Área Atual</Label>
                <Select value={formData.area_atual_id} onValueChange={(v) => handleChange('area_atual_id', v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione uma área" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((area) => (
                      <SelectItem key={area.id} value={area.id} className="text-xs">
                        {area.nome} ({area.quantidade_atual || 0}/{area.capacidade_maxima} animais)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="OBSERVAÇÕES..."
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}