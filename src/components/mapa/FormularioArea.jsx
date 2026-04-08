import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import CapturaGPSPoligono from "./CapturaGPSPoligono";

const APROVEITAMENTO = ["Alta", "Média", "Baixa"];
const TIPOS_USO = ["Pastagem", "Agricultura", "Reserva", "APP", "Infraestrutura"];
const TIPOS_CULTURAS = [
  "Brachiaria", "Mombaça", "Tanzânia", "Tifton", "Piatã", "Marandu", "Panicum", "Elefante",
  "Milho", "Soja", "Sorgo", "Arroz", "Trigo", "Cevada", "Cana-de-açúcar", "Algodão",
  "Feijão", "Girassol", "Aveia", "Café", "Eucalipto", "Floresta", "Outros",
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
  { nome: "Roxo", cor: "#966fe1" },
];

export default function FormularioArea({ coordenadas, onSave, onCancel, usarGPS = false, item }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas);
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState({
    nome: item?.nome || "",
    sigla: item?.sigla || "",
    numero_area: item?.numero_area || "",
    setor_id: item?.setor_id || "",
    setor_nome: item?.setor_nome || "",
    area_total: item?.tamanho_hectares?.toString() || "",
    area_pastejada: item?.area_pastejada?.toString() || "",
    aproveitamento: item?.aproveitamento_classificacao || "Média",
    tipo_cultura: item?.tipo_cultura || "Pastagem",
    tipo_pastagem: item?.tipo_pastagem || "",
    cor: item?.cor || item?.coordenadas?.cor || CORES_DISPONIVEIS[4].cor,
    observacoes: item?.observacoes || "",
  });

  const { data: setores = [] } = useQuery({
    queryKey: ["setores-form-area", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all.filter((setor) => setor.empresa_id === empresaSelecionadaId && setor.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const getFieldClassName = (field, baseClass = "") => `${baseClass} ${invalidFields.includes(field) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
  const handleChange = (field, value) => { setFormData((prev) => ({ ...prev, [field]: value })); setInvalidFields((prev) => prev.filter((item) => item !== field)); };

  const createAreaMutation = useMutation({
    mutationFn: async (data) => {
      if (item) {
        return base44.entities.AreaPastagem.update(item.id, {
          ...data,
          numero_area: data.numero_area || item.numero_area,
          coordenadas: {
            coords: (coordenadasGPS || coordenadas || item.coordenadas?.coords)?.map((p) => [p.lat || p[0], p.lng || p[1]]),
            cor: data.cor,
          },
        });
      }
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
        coordenadas: { coords: (coordenadasGPS || coordenadas)?.map((p) => [p.lat, p.lng]), cor: data.cor },
      });
    },
    onSuccess: () => { toast.success(item ? "Área atualizada!" : "Área cadastrada!"); onSave(); },
    onError: () => { toast.error(item ? "Erro ao atualizar área" : "Erro ao cadastrar área"); },
  });

  const handleCapturaGPS = (pontos) => { setCoordenadasGPS(pontos); setMostrarCapturaGPS(false); toast.success(`${pontos.length} pontos capturados via GPS!`); };

  React.useEffect(() => {
    const coords = coordenadasGPS || coordenadas;
    if (window.google?.maps?.geometry && coords && coords.length >= 3) {
      const polygon = new google.maps.Polygon({ paths: coords.map((c) => new google.maps.LatLng(c.lat, c.lng)) });
      const areaM2 = google.maps.geometry.spherical.computeArea(polygon.getPath());
      const areaHa = (areaM2 / 10000).toFixed(2);
      setFormData((prev) => ({ ...prev, area_total: areaHa }));
    }
  }, [coordenadasGPS, coordenadas]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const missing = [];
    if (!formData.nome?.trim()) missing.push("nome");
    if (!formData.setor_id) missing.push("setor_id");
    if (!formData.area_total) missing.push("area_total");
    if (!formData.area_pastejada) missing.push("area_pastejada");
    if (!formData.tipo_pastagem) missing.push("tipo_pastagem");
    if (missing.length) { setInvalidFields(missing); toast.error("Preencha os campos obrigatórios."); return; }

    const coords = coordenadasGPS || coordenadas;
    let tamanhoHectares = 0;
    if (window.google?.maps?.geometry && coords && coords.length >= 3) {
      const polygon = new google.maps.Polygon({ paths: coords.map((c) => new google.maps.LatLng(c.lat, c.lng)) });
      const areaM2 = google.maps.geometry.spherical.computeArea(polygon.getPath());
      tamanhoHectares = parseFloat((areaM2 / 10000).toFixed(2));
    }

    createAreaMutation.mutate({
      nome: formData.nome.toUpperCase(),
      sigla: formData.sigla?.toUpperCase(),
      numero_area: formData.numero_area?.toString().trim() || undefined,
      setor_id: formData.setor_id,
      setor_nome: formData.setor_nome,
      aproveitamento_classificacao: formData.aproveitamento,
      tipo_cultura: formData.tipo_cultura,
      tipo_pastagem: formData.tipo_pastagem,
      tamanho_hectares: parseFloat(String(formData.area_total).replace(',', '.')) || tamanhoHectares,
      area_pastejada: parseFloat(String(formData.area_pastejada).replace(',', '.')) || 0,
      observacoes: formData.observacoes?.toUpperCase(),
      cor: formData.cor,
    });
  };

  if (mostrarCapturaGPS) {
    return <CapturaGPSPoligono tipo="area" onSalvar={handleCapturaGPS} onCancelar={() => { setMostrarCapturaGPS(false); if (usarGPS) onCancel(); }} />;
  }

  return (
    <div className="mt-4">
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm border-slate-300">
        <div className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <div className="text-sm font-semibold text-slate-900">{item ? 'Editar Área' : 'Nova Área'}</div>
        </div>
        <div className="p-1">
          <form onSubmit={handleSubmit} className="space-y-1">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
        <div className="space-y-1 lg:col-span-2">
          <Label className="text-xs">Nome do Pasto *</Label>
          <Input value={formData.nome} onChange={(e) => handleChange('nome', e.target.value)} placeholder="NOME DO PASTO" className={getFieldClassName('nome', 'h-7 text-xs uppercase')} style={{ textTransform: 'uppercase' }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sigla</Label>
          <Input value={formData.sigla} onChange={(e) => handleChange('sigla', e.target.value.toUpperCase())} placeholder="SIGLA" className="h-7 text-xs uppercase" style={{ textTransform: 'uppercase' }} maxLength={10} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
        <div className="space-y-1">
          <Label className="text-xs">Número/Código</Label>
          <Input value={formData.numero_area} onChange={(e) => handleChange('numero_area', e.target.value.replace(/[^0-9]/g, ''))} placeholder="Automático se vazio" className="h-7 text-xs" inputMode="numeric" />
        </div>
        <div className="space-y-1 lg:col-span-2">
          <Label className="text-xs">Setor *</Label>
          <Select value={formData.setor_id || '__none__'} onValueChange={(value) => { const setor = setores.find((item) => item.id === value); handleChange('setor_id', value === '__none__' ? '' : value); handleChange('setor_nome', setor?.nome || ''); }}>
            <SelectTrigger className={getFieldClassName('setor_id', 'h-7 text-xs')}><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
            <SelectContent><SelectItem value="__none__" className="text-xs">Selecione</SelectItem>{setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
        <div className="space-y-1"><Label className="text-xs">Área total *</Label><Input type="text" value={formData.area_total} onChange={(e) => handleChange('area_total', e.target.value)} placeholder="0,00" className={getFieldClassName('area_total', 'h-7 text-xs')} /></div>
        <div className="space-y-1"><Label className="text-xs">Área pastejada ou arável *</Label><Input type="text" value={formData.area_pastejada} onChange={(e) => handleChange('area_pastejada', e.target.value)} placeholder="0,00" className={getFieldClassName('area_pastejada', 'h-7 text-xs')} /></div>
        <div className="space-y-1"><Label className="text-xs">Aproveitamento *</Label><Select value={formData.aproveitamento} onValueChange={(v) => handleChange('aproveitamento', v)}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{APROVEITAMENTO.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent></Select></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
        <div className="space-y-1"><Label className="text-xs">Tipo de uso *</Label><Select value={formData.tipo_cultura} onValueChange={(v) => handleChange('tipo_cultura', v)}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{TIPOS_USO.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1 lg:col-span-2"><Label className="text-xs">Tipo de cultura *</Label><Select value={formData.tipo_pastagem} onValueChange={(v) => handleChange('tipo_pastagem', v)}><SelectTrigger className={getFieldClassName('tipo_pastagem', 'h-8 text-xs')}><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{TIPOS_CULTURAS.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent></Select></div>
      </div>

      <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-3 space-y-1">
        <div><span className="font-semibold text-sm text-slate-700">Cor no mapa</span></div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-1">
          <div className="space-y-1 lg:col-span-2"><Label className="text-xs">Cor *</Label><Select value={formData.cor} onValueChange={(v) => handleChange('cor', v)}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{CORES_DISPONIVEIS.map((c) => <SelectItem key={c.cor} value={c.cor} className="text-xs">{c.nome}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-end"><div className="h-8 w-full rounded border" style={{ backgroundColor: formData.cor }} /></div>
        </div>
      </div>

      <div className="space-y-1 pt-1"><Label className="text-xs">Descrição</Label><Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} className="text-xs uppercase" style={{ textTransform: 'uppercase' }} rows={2} /></div>
      <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t"><Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button><Button type="submit" size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Salvar</Button></div>
          </form>
        </div>
      </div>
    </div>
  );
}