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

const TIPOS_USO = [
  "Pastejo", "Lavoura", "Reserva Legal", "APP", 
  "Curral", "Sede", "Retiro", "Módulo", "Talhão", "Outro"
];

const TIPOS_CULTURA = [
  "Aruana", "Mombaça", "Marandu", "Tifton", "Brachiaria", "Piatã", "Tanzânia", "Outro"
];

const CORES_DISPONIVEIS = [
  { nome: "Branco", cor: "#f8f9fa" },
  { nome: "Cinza claro", cor: "#d8dee2" },
  { nome: "Preto", cor: "#2c303e" },
  { nome: "Azul escuro", cor: "#0d67ad" },
  { nome: "Azul celeste", cor: "#61aad9" },
  { nome: "Amarelo", cor: "#efcb19" },
  { nome: "Verde claro", cor: "#92ca25" },
  { nome: "Laranja", cor: "#f5a01b" },
  { nome: "Roxo", cor: "#966fe1" }
];

export default function FormularioArea({ coordenadas, onSave, onCancel, usarGPS = false }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas);
  
  const [formData, setFormData] = useState({
    nome: "",
    area_total: "",
    area_pastejada: "",
    aproveitamento: "Pastejo",
    tipo_cultura: "Aruana",
    cor: CORES_DISPONIVEIS[4].cor,
    observacoes: ""
  });

  const createAreaMutation = useMutation({
    mutationFn: async (data) => {
      const allAreas = await base44.entities.AreaPastagem.list();
      const maxNum = allAreas.reduce((max, a) => Math.max(max, parseInt(a.numero_area) || 0), 0);
      
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

  const handleCapturaGPS = (pontos) => {
    setCoordenadasGPS(pontos);
    setMostrarCapturaGPS(false);
    toast.success(`${pontos.length} pontos capturados via GPS!`);
  };

  // Calcular área automaticamente quando o componente carrega
  React.useEffect(() => {
    const coords = coordenadasGPS || coordenadas;
    if (window.google?.maps?.geometry && coords && coords.length >= 3) {
      const polygon = new google.maps.Polygon({ 
        paths: coords.map(c => new google.maps.LatLng(c.lat, c.lng))
      });
      const areaM2 = google.maps.geometry.spherical.computeArea(polygon.getPath());
      const areaHa = (areaM2 / 10000).toFixed(2);
      setFormData(prev => ({ ...prev, area_total: areaHa }));
    }
  }, [coordenadasGPS, coordenadas]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome) {
      toast.error('Preencha o nome da área!');
      return;
    }
    // Calcular área
    const coords = coordenadasGPS || coordenadas;
    let tamanhoHectares = 0;
    if (window.google?.maps?.geometry && coords && coords.length >= 3) {
      const polygon = new google.maps.Polygon({ 
        paths: coords.map(c => new google.maps.LatLng(c.lat, c.lng))
      });
      const areaM2 = google.maps.geometry.spherical.computeArea(polygon.getPath());
      tamanhoHectares = parseFloat((areaM2 / 10000).toFixed(2));
    }

    createAreaMutation.mutate({
      nome: formData.nome.toUpperCase(),
      sigla: formData.sigla.toUpperCase(),
      tipo_pastagem: formData.tipo_pastagem,
      tamanho_hectares: tamanhoHectares,
      capacidade_maxima: parseFloat(formData.capacidade_maxima) || 0,
      observacoes: formData.observacoes?.toUpperCase(),
      cor: formData.cor
    });
  };

  if (mostrarCapturaGPS) {
    return (
      <CapturaGPSPoligono
        tipo="area"
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
          <Label className="text-xs font-semibold text-slate-700">Nome da Área *</Label>
          <Input
            value={formData.nome}
            onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
            placeholder="PIQUETE 01, LAVOURA A..."
            className="h-9 text-xs uppercase"
            required
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700">Sigla</Label>
          <Input
            value={formData.sigla}
            onChange={(e) => setFormData({ ...formData, sigla: e.target.value })}
            placeholder="A1, PQ01..."
            className="h-9 text-xs uppercase"
            maxLength={10}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Tipo de Uso *</Label>
        <Select value={formData.tipo_pastagem} onValueChange={(v) => setFormData({ ...formData, tipo_pastagem: v })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_USO.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {formData.area_total && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-xs text-slate-600 mb-1 font-medium">Área Calculada</div>
          <div className="text-2xl font-bold text-slate-900">{formData.area_total} ha</div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Capacidade (UA)</Label>
        <Input
          type="number"
          value={formData.capacidade_maxima}
          onChange={(e) => setFormData({ ...formData, capacidade_maxima: e.target.value })}
          placeholder="0"
          className="h-9 text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Cor da Área</Label>
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
          Salvar Área
        </Button>
      </div>
    </form>
  );
}