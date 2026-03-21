import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import CapturaGPSPoligono from "./CapturaGPSPoligono";

const TIPOS_LINHA = ["Estrada", "Cerca", "Cerca Elétrica", "Rio", "Córrego", "Outro"];
const CORES_DISPONIVEIS = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

export default function FormularioLinha({ coordenadas, onSave, onCancel, usarGPS = false, item = null }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas);
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState({
    nome: item?.nome || "",
    sigla: item?.sigla || "",
    tipo: item?.tipo || "Estrada",
    cor: item?.coordenadas?.cor || CORES_DISPONIVEIS[0],
    observacoes: item?.observacoes || "",
  });

  const getFieldClassName = (field, baseClass = "") => `${baseClass} ${invalidFields.includes(field) ? 'border-red-500 bg-red-50 focus-visible:ring-red-500' : ''}`.trim();
  const handleChange = (field, value) => { setFormData((prev) => ({ ...prev, [field]: value })); setInvalidFields((prev) => prev.filter((item) => item !== field)); };

  const createLinhaMutation = useMutation({
    mutationFn: async (data) => {
      if (item) {
        return base44.entities.LinhaGeografica.update(item.id, {
          ...data,
          coordenadas: {
            coords: (coordenadasGPS || coordenadas || item.coordenadas?.coords)?.map((p) => [p.lat || p[0], p.lng || p[1]]),
            cor: data.cor,
          },
        });
      }

      const allLinhas = await base44.entities.LinhaGeografica.list();
      const maxNum = allLinhas.reduce((max, l) => Math.max(max, parseInt(l.numero_linha) || 0), 0);
      const coords = coordenadasGPS || coordenadas;
      let comprimentoMetros = 0;
      if (window.google?.maps?.geometry && coords.length >= 2) {
        const path = coords.map((p) => new google.maps.LatLng(p.lat, p.lng));
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
          coords: coords.map((p) => [p.lat, p.lng]),
          cor: data.cor,
        },
      });
    },
    onSuccess: () => { toast.success(item ? 'Linha atualizada!' : 'Linha cadastrada!'); onSave(); },
    onError: () => { toast.error(item ? 'Erro ao atualizar linha' : 'Erro ao cadastrar linha'); },
  });

  const handleCapturaGPS = (pontos) => { setCoordenadasGPS(pontos); setMostrarCapturaGPS(false); toast.success(`${pontos.length} pontos capturados via GPS!`); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome?.trim()) { setInvalidFields(['nome']); toast.error('Preencha o nome da linha.'); return; }
    createLinhaMutation.mutate({ nome: formData.nome.toUpperCase(), sigla: formData.sigla.toUpperCase(), tipo: formData.tipo, cor: formData.cor, observacoes: formData.observacoes?.toUpperCase() });
  };

  if (mostrarCapturaGPS) {
    return <CapturaGPSPoligono tipo="linha" onSalvar={handleCapturaGPS} onCancelar={() => { setMostrarCapturaGPS(false); if (usarGPS) onCancel(); }} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1 mt-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
        <div className="space-y-1 lg:col-span-2"><Label className="text-xs">Nome da Linha *</Label><Input value={formData.nome} onChange={(e) => handleChange('nome', e.target.value)} placeholder="NOME DA LINHA" className={getFieldClassName('nome', 'h-8 text-xs uppercase')} style={{ textTransform: 'uppercase' }} /></div>
        <div className="space-y-1"><Label className="text-xs">Sigla</Label><Input value={formData.sigla} onChange={(e) => handleChange('sigla', e.target.value)} placeholder="SIGLA" className="h-8 text-xs uppercase" maxLength={10} /></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
        <div className="space-y-1"><Label className="text-xs">Tipo *</Label><Select value={formData.tipo} onValueChange={(v) => handleChange('tipo', v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{TIPOS_LINHA.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-3 space-y-1"><div><span className="font-semibold text-sm text-slate-700">Cor da Linha</span></div><div className="grid grid-cols-5 gap-2">{CORES_DISPONIVEIS.map((cor) => <button key={cor} type="button" onClick={() => handleChange('cor', cor)} className={`w-full h-8 rounded border ${formData.cor === cor ? 'ring-2 ring-slate-900' : ''}`} style={{ backgroundColor: cor }} />)}</div></div>
      <div className="space-y-1 pt-1"><Label className="text-xs">Observações</Label><Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} className="text-xs uppercase" rows={2} /></div>
      <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t"><Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button><Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">{item ? 'Salvar alterações' : 'Salvar linha'}</Button></div>
    </form>
  );
}