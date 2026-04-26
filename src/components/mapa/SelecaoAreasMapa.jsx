/* global google */
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { X, CheckSquare, Palette, Layers, Flag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const CORES_DISPONIVEIS = [
{ nome: "Branco", cor: "#f8f9fa" },
{ nome: "Cinza claro", cor: "#d8dee2" },
{ nome: "Preto", cor: "#2c303e" },
{ nome: "Azul escuro", cor: "#0d67ad" },
{ nome: "Azul celeste", cor: "#61aad9" },
{ nome: "Amarelo", cor: "#efcb19" },
{ nome: "Verde claro", cor: "#92ca25" },
{ nome: "Laranja", cor: "#f5a01b" },
{ nome: "Roxo", cor: "#966fe1" }];

const TIPOS_USO = ["Pastagem", "Agricultura", "Reserva", "APP", "Infraestrutura"];
const APROVEITAMENTO = ["Alta", "Média", "Baixa"];
const TIPOS_CULTURAS = [
"Brachiaria", "Mombaça", "Tanzânia", "Tifton", "Piatã", "Marandu", "Panicum", "Elefante",
"Milho", "Soja", "Sorgo", "Arroz", "Trigo", "Cevada", "Cana-de-açúcar", "Algodão",
"Feijão", "Girassol", "Aveia", "Café", "Eucalipto", "Floresta", "Outros"];


function getAreaLabelContent(text) {
  return (
    <div className="pointer-events-none whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.02em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">
      {text}
    </div>);

}

function createAreaLabelOverlay({ map, position, text }) {
  class LabelOverlay extends google.maps.OverlayView {
    onAdd() {
      const div = document.createElement("div");
      div.style.position = "absolute";
      div.style.transform = "translate(-50%, -50%)";
      div.style.pointerEvents = "none";
      const root = createRoot(div);
      root.render(getAreaLabelContent(text));
      this.div = div;
      this.root = root;
      this.getPanes()?.overlayLayer?.appendChild(div);
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      const point = projection?.fromLatLngToDivPixel(position);
      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
    }

    onRemove() {
      this.root?.unmount();
      if (this.div?.parentNode) {
        this.div.parentNode.removeChild(this.div);
      }
      this.div = null;
      this.root = null;
    }
  }

  const overlay = new LabelOverlay();
  overlay.setMap(map);
  return overlay;
}

export default function SelecaoAreasMapa({ onClose, selectedIds = [], selectionMode = false, onConfirmSelection = null }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const overlaysRef = useRef([]);
  const selecionadosRef = useRef(new Set());
  const [ready, setReady] = useState(false);
  const [batchType, setBatchType] = useState(null);
  const [batchValue, setBatchValue] = useState("");
  const [startNumber, setStartNumber] = useState("");
  const queryClient = useQueryClient();
  const empresaId = localStorage.getItem('empresa_selecionada_id');

  useEffect(() => {
    selecionadosRef.current = new Set(selectedIds || []);
  }, [selectedIds]);

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaId && a.ativo !== false);
    },
    enabled: !!empresaId
  });

  useEffect(() => {
    const load = () => new Promise((resolve, reject) => {
      if (window.google?.maps) return resolve();
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`;
      s.async = true;s.defer = true;s.onload = resolve;s.onerror = reject;document.head.appendChild(s);
    });
    load().then(() => setReady(true)).catch(() => toast.error('Erro ao carregar mapa'));
  }, []);

  useEffect(() => {
    if (!ready || mapInstanceRef.current) return;
    const map = new google.maps.Map(mapRef.current, {
      center: { lat: -15.0067, lng: -59.9533 }, zoom: 14, mapTypeId: 'satellite',
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false
    });
    mapInstanceRef.current = map;
  }, [ready]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    polygonsRef.current.forEach((item) => item.setMap(null));
    overlaysRef.current.forEach((item) => item.setMap(null));
    polygonsRef.current = [];
    overlaysRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let has = false;

    areas.forEach((area) => {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) return;
      const paths = coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      paths.forEach((p) => bounds.extend(p));
      has = true;

      const cor = area.coordenadas?.cor || area.cor || '#10b981';
      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: cor,
        strokeOpacity: 0.8,
        strokeWeight: 1.5,
        fillColor: cor,
        fillOpacity: selecionadosRef.current.has(area.id) ? 0.45 : 0.2,
        clickable: true
      });
      polygon.setMap(mapInstanceRef.current);

      const boundsArea = new google.maps.LatLngBounds();
      paths.forEach((point) => boundsArea.extend(point));
      const center = boundsArea.getCenter();
      const overlay = createAreaLabelOverlay({
        map: mapInstanceRef.current,
        position: center,
        text: area.nome || area.numero_area || 'ÁREA'
      });

      polygon.addListener('click', () => {
        const set = selecionadosRef.current;
        if (set.has(area.id)) set.delete(area.id);else set.add(area.id);
        polygon.setOptions({ fillOpacity: set.has(area.id) ? 0.45 : 0.2 });
      });

      polygonsRef.current.push(polygon);
      overlaysRef.current.push(overlay);
    });

    if (has) {
      mapInstanceRef.current.fitBounds(bounds, { padding: 50 });
    }
  }, [areas, ready]);

  const aplicarLote = async () => {
    const ids = Array.from(selecionadosRef.current);
    if (ids.length === 0) {toast.error('Selecione áreas no mapa');return;}
    try {
      if (batchType === 'aproveitamento') {
        await Promise.all(ids.map((id) => base44.entities.AreaPastagem.update(id, { aproveitamento_classificacao: batchValue })));
      } else if (batchType === 'uso') {
        await Promise.all(ids.map((id) => base44.entities.AreaPastagem.update(id, { tipo_cultura: batchValue })));
      } else if (batchType === 'cultura') {
        await Promise.all(ids.map((id) => base44.entities.AreaPastagem.update(id, { tipo_pastagem: batchValue })));
      } else if (batchType === 'cor') {
        await Promise.all(ids.map((id) => {
          const area = areas.find((a) => a.id === id);
          const coords = area?.coordenadas?.coords || [];
          return base44.entities.AreaPastagem.update(id, { cor: batchValue, coordenadas: { coords, cor: batchValue } });
        }));
      }
      toast.success('Atualizado');
      setBatchType(null);setBatchValue('');
      selecionadosRef.current.clear();
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'areas' });
    } catch {
      toast.error('Falha ao aplicar alterações');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div ref={mapRef} className="absolute inset-0" />

      <Button onClick={onClose} variant="secondary" size="icon" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground absolute top-1 left-1 z-20 h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white">
        <X className="w-5 h-5 text-slate-700" />
      </Button>

      {selectionMode ?
      <div className="absolute top-4 right-4 z-20 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
          Clique nas áreas do mapa para vincular ao cocho
        </div> :

      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs bg-white/90">
                <Layers className="w-3.5 h-3.5 mr-2" /> Ações em Lote
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {setBatchType('aproveitamento');setBatchValue('Alta');}} className="text-xs">
                <CheckSquare className="w-3.5 h-3.5 mr-2" /> Definir Aproveitamento
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {setBatchType('uso');setBatchValue('Pastagem');}} className="text-xs">
                <Flag className="w-3.5 h-3.5 mr-2" /> Definir Tipo de Uso
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {setBatchType('cultura');setBatchValue('Brachiaria');}} className="text-xs">
                <Flag className="w-3.5 h-3.5 mr-2" /> Definir Tipo de Cultura
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {setBatchType('cor');setBatchValue(CORES_DISPONIVEIS[4].cor);}} className="text-xs">
                <Palette className="w-3.5 h-3.5 mr-2" /> Definir Cor
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {setBatchType('renumerar');setStartNumber('1');}} className="text-xs">
                <Layers className="w-3.5 h-3.5 mr-2" /> Reatribuir Códigos
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }

      {selectionMode &&
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs bg-white/95" onClick={onClose}>Cancelar</Button>
          <Button
          type="button"
          size="sm"
          className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
          onClick={() => {
            const ids = Array.from(selecionadosRef.current);
            if (ids.length === 0) {
              toast.error('Selecione áreas no mapa');
              return;
            }
            onConfirmSelection?.(ids);
          }}>
          
            Usar áreas selecionadas
          </Button>
        </div>
      }

      <Dialog open={!selectionMode && !!batchType} onOpenChange={() => {setBatchType(null);setBatchValue('');}}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {batchType === 'aproveitamento' && 'Definir Aproveitamento'}
              {batchType === 'uso' && 'Definir Tipo de Uso'}
              {batchType === 'cultura' && 'Definir Tipo de Cultura'}
              {batchType === 'cor' && 'Definir Cor no Mapa'}
            </DialogTitle>
          </DialogHeader>
          {batchType === 'aproveitamento' &&
          <div className="space-y-2">
              <Label className="text-xs">Aproveitamento</Label>
              <Select value={batchValue} onValueChange={setBatchValue}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {APROVEITAMENTO.map((v) => <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote}>Aplicar</Button>
              </div>
            </div>
          }
          {batchType === 'uso' &&
          <div className="space-y-2">
              <Label className="text-xs">Tipo de Uso</Label>
              <Select value={batchValue} onValueChange={setBatchValue}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {TIPOS_USO.map((v) => <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote}>Aplicar</Button>
              </div>
            </div>
          }
          {batchType === 'cultura' &&
          <div className="space-y-2">
              <Label className="text-xs">Tipo de Cultura</Label>
              <Select value={batchValue} onValueChange={setBatchValue}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {TIPOS_CULTURAS.map((v) => <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote}>Aplicar</Button>
              </div>
            </div>
          }
          {batchType === 'cor' &&
          <div className="space-y-3">
              <Label className="text-xs">Cor</Label>
              <div className="grid grid-cols-5 gap-2">
                {CORES_DISPONIVEIS.map((c) =>
              <button key={c.cor} type="button" onClick={() => setBatchValue(c.cor)} className={`h-8 rounded border ${batchValue === c.cor ? 'ring-2 ring-emerald-600' : ''}`} style={{ backgroundColor: c.cor }} title={c.nome} />
              )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote} disabled={!batchValue}>Aplicar</Button>
              </div>
            </div>
          }
          {batchType === 'renumerar' &&
          <div className="space-y-2">
              <Label className="text-xs">Iniciar numeração a partir de</Label>
              <Input value={startNumber} onChange={(e) => setStartNumber(e.target.value.replace(/[^0-9]/g, ''))} className="h-8 text-xs" placeholder="1" />
              <p className="text-[11px] text-slate-500">As áreas selecionadas serão ordenadas por Nome (A→Z) e receberão códigos sequenciais.</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                const ids = Array.from(selecionadosRef.current);
                if (!ids.length) {toast.error('Selecione áreas no mapa');return;}
                const start = parseInt(startNumber || '1');
                const selecionadas = areas.filter((a) => ids.includes(a.id)).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
                await Promise.all(selecionadas.map((a, idx) => base44.entities.AreaPastagem.update(a.id, { numero_area: String(start + idx) })));
                toast.success('Códigos reatribuídos');
                setBatchType(null);setStartNumber('');selecionadosRef.current.clear();
                queryClient.invalidateQueries({ queryKey: ['areas'] });
              }} disabled={!startNumber}>Aplicar</Button>
              </div>
            </div>
          }
        </DialogContent>
      </Dialog>
    </div>);

}