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
import CapturaGPSPoligono from "./CapturaGPSPoligono";

const TIPOS_LINHA = ["Estrada", "Cerca", "Cerca Elétrica", "Rio", "Córrego", "Outro"];

const CORES_DISPONIVEIS = [
  "#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
];

export default function FormularioLinha({ coordenadas, onSave, onCancel, usarGPS = false }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas);
  
  const [formData, setFormData] = useState({
    nome: "",
    sigla: "",
    tipo: "Estrada",
    cor: CORES_DISPONIVEIS[0],
    observacoes: ""
  });

  const handleCapturaGPS = (pontos) => {
    setCoordenadasGPS(pontos);
    setMostrarCapturaGPS(false);
    toast.success(`${pontos.length} pontos capturados via GPS!`);
  };

  const createLinhaMutation = useMutation({
    mutationFn: async (data) => {
      const allLinhas = await base44.entities.LinhaGeografica.list();
      const maxNum = allLinhas.reduce((max, l) => Math.max(max, parseInt(l.numero_linha) || 0), 0);
      
      // Calcular comprimento automaticamente
      const coords = coordenadasGPS || coordenadas;
      let comprimentoMetros = 0;
      if (window.google?.maps?.geometry && coords.length >= 2) {
        const path = coords.map(p => new google.maps.LatLng(p.lat, p.lng));
        comprimentoMetros = google.maps.geometry.spherical.computeLength(path);
      }

      return base44.entities.LinhaGeografica.create({
        nome: data.nome,
        sigla: data.sigla,
        tipo: data.tipo,
        observacoes: data.observacoes,
        empresa_id: empresaSelecionadaId,
        numero_linha: String(maxNum + 1),
        ativo: true,
        comprimento_metros: comprimentoMetros,
        coordenadas: {
          coords: coords.map(p => [p.lat, p.lng]),
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
      sigla: formData.sigla.toUpperCase(),
      tipo: formData.tipo,
      cor: formData.cor,
      observacoes: formData.observacoes?.toUpperCase()
    });
  };

  if (mostrarCapturaGPS) {
    return (
      <CapturaGPSPoligono
        tipo="linha"
        onSalvar={handleCapturaGPS}
        onCancelar={() => {
          setMostrarCapturaGPS(false);
          if (usarGPS) onCancel();
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700">Nome da Linha *</Label>
          <Input
            value={formData.nome}
            onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
            placeholder="ESTRADA PRINCIPAL, CERCA SUL..."
            className="h-9 text-xs uppercase"
            required
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700">Sigla</Label>
          <Input
            value={formData.sigla}
            onChange={(e) => setFormData({ ...formData, sigla: e.target.value })}
            placeholder="E1, CE01..."
            className="h-9 text-xs uppercase"
            maxLength={10}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Tipo *</Label>
        <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_LINHA.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Cor da Linha</Label>
        <div className="grid grid-cols-5 gap-2">
          {CORES_DISPONIVEIS.map(cor => (
            <button
              key={cor}
              type="button"
              onClick={() => setFormData({ ...formData, cor })}
              className={`w-full h-10 rounded-lg border-2 transition-all ${formData.cor === cor ? 'border-slate-900 scale-110 shadow-md' : 'border-slate-300 hover:border-slate-400'}`}
              style={{ backgroundColor: cor }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Observações</Label>
        <Textarea
          value={formData.observacoes}
          onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
          placeholder="OBSERVAÇÕES..."
          className="text-xs uppercase"
          rows={3}
        />
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t mt-4">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-9 text-xs gap-1.5">
          <X className="w-3.5 h-3.5" />
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="h-9 text-xs bg-slate-700 hover:bg-slate-800 gap-1.5">
          <Save className="w-3.5 h-3.5" />
          Salvar Linha
        </Button>
      </div>
    </form>
  );
}