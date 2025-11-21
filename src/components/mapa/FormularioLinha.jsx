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

const TIPOS_LINHA = ["Estrada", "Cerca", "Cerca Elétrica", "Rio", "Córrego", "Outro"];

const CORES_DISPONIVEIS = [
  "#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
];

export default function FormularioLinha({ coordenadas, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "Estrada",
    cor: CORES_DISPONIVEIS[0],
    observacoes: ""
  });

  const createLinhaMutation = useMutation({
    mutationFn: async (data) => {
      const allLinhas = await base44.entities.LinhaGeografica.list();
      const maxNum = allLinhas.reduce((max, l) => Math.max(max, parseInt(l.numero_linha) || 0), 0);
      
      // Calcular comprimento automaticamente
      let comprimentoMetros = 0;
      if (window.google?.maps?.geometry && coordenadas.length >= 2) {
        const path = coordenadas.map(p => new google.maps.LatLng(p.lat, p.lng));
        comprimentoMetros = google.maps.geometry.spherical.computeLength(path);
      }

      return base44.entities.LinhaGeografica.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_linha: String(maxNum + 1),
        ativo: true,
        comprimento_metros: comprimentoMetros,
        coordenadas: {
          coords: coordenadas.map(p => [p.lat, p.lng]),
          cor: data.cor
        }
      });
    },
    onSuccess: () => {
      toast.success('✅ Linha cadastrada!');
      onSave();
    },
    onError: () => {
      toast.error('❌ Erro ao cadastrar linha');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome) {
      toast.error('Preencha o nome da linha!');
      return;
    }
    createLinhaMutation.mutate({
      nome: formData.nome.toUpperCase(),
      tipo: formData.tipo,
      cor: formData.cor,
      observacoes: formData.observacoes?.toUpperCase()
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <div className="space-y-1">
        <Label className="text-xs">Nome da Linha *</Label>
        <Input
          value={formData.nome}
          onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
          placeholder="ESTRADA PRINCIPAL, CERCA SUL..."
          className="h-8 text-xs uppercase"
          required
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Tipo *</Label>
        <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_LINHA.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Cor da Linha</Label>
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
        <Button type="submit" size="sm" className="h-8 text-xs bg-orange-600 hover:bg-orange-700">
          <Save className="w-3 h-3 mr-1" />
          Salvar Linha
        </Button>
      </div>
    </form>
  );
}