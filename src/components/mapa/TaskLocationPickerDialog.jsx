import React, { useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MapPin } from "lucide-react";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";
let googleMapsPromise = null;

const loadGoogleMapsScript = () => {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) { existing.addEventListener("load", resolve); existing.addEventListener("error", reject); return; }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return googleMapsPromise;
};

const calcCentroid = (paths) => {
  let cLat = 0, cLng = 0, sA = 0;
  for (let i = 0; i < paths.length; i++) {
    const x0 = paths[i].lat, y0 = paths[i].lng;
    const x1 = paths[(i + 1) % paths.length].lat, y1 = paths[(i + 1) % paths.length].lng;
    const a = x0 * y1 - x1 * y0;
    sA += a; cLat += (x0 + x1) * a; cLng += (y0 + y1) * a;
  }
  sA *= 0.5; cLat /= (6 * sA); cLng /= (6 * sA);
  if (!isFinite(cLat) || !isFinite(cLng) || !sA) {
    const b = new google.maps.LatLngBounds(); paths.forEach(p => b.extend(p)); const c = b.getCenter(); return { lat: c.lat(), lng: c.lng() };
  }
  return { lat: cLat, lng: cLng };
};

export default function TaskLocationPickerDialog({ open, onOpenChange, areas = [], initialCoordinates, onSelect }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const drawnRef = useRef({ polygons: [], labels: [], taskMarkers: [], listeners: [] });
  const selectingRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onOpenChangeRef = useRef(onOpenChange);

  // Keep refs current
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);

  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: tarefasPendentes = [] } = useQuery({
    queryKey: ["tarefas-picker-pendentes", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list("-updated_date");
      return all.filter(t => t.empresa_id === empresaSelecionadaId && (t.status === "Pendente" || t.status === "Em Andamento"));
    },
    enabled: open && !!empresaSelecionadaId,
    initialData: []
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["icones-config-picker", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: open && !!empresaSelecionadaId,
    initialData: []
  });

  const clearDrawn = useCallback(() => {
    const d = drawnRef.current;
    d.listeners.forEach(l => google.maps.event.removeListener(l));
    d.polygons.forEach(p => p.setMap(null));
    d.labels.forEach(l => l.setMap(null));
    d.taskMarkers.forEach(m => m.setMap(null));
    drawnRef.current = { polygons: [], labels: [], taskMarkers: [], listeners: [] };
  }, []);

  const findAreaAtPoint = useCallback((latLng) => {
    for (const area of areas) {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) continue;
      const path = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const poly = new google.maps.Polygon({ paths: path });
      if (google.maps.geometry.poly.containsLocation(latLng, poly)) return area;
    }
    return null;
  }, [areas]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    loadGoogleMapsScript().then(() => {
      if (cancelled || !mapRef.current) return;

      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapRef.current, {
          center: initialCoordinates || { lat: -15.0067, lng: -59.9533 },
          zoom: initialCoordinates ? 17 : 14,
          mapTypeId: "satellite",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
      }

      const map = mapInstanceRef.current;
      selectingRef.current = false;
      clearDrawn();

      const d = drawnRef.current;

      const handleSelect = (coords, area) => {
        if (selectingRef.current) return;
        selectingRef.current = true;

        if (!markerRef.current) {
          markerRef.current = new google.maps.Marker({
            map, position: coords,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#059669", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 },
            zIndex: 9999,
          });
        } else {
          markerRef.current.setPosition(coords);
          markerRef.current.setMap(map);
        }

        window.setTimeout(() => {
          onSelectRef.current?.(coords, area);
          onOpenChangeRef.current(false);
          selectingRef.current = false;
        }, 100);
      };

      // Draw area polygons with proper colors
      areas.forEach(area => {
        const coords = area.coordenadas?.coords || [];
        if (coords.length < 3) return;
        const path = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
        const cor = area.coordenadas?.cor || area.cor || '#61aad9';

        const polygon = new google.maps.Polygon({
          paths: path,
          strokeColor: cor,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: cor,
          fillOpacity: 0.45,
          map,
        });

        polygon.addListener('mouseover', () => polygon.setOptions({ strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 3 }));
        polygon.addListener('mouseout', () => polygon.setOptions({ strokeColor: cor, strokeOpacity: 0.8, strokeWeight: 2 }));
        polygon.addListener('click', (e) => {
          const clickCoords = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          handleSelect(clickCoords, area);
        });

        d.polygons.push(polygon);

        // Draw area label
        const center = calcCentroid(path);
        const hectares = Number(area.area_pastejada || area.tamanho_hectares || 0);
        const hectaresText = hectares > 0 ? `ha ${hectares.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

        const labelDiv = document.createElement('div');
        labelDiv.innerHTML = `
          <div style="color:white;text-align:center;white-space:nowrap;text-shadow:1px 1px 3px rgba(0,0,0,0.8);pointer-events:none;font-family:Arial,sans-serif;">
            <div style="font-size:11px;font-weight:700;">${area.nome || ''}</div>
            ${hectaresText ? `<div style="font-size:10px;font-weight:400;opacity:0.95;">${hectaresText}</div>` : ''}
          </div>`;

        const overlay = new google.maps.OverlayView();
        overlay.onAdd = function() { this.getPanes().markerLayer.appendChild(labelDiv); };
        overlay.draw = function() {
          const proj = this.getProjection();
          if (!proj) return;
          const pos = proj.fromLatLngToDivPixel(new google.maps.LatLng(center.lat, center.lng));
          if (!pos) return;
          labelDiv.style.position = 'absolute';
          labelDiv.style.left = pos.x + 'px';
          labelDiv.style.top = pos.y + 'px';
          labelDiv.style.transform = 'translate(-50%, -50%)';
          labelDiv.style.zIndex = '100';
        };
        overlay.onRemove = function() { labelDiv.parentNode?.removeChild(labelDiv); };
        overlay.setMap(map);
        d.labels.push(overlay);
      });

      // Draw pending task markers
      const cores = { 'Baixa': '#94a3b8', 'Normal': '#3b82f6', 'Alta': '#f59e0b', 'Urgente': '#ef4444', 'Média': '#3b82f6' };
      const normalizar = (v) => (v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

      tarefasPendentes.forEach(t => {
        let position = null;
        if (t.coordenadas?.lat && t.coordenadas?.lng) {
          position = { lat: t.coordenadas.lat, lng: t.coordenadas.lng };
        } else if (t.area_id) {
          const area = areas.find(a => a.id === t.area_id);
          const coords = area?.coordenadas?.coords || [];
          if (coords.length >= 3) {
            const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
            position = calcCentroid(paths);
          }
        }
        if (!position) return;

        const c = cores[t.prioridade] || '#3b82f6';
        const cfg = iconesConfig.find(ic => ic.tipo_entidade === 'Prioridade Tarefa' && normalizar(ic.categoria) === normalizar(t.prioridade));
        const icon = cfg?.icone_url
          ? { url: cfg.icone_url, scaledSize: new google.maps.Size(28, 28), anchor: new google.maps.Point(14, 14) }
          : { path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z', fillColor: c, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.5, anchor: new google.maps.Point(12, 22) };

        const m = new google.maps.Marker({ position, map, icon, title: t.titulo || '', zIndex: 2500 });
        d.taskMarkers.push(m);
      });

      // Map click (outside polygons)
      const mapClickListener = map.addListener("click", (event) => {
        const latLng = event.latLng;
        const coords = { lat: latLng.lat(), lng: latLng.lng() };
        const area = findAreaAtPoint(latLng);
        handleSelect(coords, area);
      });
      d.listeners.push(mapClickListener);

      // Position map
      if (initialCoordinates) {
        if (!markerRef.current) {
          markerRef.current = new google.maps.Marker({
            map, position: initialCoordinates,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#059669", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 },
            zIndex: 9999,
          });
        } else {
          markerRef.current.setPosition(initialCoordinates);
          markerRef.current.setMap(map);
        }
        map.setCenter(initialCoordinates);
        map.setZoom(17);
      } else {
        const bounds = new google.maps.LatLngBounds();
        let hasPoints = false;
        areas.forEach(area => {
          (area.coordenadas?.coords || []).forEach(coord => {
            const lat = coord[0] || coord.lat;
            const lng = coord[1] || coord.lng;
            if (typeof lat === "number" && typeof lng === "number") { bounds.extend({ lat, lng }); hasPoints = true; }
          });
        });
        if (hasPoints) map.fitBounds(bounds, 40);
      }

      google.maps.event.trigger(map, "resize");
    });

    return () => { cancelled = true; };
  }, [open, areas, initialCoordinates, tarefasPendentes, iconesConfig, clearDrawn, findAreaAtPoint]);

  // Cleanup when dialog closes
  useEffect(() => {
    if (!open && window.google?.maps) {
      clearDrawn();
      if (markerRef.current) { markerRef.current.setMap(null); markerRef.current = null; }
    }
  }, [open, clearDrawn]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] md:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Selecionar local da tarefa</DialogTitle>
          <DialogDescription className="text-xs text-slate-500">Clique no mapa para selecionar o local.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <MapPin className="w-3.5 h-3.5" />
            Clique no ponto desejado no mapa para marcar e voltar ao formulário.
          </div>
          <div ref={mapRef} className="h-[55vh] w-full rounded-lg border border-slate-200" />
        </div>
      </DialogContent>
    </Dialog>
  );
}