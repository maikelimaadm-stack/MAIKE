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

  const formatHa = (val) => {
    if (!val && val !== 0) return '';
    const num = parseFloat(String(val).replace(',', '.'));
    if (isNaN(num)) return String(val);
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const parseHa = (str) => {
    // Aceita entrada do usuário no formato pt-BR: remove pontos de milhar, troca vírgula por ponto
    return str.replace(/\./g, '').replace(',', '.');
  };

  React.useEffect(() => {
    const coords = coordenadasGPS || coordenadas;
    if (window.google?.maps?.geometry && coords && coords.length >= 3) {
      const polygon = new google.maps.Polygon({ paths: coords.map((c) => new google.maps.LatLng(c.lat, c.lng)) });
      const areaM2 = google.maps.geometry.spherical.computeArea(polygon.getPath());
      const areaHa = (areaM2 / 10000);
      setFormData((prev) => ({ ...prev, area_total: formatHa(areaHa) }));
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
      tamanho_hectares: parseFloat(parseHa(String(formData.area_total))) || tamanhoHectares,
      area_pastejada: parseFloat(parseHa(String(formData.area_pastejada))) || 0,
      observacoes: formData.observacoes?.toUpperCase(),
      cor: formData.cor,
    });
  };

  if (mostrarCapturaGPS) {
    return <CapturaGPSPoligono tipo="area" onSalvar={handleCapturaGPS} onCancelar={() => { setMostrarCapturaGPS(false); if (usarGPS) onCancel(); }} />;
  }

  return (
    <div className="mt-4 space-y-3">
      {/* Cor no mapa */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {CORES_DISPONIVEIS.map((c) => (
            <button
              key={c.cor}
              type="button"
              onClick={() => handleChange('cor', c.cor)}
              className={`w-8 h-8 rounded-md border-2 transition-all ${formData.cor === c.cor ? 'border-slate-900 scale-110 shadow-md' : 'border-slate-200 hover:border-slate-400'}`}
              style={{ backgroundColor: c.cor }}
              title={c.nome}
            />
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        {/* Campos em estilo clean - placeholder dentro */}
        <Input
          value={formData.numero_area}
          onChange={(e) => handleChange('numero_area', e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="Número ou código da área"
          className="h-9 text-xs uppercase"
          inputMode="numeric"
          style={{ textTransform: 'uppercase' }}
        />

        <Input
          value={formData.area_total}
          onChange={(e) => handleChange('area_total', e.target.value)}
          placeholder="Área total (ha) *"
          className={getFieldClassName('area_total', 'h-9 text-xs')}
          readOnly
        />

        <Input
          value={formData.area_pastejada}
          onChange={(e) => handleChange('area_pastejada', e.target.value)}
          placeholder="Área pastejada ou arável (ha) *"
          className={getFieldClassName('area_pastejada', 'h-9 text-xs')}
        />

        <Input
          value={formData.nome}
          onChange={(e) => handleChange('nome', e.target.value)}
          placeholder="Nome *"
          className={getFieldClassName('nome', 'h-9 text-xs uppercase')}
          style={{ textTransform: 'uppercase' }}
        />

        <Input
          value={formData.sigla}
          onChange={(e) => handleChange('sigla', e.target.value.toUpperCase())}
          placeholder="Sigla"
          className="h-9 text-xs uppercase"
          style={{ textTransform: 'uppercase' }}
          maxLength={10}
        />

        <Select value={formData.setor_id || '__none__'} onValueChange={(value) => { const setor = setores.find((s) => s.id === value); handleChange('setor_id', value === '__none__' ? '' : value); handleChange('setor_nome', setor?.nome || ''); }}>
          <SelectTrigger className={getFieldClassName('setor_id', 'h-9 text-xs')}>
            <SelectValue placeholder="Setor *" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
            {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={formData.tipo_cultura} onValueChange={(v) => handleChange('tipo_cultura', v)}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Tipo de uso *" />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_USO.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={formData.tipo_pastagem || '__none__'} onValueChange={(v) => handleChange('tipo_pastagem', v === '__none__' ? '' : v)}>
          <SelectTrigger className={getFieldClassName('tipo_pastagem', 'h-9 text-xs')}>
            <SelectValue placeholder="Tipo de cultura *" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
            {TIPOS_CULTURAS.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={formData.aproveitamento} onValueChange={(v) => handleChange('aproveitamento', v)}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Aproveitamento" />
          </SelectTrigger>
          <SelectContent>
            {APROVEITAMENTO.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
          </SelectContent>
        </Select>

        <Textarea
          value={formData.observacoes}
          onChange={(e) => handleChange('observacoes', e.target.value)}
          placeholder="Observação"
          className="text-xs uppercase min-h-[60px]"
          style={{ textTransform: 'uppercase' }}
          rows={2}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs px-4">
            Cancelar
          </Button>
          <Button type="submit" size="sm" className="h-8 text-xs px-4 bg-emerald-600 hover:bg-emerald-700 text-white">
            Salvar
          </Button>
        </div>
      </form>
    </div>
  );
}