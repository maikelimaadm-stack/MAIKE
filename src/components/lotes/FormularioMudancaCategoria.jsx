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
  const [formData, setFormData] = useState({
    data_mudanca: new Date().toISOString().split('T')[0],
    categoria_nova: "",
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.categoria_nova) {
      alert("Selecione a nova categoria");
      return;
    }
    onSubmit(formData);
  };

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Mudança de Categoria - {lote.nome}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="bg-slate-50 border rounded p-3 mb-3">
            <div className="text-xs text-slate-600 mb-1">Categoria Atual:</div>
            <div className="text-sm font-semibold text-slate-900">{lote.categoria}</div>
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
                {CATEGORIAS.filter(c => c !== lote.categoria).map(cat => (
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