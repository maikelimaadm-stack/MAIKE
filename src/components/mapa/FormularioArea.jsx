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
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <div className="space-y-1">
        <Label className="text-sm text-slate-700">nome de Pasto</Label>
        <Input
          value={formData.nome}
          onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
          placeholder="Pasto 1"
          className="h-10 text-sm bg-slate-50 border-slate-200"
          required
        />
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Área total *</Label>
        <div className="relative">
          <Input
            type="text"
            value={formData.area_total}
            onChange={(e) => setFormData({ ...formData, area_total: e.target.value })}
            placeholder="0,00"
            className="h-10 text-sm bg-slate-50 border-slate-200 pr-10"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">ha</span>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Área pastejada ou arável *</Label>
        <div className="relative">
          <Input
            type="text"
            value={formData.area_pastejada}
            onChange={(e) => setFormData({ ...formData, area_pastejada: e.target.value })}
            placeholder="0,00"
            className="h-10 text-sm bg-slate-50 border-slate-200 pr-10"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">ha</span>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Aproveitamento da área *</Label>
        <p className="text-xs text-slate-500">O conjunto de terra como pastejo será incluído em sua taxa de lotação</p>
        <Select value={formData.aproveitamento} onValueChange={(v) => setFormData({ ...formData, aproveitamento: v })}>
          <SelectTrigger className="h-10 text-sm bg-slate-50 border-slate-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_USO.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-sm">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-sm text-slate-700">Tipo de cultura *</Label>
          <Button type="button" variant="default" size="sm" className="h-8 text-xs bg-[#61aad9] hover:bg-[#0d67ad]">
            Adicionar tipo de cultura
          </Button>
        </div>
        <Select value={formData.tipo_cultura} onValueChange={(v) => setFormData({ ...formData, tipo_cultura: v })}>
          <SelectTrigger className="h-10 text-sm bg-slate-50 border-slate-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_CULTURA.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-sm">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Cor no mapa *</Label>
        <Select value={formData.cor} onValueChange={(v) => setFormData({ ...formData, cor: v })}>
          <SelectTrigger className="h-10 text-sm bg-slate-50 border-slate-200">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: formData.cor }} />
              <span>{CORES_DISPONIVEIS.find(c => c.cor === formData.cor)?.nome || 'Selecione'}</span>
            </div>
          </SelectTrigger>
          <SelectContent>
            {CORES_DISPONIVEIS.map(c => (
              <SelectItem key={c.cor} value={c.cor} className="text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: c.cor }} />
                  <span>{c.nome}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Descrição</Label>
        <Textarea
          value={formData.observacoes}
          onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
          placeholder=""
          className="text-sm bg-slate-50 border-slate-200"
          rows={4}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 bg-slate-100 -mx-6 px-6 py-3 -mb-6 mt-6">
        <Button type="button" variant="outline" onClick={onCancel} className="h-9 px-4 text-sm text-[#61aad9] border-[#61aad9] hover:bg-[#61aad9]/10">
          Cancelar
        </Button>
        <Button type="submit" className="h-9 px-6 text-sm bg-[#92ca25] hover:bg-[#7ab31f] text-white">
          Salvar
        </Button>
      </div>
    </form>
  );
}