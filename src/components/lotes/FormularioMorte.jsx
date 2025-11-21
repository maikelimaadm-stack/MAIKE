import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Save } from "lucide-react";

export default function FormularioMorte({ lote, onSubmit, onCancel }) {
  const categorias = Array.isArray(lote) 
    ? [...new Set(lote.map(l => l.categoria).filter(Boolean))]
    : [lote.categoria].filter(Boolean);

  const [formData, setFormData] = useState({
    data_ocorrencia: new Date().toISOString().split('T')[0],
    categoria: categorias[0] || "",
    quantidade: 1,
    causa_morte: "",
    observacoes: ""
  });

  const lotesCategoria = Array.isArray(lote)
    ? lote.filter(l => l.categoria === formData.categoria)
    : [lote];
  const quantidadeMaxima = lotesCategoria.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const nomeExibicao = Array.isArray(lote) 
    ? lote.map(l => l.nome).join(' - ')
    : lote.nome;

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Registrar Morte - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {categorias.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Categoria *</Label>
              <Select
                value={formData.categoria}
                onValueChange={(v) => setFormData({ ...formData, categoria: v, quantidade: 1 })}
                required
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map(cat => (
                    <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data da Ocorrência *</Label>
              <Input
                type="date"
                value={formData.data_ocorrencia}
                onChange={(e) => setFormData({ ...formData, data_ocorrencia: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Quantidade de Animais *</Label>
              <Input
                type="number"
                min="1"
                max={quantidadeMaxima}
                value={formData.quantidade}
                onChange={(e) => setFormData({ ...formData, quantidade: parseInt(e.target.value) || 0 })}
                className="h-8 text-xs"
                required
              />
              <span className="text-[10px] text-slate-500">Máximo: {quantidadeMaxima}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Causa da Morte</Label>
            <Select
              value={formData.causa_morte}
              onValueChange={(v) => setFormData({ ...formData, causa_morte: v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Selecione a causa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Doença" className="text-xs">Doença</SelectItem>
                <SelectItem value="Acidente" className="text-xs">Acidente</SelectItem>
                <SelectItem value="Predador" className="text-xs">Predador</SelectItem>
                <SelectItem value="Natural" className="text-xs">Natural</SelectItem>
                <SelectItem value="Desconhecida" className="text-xs">Desconhecida</SelectItem>
                <SelectItem value="Outra" className="text-xs">Outra</SelectItem>
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
              placeholder="Detalhes sobre a ocorrência..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              <X className="w-3 h-3 mr-1" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-red-600 hover:bg-red-700">
              <Save className="w-3 h-3 mr-1" />
              Registrar Morte
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}