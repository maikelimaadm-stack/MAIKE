import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Save } from "lucide-react";

export default function FormularioPesagem({ lote, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    data_pesagem: new Date().toISOString().split('T')[0],
    peso_medio: lote.peso_medio_kg || "",
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.peso_medio || formData.peso_medio <= 0) {
      alert("Informe o peso médio");
      return;
    }
    onSubmit(formData);
  };

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Registrar Pesagem - {lote.nome}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="bg-slate-50 border rounded p-3 mb-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-600">Quantidade:</div>
                <div className="text-sm font-semibold text-slate-900">{lote.quantidade_cabecas} cabeças</div>
              </div>
              <div>
                <div className="text-xs text-slate-600">Peso Anterior:</div>
                <div className="text-sm font-semibold text-slate-900">
                  {lote.peso_medio_kg ? `${lote.peso_medio_kg} kg` : '-'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data da Pesagem *</Label>
              <Input
                type="date"
                value={formData.data_pesagem}
                onChange={(e) => setFormData({ ...formData, data_pesagem: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Peso Médio (kg) *</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={formData.peso_medio}
                onChange={(e) => setFormData({ ...formData, peso_medio: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>
          </div>

          {lote.peso_medio_kg && formData.peso_medio && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <div className="text-xs text-blue-900 mb-1">Informações Calculadas:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-blue-700">Ganho:</span>{" "}
                  <span className="font-semibold">
                    {(parseFloat(formData.peso_medio) - lote.peso_medio_kg).toFixed(1)} kg
                  </span>
                </div>
                <div>
                  <span className="text-blue-700">Variação:</span>{" "}
                  <span className="font-semibold">
                    {((parseFloat(formData.peso_medio) - lote.peso_medio_kg) / lote.peso_medio_kg * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              rows={3}
              placeholder="Condições da pesagem, observações gerais..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              <X className="w-3 h-3 mr-1" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Save className="w-3 h-3 mr-1" />
              Registrar Pesagem
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}