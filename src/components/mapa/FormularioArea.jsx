/* global google */
import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

const FloatingField = ({ label, required, error, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);
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
const TIPOS_INFRAESTRUTURA = ["Curral", "Oficina", "Casa", "Barracão", "Galpão", "Depósito", "Embarcador", "Brete", "Outro"];
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
    tipo_infraestrutura: item?.tipo_infraestrutura || "",
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
    if (formData.tipo_cultura !== 'Infraestrutura' && !formData.area_total) missing.push("area_total");
    if (formData.tipo_cultura !== 'Infraestrutura' && !formData.area_pastejada) missing.push("area_pastejada");
    if (formData.tipo_cultura === 'Infraestrutura' && !formData.tipo_infraestrutura) missing.push("tipo_infraestrutura");
    if (formData.tipo_cultura !== 'Infraestrutura' && !formData.tipo_pastagem) missing.push("tipo_pastagem");
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
      tipo_pastagem: formData.tipo_cultura === 'Infraestrutura' ? 'Infraestrutura' : formData.tipo_pastagem,
      tipo_infraestrutura: formData.tipo_cultura === 'Infraestrutura' ? formData.tipo_infraestrutura : undefined,
      tamanho_hectares: formData.tipo_cultura === 'Infraestrutura' ? 0 : parseFloat(parseHa(String(formData.area_total))) || tamanhoHectares,
      area_pastejada: formData.tipo_cultura === 'Infraestrutura' ? 0 : parseFloat(parseHa(String(formData.area_pastejada))) || 0,
      observacoes: formData.observacoes?.toUpperCase(),
      cor: formData.cor,
    });
  };

  if (mostrarCapturaGPS) {
    return <CapturaGPSPoligono tipo="area" onSalvar={handleCapturaGPS} onCancelar={() => { setMostrarCapturaGPS(false); if (usarGPS) onCancel(); }} />;
  }

  return (
    <div className="mt-1">
      <form onSubmit={handleSubmit} className="space-y-0.5">
        {formData.tipo_cultura !== 'Infraestrutura' && (
          <>
            <FloatingField label="Área total (ha)" required error={invalidFields.includes('area_total')}>
              <Input
                value={formData.area_total}
                onChange={(e) => handleChange('area_total', e.target.value)}
                className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                readOnly
              />
            </FloatingField>

            <FloatingField label="Área pastejada ou arável (ha)" required error={invalidFields.includes('area_pastejada')}>
              <Input
                value={formData.area_pastejada}
                onChange={(e) => handleChange('area_pastejada', e.target.value)}
                className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
              />
            </FloatingField>
          </>
        )}

        <FloatingField label="Nome" required error={invalidFields.includes('nome')}>
          <Input
            value={formData.nome}
            onChange={(e) => handleChange('nome', e.target.value)}
            className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
            style={{ textTransform: 'uppercase' }}
          />
        </FloatingField>

        <FloatingField label="Sigla">
          <Input
            value={formData.sigla}
            onChange={(e) => handleChange('sigla', e.target.value.toUpperCase())}
            className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
            style={{ textTransform: 'uppercase' }}
            maxLength={10}
          />
        </FloatingField>

        <FloatingField label="Setor" required error={invalidFields.includes('setor_id')}>
          <Select value={formData.setor_id || '__none__'} onValueChange={(value) => { const setor = setores.find((s) => s.id === value); handleChange('setor_id', value === '__none__' ? '' : value); handleChange('setor_nome', setor?.nome || ''); }}>
            <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
              {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </FloatingField>

        <FloatingField label="Tipo de uso" required>
          <Select value={formData.tipo_cultura} onValueChange={(v) => setFormData((prev) => ({ ...prev, tipo_cultura: v, tipo_pastagem: v === 'Infraestrutura' ? 'Infraestrutura' : prev.tipo_pastagem, tipo_infraestrutura: v === 'Infraestrutura' ? prev.tipo_infraestrutura : '' }))}>
            <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_USO.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
            </SelectContent>
          </Select>
        </FloatingField>

        {formData.tipo_cultura === 'Infraestrutura' ? (
          <FloatingField label="Tipo de infraestrutura" required error={invalidFields.includes('tipo_infraestrutura')}>
            <Select value={formData.tipo_infraestrutura || '__none__'} onValueChange={(v) => handleChange('tipo_infraestrutura', v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                {TIPOS_INFRAESTRUTURA.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
              </SelectContent>
            </Select>
          </FloatingField>
        ) : (
          <>
            <FloatingField label="Tipo de cultura" required error={invalidFields.includes('tipo_pastagem')}>
              <Select value={formData.tipo_pastagem || '__none__'} onValueChange={(v) => handleChange('tipo_pastagem', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                  {TIPOS_CULTURAS.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
                </SelectContent>
              </Select>
            </FloatingField>

            <FloatingField label="Aproveitamento">
              <Select value={formData.aproveitamento} onValueChange={(v) => handleChange('aproveitamento', v)}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {APROVEITAMENTO.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
                </SelectContent>
              </Select>
            </FloatingField>
          </>
        )}

        <FloatingField label="Cor no mapa">
          <Select value={formData.cor} onValueChange={(v) => handleChange('cor', v)}>
            <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" style={{ backgroundColor: formData.cor }} />
                  {CORES_DISPONIVEIS.find((c) => c.cor === formData.cor)?.nome || 'Selecione'}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CORES_DISPONIVEIS.map((c) => (
                <SelectItem key={c.cor} value={c.cor} className="text-xs">
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" style={{ backgroundColor: c.cor }} />
                    {c.nome}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FloatingField>

        <FloatingField label="Observação">
          <Textarea
            value={formData.observacoes}
            onChange={(e) => handleChange('observacoes', e.target.value)}
            className="text-xs uppercase min-h-[50px] border-0 shadow-none focus-visible:ring-0 bg-transparent"
            style={{ textTransform: 'uppercase' }}
            rows={2}
          />
        </FloatingField>

        <div className="flex justify-end gap-1 pt-1 border-t border-slate-200">
          <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">
            Cancelar
          </Button>
          <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
            Salvar
          </Button>
        </div>
      </form>
    </div>
  );
}