import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Save } from "lucide-react";

const CATEGORIAS = [
  "Bezerro 0 a 12 meses",
  "Bezerra 0 a 12 meses",
  "Garrote 13 a 24 meses",
  "Novilha 13 a 24 meses",
  "Boi 25 a 36 meses",
  "Vaca 25 a 36 meses",
  "Touro + 36 meses",
  "Vaca + 36 meses"
];

export default function FormularioMudancaCategoria({ lote, onSubmit, onCancel }) {
  const lotesArray = Array.isArray(lote) ? lote : [lote];
  const categoriasAtuais = [...new Set(lotesArray.map(l => l.categoria).filter(Boolean))];

  const [formData, setFormData] = useState({
    data_mudanca: new Date().toISOString().split('T')[0],
    categorias_selecionadas: categoriasAtuais.length === 1 ? [categoriasAtuais[0]] : [],
    categoria_nova: "",
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formData.categorias_selecionadas.length === 0) {
      alert("Selecione pelo menos uma categoria");
      return;
    }
    if (!formData.categoria_nova) {
      alert("Selecione a nova categoria");
      return;
    }
    onSubmit(formData);
  };

  const toggleCategoria = (cat) => {
    const atual = formData.categorias_selecionadas;
    if (atual.includes(cat)) {
      setFormData({ ...formData, categorias_selecionadas: atual.filter(c => c !== cat) });
    } else {
      setFormData({ ...formData, categorias_selecionadas: [...atual, cat] });
    }
  };

  const nomeExibicao = lotesArray.map(l => l.nome).join(' - ');

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Mudança de Categoria - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="bg-slate-50 border rounded p-3 mb-3">
            <div className="text-xs text-slate-600 mb-2">Categorias Atuais - Selecione quais deseja mudar:</div>
            <div className="flex flex-wrap gap-2">
              {categoriasAtuais.map(cat => {
                const isSelected = formData.categorias_selecionadas.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategoria(cat)}
                    className={`px-3 py-1 text-xs rounded border transition-all ${
                      isSelected 
                        ? 'bg-emerald-600 text-white border-emerald-600' 
                        : 'bg-white text-slate-700 border-slate-300 hover:border-emerald-600'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Data da Mudança *</Label>
            <Input
              type="date"
              value={formData.data_mudanca}
              onChange={(e) => setFormData({ ...formData, data_mudanca: e.target.value })}
              className="h-8 text-xs"
              required
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Nova Categoria *</Label>
            <Select
              value={formData.categoria_nova}
              onValueChange={(v) => setFormData({ ...formData, categoria_nova: v })}
              required
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Selecione a nova categoria" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIAS.map(cat => (
                  <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              rows={3}
              placeholder="Motivo da mudança de categoria..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              <X className="w-3 h-3 mr-1" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700">
              <Save className="w-3 h-3 mr-1" />
              Confirmar Mudança
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}