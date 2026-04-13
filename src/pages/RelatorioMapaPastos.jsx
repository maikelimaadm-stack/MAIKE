/* global google */
import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import RelatorioBase from "@/components/relatorios/RelatorioBase";
import { toast } from "sonner";

// Reutiliza a mesma abordagem do MapaGeral
const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const loadGoogleMapsScript = () => {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const MAP_STYLE_BLANK = [
  { featureType: 'all', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', stylers: [{ color: '#ffffff' }] }
];

export default function RelatorioMapaPastos() {
  const empresaSelecionadaId = typeof window !== 'undefined' ? localStorage.getItem('empresa_selecionada_id') : null;
  const [mapReady, setMapReady] = useState(false);
  const [styleMode, setStyleMode] = useState('colors'); // 'colors' | 'lines'
  const [showList, setShowList] = useState(true);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const overlaysRef = useRef([]);

  const { data: areas = [], isLoading } = useQuery({
    queryKey: ['areas-relatorio-mapa', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    loadGoogleMapsScript()
      .then(() => {
        if (!mapRef.current || mapInstanceRef.current) return;
        const map = new google.maps.Map(mapRef.current, {
          center: { lat: -15.0067, lng: -59.9533 },
          zoom: 14,
          mapTypeId: 'roadmap',
          styles: MAP_STYLE_BLANK,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: 'none', // congelado para impressão
          zoomControl: false,
          disableDefaultUI: true,
          clickableIcons: false,
        });
        mapInstanceRef.current = map;
        google.maps.event.addListenerOnce(map, 'tilesloaded', () => setMapReady(true));
      })
      .catch(() => toast.error('Erro ao carregar mapa'));
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    renderAreas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, mapReady, styleMode]);

  const clearMap = () => {
    polygonsRef.current.forEach(p => p.setMap(null));
    polygonsRef.current = [];
    overlaysRef.current.forEach(o => o.setMap && o.setMap(null));
    overlaysRef.current = [];
  };

  const renderAreas = () => {
    clearMap();
    const map = mapInstanceRef.current;
    const bounds = new google.maps.LatLngBounds();
    let hasCoords = false;

    (areas || []).forEach(area => {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) return;
      const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = area.coordenadas?.cor || area.cor || '#61aad9';

      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: cor,
        strokeOpacity: 0.9,
        strokeWeight: styleMode === 'lines' ? 2 : 1,
        fillColor: cor,
        fillOpacity: styleMode === 'lines' ? 0 : 0.5,
      });
      polygon.setMap(map);
      polygonsRef.current.push(polygon);

      paths.forEach(p => { bounds.extend(p); hasCoords = true; });

      // centróide
      let cx = 0, cy = 0, A = 0;
      for (let i = 0; i < paths.length; i++) {
        const x0 = paths[i].lat, y0 = paths[i].lng;
        const x1 = paths[(i + 1) % paths.length].lat, y1 = paths[(i + 1) % paths.length].lng;
        const a = x0 * y1 - x1 * y0; A += a; cx += (x0 + x1) * a; cy += (y0 + y1) * a;
      }
      A *= 0.5;
      let centroid = null;
      if (Math.abs(A) > 1e-6) {
        centroid = new google.maps.LatLng(cx / (6 * A), cy / (6 * A));
      } else {
        const b = new google.maps.LatLngBounds();
        paths.forEach(p => b.extend(p));
        centroid = b.getCenter();
      }

      // overlay com somente o NOME (sem hectares)
      const div = document.createElement('div');
      div.innerHTML = `
        <div style="
          color:#fff; font-size:12px; font-weight:600; text-shadow:1px 1px 2px rgba(0,0,0,.7);
          white-space:nowrap; pointer-events:none; font-family: Arial, sans-serif;">
          ${area.nome || 'Sem nome'}
        </div>`;
      const overlay = new google.maps.OverlayView();
      overlay.onAdd = function() { this.getPanes().floatPane.appendChild(div); };
      overlay.draw = function() {
        const proj = this.getProjection();
        const pos = proj.fromLatLngToDivPixel(centroid);
        div.style.position = 'absolute';
        div.style.left = pos.x + 'px';
        div.style.top = pos.y + 'px';
        div.style.transform = 'translate(-50%, -50%)';
        div.style.zIndex = '9999';
      };
      overlay.onRemove = function() { div.parentNode && div.parentNode.removeChild(div); };
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    });

    if (hasCoords) map.fitBounds(bounds, { padding: 50 });
  };

  return (
    <RelatorioBase title="Relatório de Mapa de Pastos" subtitle="Apenas nomes dos pastos" orientation="landscape">
      <div className="space-y-4">
        {/* Filtros / Opções - Padrão de filtros */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Opções de impressão</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">Estilo dos pastos</Label>
                <RadioGroup value={styleMode} onValueChange={setStyleMode} className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="linhas" value="lines" />
                    <Label htmlFor="linhas" className="text-xs">Linhas somente</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="cores" value="colors" />
                    <Label htmlFor="cores" className="text-xs">Cores dos pastos</Label>
                  </div>
                </RadioGroup>
              </div>
              <div className="col-span-2 flex items-end">
                <div className="flex items-center gap-2">
                  <Checkbox id="lista" checked={showList} onCheckedChange={(v)=>setShowList(!!v)} />
                  <Label htmlFor="lista" className="text-xs">Incluir lista de pastos</Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mapa */}
        <div className="w-full h-[600px] border border-gray-300 rounded-lg overflow-hidden relative">
          {(!mapReady || isLoading) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
              <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
              <span className="ml-3 text-slate-700 text-sm">Carregando mapa...</span>
            </div>
          )}
          <div ref={mapRef} className="w-full h-full" style={{ touchAction: 'none' }} />
        </div>

        {/* Lista de pastos */}
        {showList && (
          <div className="pt-2">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Lista de Pastos</h3>
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left text-xs font-bold py-1 px-2 border border-black">Nome</th>
                    <th className="text-left text-xs font-bold py-1 px-2 border border-black">Categoria/Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {(areas || []).map((a, idx) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="text-xs py-1 px-2 border border-gray-300">{a.nome || '-'}</td>
                      <td className="text-xs py-1 px-2 border border-gray-300">{a.tipo_pastagem || '-'}</td>
                    </tr>
                  ))}
                  {(areas || []).length === 0 && (
                    <tr>
                      <td colSpan={2} className="text-xs py-2 px-2 text-center text-slate-500">Nenhum pasto encontrado</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </RelatorioBase>
  );
}