import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X } from "lucide-react";
import { toast } from "sonner";

const TIPOS_USO = [
  "Pasto/Piquete", "Lavoura", "Reserva Legal", "APP", 
  "Curral", "Sede", "Retiro", "Módulo", "Talhão", "Outro"
];

const CORES_DISPONIVEIS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
];

export default function FormularioArea({ coordenadas, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  
  const [formData, setFormData] = useState({
    nome: "",
    tipo_pastagem: "Pasto/Piquete",
    area_total: "",
    capacidade_maxima: "",
    cor: CORES_DISPONIVEIS[0],
    observacoes: ""
  });

  const createAreaMutation = useMutation({
    mutationFn: async (data) => {
      const allAreas = await base44.entities.AreaPastagem.list();
      const maxNum = allAreas.reduce((max, a) => Math.max(max, parseInt(a.numero_area) || 0), 0);
      
      // Calcular área automaticamente
      if (window.google?.maps?.geometry) {
        const polygon = new google.maps.Polygon({ paths: coordenadas });
        const areaM2 = google.maps.geometry.spherical.computeArea(polygon.getPath());
        const areaHa = (areaM2 / 10000).toFixed(2);
        data.tamanho_hectares = parseFloat(areaHa);
      }

      return base44.entities.AreaPastagem.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_area: String(maxNum + 1),
        quantidade_atual: 0,
        status_ocupacao: 'Disponível',
        ativo: true,
        coordenadas: {
          coords: coordenadas.map(p => [p.lat, p.lng]),
          cor: data.cor
        }
      });
    },
    onSuccess: () => {
      toast.success('✅ Área cadastrada!');
      onSave();
    },
    onError: () => {
      toast.error('❌ Erro ao cadastrar área');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome) {
      toast.error('Preencha o nome da área!');
      return;
    }
    createAreaMutation.mutate({
      nome: formData.nome.toUpperCase(),
      tipo_pastagem: formData.tipo_pastagem,
      capacidade_maxima: parseFloat(formData.capacidade_maxima) || 0,
      observacoes: formData.observacoes?.toUpperCase(),
      cor: formData.cor
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <div className="space-y-1">
        <Label className="text-xs">Nome da Área *</Label>
        <Input
          value={formData.nome}
          onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
          placeholder="PIQUETE 01, LAVOURA A..."
          className="h-8 text-xs uppercase"
          required
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Tipo de Uso *</Label>
        <Select value={formData.tipo_pastagem} onValueChange={(v) => setFormData({ ...formData, tipo_pastagem: v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_USO.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Capacidade (UA)</Label>
        <Input
          type="number"
          value={formData.capacidade_maxima}
          onChange={(e) => setFormData({ ...formData, capacidade_maxima: e.target.value })}
          placeholder="0"
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Cor da Área</Label>
        <div className="grid grid-cols-5 gap-2">
          {CORES_DISPONIVEIS.map(cor => (
            <button
              key={cor}
              type="button"
              onClick={() => setFormData({ ...formData, cor })}
              className={`w-full h-10 rounded border-2 transition-all ${formData.cor === cor ? 'border-slate-900 scale-110' : 'border-slate-200'}`}
              style={{ backgroundColor: cor }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Observações</Label>
        <Textarea
          value={formData.observacoes}
          onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
          placeholder="OBSERVAÇÕES..."
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
          Salvar Área
        </Button>
      </div>
    </form>
  );
}