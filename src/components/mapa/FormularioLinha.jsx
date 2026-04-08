import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import CapturaGPSPoligono from "./CapturaGPSPoligono";

const FL = ({ label, required, error, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

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
    <div className="mt-4">
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm border-slate-300">
        <div className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <div className="text-sm font-semibold text-slate-900">{item ? 'Editar Linha' : 'Nova Linha'}</div>
        </div>
        <div className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
        <div className="lg:col-span-2"><FL label="Nome da Linha" required error={invalidFields.includes('nome')}><Input value={formData.nome} onChange={(e) => handleChange('nome', e.target.value)} placeholder="NOME DA LINHA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: 'uppercase' }} /></FL></div>
        <FL label="Sigla"><Input value={formData.sigla} onChange={(e) => handleChange('sigla', e.target.value)} placeholder="SIGLA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" maxLength={10} /></FL>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
        <FL label="Tipo" required><Select value={formData.tipo} onValueChange={(v) => handleChange('tipo', v)}><SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger><SelectContent>{TIPOS_LINHA.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent></Select></FL>
      </div>
      <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-3 space-y-1"><span className="font-semibold text-xs text-slate-700">Cor da Linha</span><div className="grid grid-cols-5 gap-2">{CORES_DISPONIVEIS.map((cor) => <button key={cor} type="button" onClick={() => handleChange('cor', cor)} className={`w-full h-7 rounded border ${formData.cor === cor ? 'ring-2 ring-slate-900' : ''}`} style={{ backgroundColor: cor }} />)}</div></div>
      <FL label="Observações"><Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" rows={2} /></FL>
      <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t"><Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button><Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{item ? 'Salvar alterações' : 'Salvar linha'}</Button></div>
          </form>
        </div>
      </div>
    </div>
  );
}