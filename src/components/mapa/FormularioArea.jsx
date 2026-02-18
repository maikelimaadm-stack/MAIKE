import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X, Plus } from "lucide-react";
import { toast } from "sonner";
import CapturaGPSPoligono from "./CapturaGPSPoligono";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TIPOS_USO = ["Alta", "Média", "Baixa"];

const TIPOS_CULTURA_FIXAS = [
  "Pastagem", "Agricultura", "Reserva", "APP", "Infraestrutura"
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

export default function FormularioArea({ coordenadas, onSave, onCancel, usarGPS = false, item }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas);

  
  // Tipos de cultura fixos definidos no sistema
  const tiposCultura = TIPOS_CULTURA_FIXAS;

  const [formData, setFormData] = useState({
    nome: item?.nome || "",
    sigla: item?.sigla || "",
    numero_area: item?.numero_area || "",
    area_total: item?.tamanho_hectares?.toString() || "",
    area_pastejada: item?.area_pastejada?.toString() || "",
    aproveitamento: item?.aproveitamento_classificacao || "Média",
    tipo_cultura: item?.tipo_cultura || "Pastagem",
    tipo_pastagem: item?.tipo_pastagem || "",
    cor: item?.cor || item?.coordenadas?.cor || CORES_DISPONIVEIS[4].cor,
    observacoes: item?.observacoes || ""
  });



  const createAreaMutation = useMutation({
    mutationFn: async (data) => {
      if (item) {
        // Modo edição
        return base44.entities.AreaPastagem.update(item.id, {
          ...data,
          numero_area: data.numero_area || item.numero_area,
          coordenadas: {
            coords: (coordenadasGPS || coordenadas || item.coordenadas?.coords)?.map(p => [p.lat || p[0], p.lng || p[1]]),
            cor: data.cor
          }
        });
      } else {
        // Modo criação
        const allAreas = await base44.entities.AreaPastagem.list();
        const maxNum = allAreas.reduce((max, a) => Math.max(max, parseInt(a.numero_area) || 0), 0);
        const proximo = String(maxNum + 1);
        
        return base44.entities.AreaPastagem.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_area: (data.numero_area && String(data.numero_area)) || proximo,
          quantidade_atual: 0,
          status_ocupacao: 'Disponível',
          ativo: true,
          coordenadas: {
            coords: (coordenadasGPS || coordenadas)?.map(p => [p.lat, p.lng]),
            cor: data.cor
          }
        });
      }
    },
    onSuccess: () => {
      toast.success(item ? '✅ Área atualizada!' : '✅ Área cadastrada!');
      onSave();
    },
    onError: () => {
      toast.error(item ? '❌ Erro ao atualizar área' : '❌ Erro ao cadastrar área');
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
      nome: formData.nome,
      sigla: formData.sigla,
      numero_area: formData.numero_area?.toString().trim() || undefined,
      aproveitamento_classificacao: formData.aproveitamento,
      tipo_cultura: formData.tipo_cultura,
      tipo_pastagem: formData.tipo_pastagem,
      tamanho_hectares: parseFloat(formData.area_total?.replace(',', '.')) || tamanhoHectares,
      area_pastejada: parseFloat(formData.area_pastejada?.replace(',', '.')) || 0,
      observacoes: formData.observacoes,
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
        <Label className="text-sm text-slate-700">Nome do Pasto *</Label>
        <Input
          value={formData.nome}
          onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
          placeholder="Pasto 1"
          className="h-10 text-sm bg-slate-50 border-slate-200"
          required
        />
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Sigla *</Label>
        <Input
          value={formData.sigla}
          onChange={(e) => setFormData({ ...formData, sigla: e.target.value.toUpperCase() })}
          placeholder="Ex: A1, PQ01"
          className="h-10 text-sm bg-slate-50 border-slate-200"
          maxLength={10}
        />
        <p className="text-xs text-slate-500">Sigla que aparecerá no mapa</p>
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Número/Código</Label>
        <Input
          value={formData.numero_area}
          onChange={(e) => setFormData({ ...formData, numero_area: e.target.value.replace(/[^0-9]/g, '') })}
          placeholder="Automático se vazio"
          className="h-10 text-sm bg-slate-50 border-slate-200"
          inputMode="numeric"
        />
        <p className="text-xs text-slate-500">Deixe em branco para gerar automaticamente</p>
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
        <Select value={formData.aproveitamento} onValueChange={(v) => setFormData({ ...formData, aproveitamento: v })}>
          <SelectTrigger className="h-10 text-sm bg-slate-50 border-slate-200">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_USO.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-sm">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Tipo de cultura *</Label>
        <Select value={formData.tipo_cultura} onValueChange={(v) => setFormData({ ...formData, tipo_cultura: v })}>
          <SelectTrigger className="h-10 text-sm bg-slate-50 border-slate-200">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {tiposCultura.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-sm">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-sm text-slate-700">Tipo de uso</Label>
        <Input
          value={formData.tipo_pastagem}
          onChange={(e) => setFormData({ ...formData, tipo_pastagem: e.target.value })}
          placeholder="Ex: Brachiaria, Tifton, Reserva"
          className="h-10 text-sm bg-slate-50 border-slate-200"
        />
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

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
          Salvar
        </Button>
      </div>
    </form>
  );
}