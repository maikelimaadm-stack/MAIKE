import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const CATEGORIAS = [
  "Bezerro", "Bezerro Desmamado", "Novilho", "Novilha",
  "Vaca", "Touro", "Garrote", "Matrizes", "Reprodutores"
];

const SISTEMAS = ["Cria", "Recria", "Engorda", "Ciclo Completo"];

export default function FormularioLote({ onSubmit, onCancel, initialData }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const [formData, setFormData] = useState(initialData || {
    nome: "",
    quantidade_cabecas: "",
    categoria: "",
    sexo: "",
    peso_medio_kg: "",
    idade_media_meses: "",
    area_atual_id: "",
    raca_predominante: "",
    sistema_produtivo: "",
    data_entrada: "",
    origem: "",
    valor_total_compra: "",
    valor_por_cabeca: "",
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

  const handleChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    
    // Calcular valor por cabeça automaticamente
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
    
    const area = areas.find(a => a.id === formData.area_atual_id);
    const dataToSave = {
      ...formData,
      nome: formData.nome.toUpperCase(),
      area_atual_nome: area?.nome || '',
      origem: formData.origem?.toUpperCase(),
      observacoes: formData.observacoes?.toUpperCase(),
      quantidade_cabecas: parseInt(formData.quantidade_cabecas) || 0,
      peso_medio_kg: parseFloat(formData.peso_medio_kg) || 0,
      idade_media_meses: parseInt(formData.idade_media_meses) || 0,
      valor_total_compra: parseFloat(formData.valor_total_compra) || 0,
      valor_por_cabeca: parseFloat(formData.valor_por_cabeca) || 0
    };

    onSubmit(dataToSave);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">
            {initialData ? 'Editar Lote' : 'Cadastrar Novo Lote'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome do Lote *</Label>
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange('nome', e.target.value)}
                  placeholder="LOTE 01, ENGORDA A..."
                  className="h-8 text-xs uppercase"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Quantidade de Cabeças *</Label>
                <Input
                  type="number"
                  value={formData.quantidade_cabecas}
                  onChange={(e) => handleChange('quantidade_cabecas', e.target.value)}
                  placeholder="50"
                  className="h-8 text-xs"
                  required
                  min="1"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Categoria *</Label>
                <Select value={formData.categoria} onValueChange={(v) => handleChange('categoria', v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map(cat => (
                      <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sexo</Label>
                <Select value={formData.sexo} onValueChange={(v) => handleChange('sexo', v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                    <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                    <SelectItem value="Misto" className="text-xs">Misto</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Peso Médio (kg)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.peso_medio_kg}
                  onChange={(e) => handleChange('peso_medio_kg', e.target.value)}
                  placeholder="0.0"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Idade Média (meses)</Label>
                <Input
                  type="number"
                  value={formData.idade_media_meses}
                  onChange={(e) => handleChange('idade_media_meses', e.target.value)}
                  placeholder="0"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Área/Piquete Atual</Label>
                <Select value={formData.area_atual_id} onValueChange={(v) => handleChange('area_atual_id', v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map(area => (
                      <SelectItem key={area.id} value={area.id} className="text-xs">
                        {area.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Raça Predominante</Label>
                <Input
                  value={formData.raca_predominante}
                  onChange={(e) => handleChange('raca_predominante', e.target.value)}
                  placeholder="NELORE, ANGUS..."
                  className="h-8 text-xs uppercase"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sistema Produtivo</Label>
                <Select value={formData.sistema_produtivo} onValueChange={(v) => handleChange('sistema_produtivo', v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {SISTEMAS.map(sys => (
                      <SelectItem key={sys} value={sys} className="text-xs">{sys}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Data de Entrada</Label>
                <Input
                  type="date"
                  value={formData.data_entrada}
                  onChange={(e) => handleChange('data_entrada', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Origem</Label>
                <Input
                  value={formData.origem}
                  onChange={(e) => handleChange('origem', e.target.value)}
                  placeholder="COMPRA, NASCIMENTO..."
                  className="h-8 text-xs uppercase"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Valor Total (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.valor_total_compra}
                  onChange={(e) => handleChange('valor_total_compra', e.target.value)}
                  placeholder="0.00"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Valor por Cabeça (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.valor_por_cabeca}
                  onChange={(e) => handleChange('valor_por_cabeca', e.target.value)}
                  placeholder="0.00"
                  className="h-8 text-xs"
                  disabled={formData.quantidade_cabecas && formData.valor_total_compra}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="OBSERVAÇÕES SOBRE O LOTE..."
                className="text-xs uppercase"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                <X className="w-3 h-3 mr-1" />
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                <Save className="w-3 h-3 mr-1" />
                Salvar Lote
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}