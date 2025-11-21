import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Save } from "lucide-react";

export default function FormularioNascimento({ lote, onSubmit, onCancel }) {
  const lotesArray = Array.isArray(lote) ? lote : [lote];
  
  // Filtrar apenas fêmeas acima de 13 meses
  const categoriasFemeas = [...new Set(
    lotesArray
      .filter(l => {
        const cat = l.categoria || "";
        return cat.toLowerCase().includes('fêmea') || 
               cat.toLowerCase().includes('vaca') || 
               cat.toLowerCase().includes('novilha');
      })
      .filter(l => {
        const cat = l.categoria || "";
        return !cat.includes('0 a 12 meses'); // Excluir bezerras
      })
      .map(l => l.categoria)
      .filter(Boolean)
  )];

  const [formData, setFormData] = useState({
    data_nascimento: new Date().toISOString().split('T')[0],
    categoria_mae: categoriasFemeas[0] || "",
    quantidade: 1,
    sexo: "",
    peso_medio: "",
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (categoriasFemeas.length === 0) {
      alert("Não há categorias de fêmeas aptas para dar nascimento (acima de 13 meses)");
      return;
    }
    onSubmit(formData);
  };

  const nomeExibicao = lotesArray.map(l => l.nome).join(' - ');

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Registrar Nascimento - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {categoriasFemeas.length === 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-800">
              ⚠️ Não há categorias de fêmeas aptas para dar nascimento. Apenas fêmeas acima de 13 meses podem ter nascimentos.
            </div>
          )}

          {categoriasFemeas.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Categoria da Mãe *</Label>
              <Select
                value={formData.categoria_mae}
                onValueChange={(v) => setFormData({ ...formData, categoria_mae: v })}
                required
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {categoriasFemeas.map(cat => (
                    <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data do Nascimento *</Label>
              <Input
                type="date"
                value={formData.data_nascimento}
                onChange={(e) => setFormData({ ...formData, data_nascimento: e.target.value })}
                className="h-8 text-xs"
                required
                disabled={categoriasFemeas.length === 0}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Quantidade *</Label>
              <Input
                type="number"
                min="1"
                value={formData.quantidade}
                onChange={(e) => setFormData({ ...formData, quantidade: parseInt(e.target.value) || 0 })}
                className="h-8 text-xs"
                required
                disabled={categoriasFemeas.length === 0}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Sexo *</Label>
              <Select
                value={formData.sexo}
                onValueChange={(v) => setFormData({ ...formData, sexo: v })}
                required
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                  <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Peso Médio (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_medio}
                onChange={(e) => setFormData({ ...formData, peso_medio: e.target.value })}
                className="h-8 text-xs"
                placeholder="Peso ao nascer"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              rows={3}
              placeholder="Informações adicionais..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              <X className="w-3 h-3 mr-1" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Save className="w-3 h-3 mr-1" />
              Registrar Nascimento
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}