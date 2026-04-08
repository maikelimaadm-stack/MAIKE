import React, { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin } from "lucide-react";
import useMapRenderer from "./useMapRenderer";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";
let googleMapsPromise = null;

const loadGoogleMapsScript = () => {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);
      return;
    }

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

const getAreaBounds = (areas) => {
  const bounds = new google.maps.LatLngBounds();
  let hasPoints = false;

  areas.forEach((area) => {
    (area.coordenadas?.coords || []).forEach((coord) => {
      const lat = coord[0] || coord.lat;
      const lng = coord[1] || coord.lng;
      if (typeof lat === "number" && typeof lng === "number") {
        bounds.extend({ lat, lng });
        hasPoints = true;
      }
    });
  });

  return hasPoints ? bounds : null;
};

export default function TaskLocationPickerDialog({ open, onOpenChange, areas = [], initialCoordinates, onSelect }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const clickListenerRef = useRef(null);
  const selectingRef = useRef(false);
  const polygonClickListenersRef = useRef([]);
  const renderer = useMapRenderer(mapInstanceRef);

  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: tarefasPendentes = [] } = useQuery({
    queryKey: ["tarefas-picker-pendentes", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list("-updated_date");
      return all.filter(
        (t) => t.empresa_id === empresaSelecionadaId && (t.status === "Pendente" || t.status === "Em Andamento")
      );
    },
    enabled: open && !!empresaSelecionadaId,
    initialData: []
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["icones-config-picker", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((i) => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: open && !!empresaSelecionadaId,
    initialData: []
  });

  useEffect(() => {
    if (!open) return;

    loadGoogleMapsScript().then(() => {
      if (!mapRef.current) return;

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

      // Clean up old polygon click listeners
      polygonClickListenersRef.current.forEach((l) => google.maps.event.removeListener(l));
      polygonClickListenersRef.current = [];
      if (clickListenerRef.current) clickListenerRef.current.remove();

      const selectPoint = (coords, area = null) => {
        if (selectingRef.current) return;
        selectingRef.current = true;

        if (!markerRef.current) {
          markerRef.current = new google.maps.Marker({
            map,
            position: coords,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#059669",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
          });
        } else {
          markerRef.current.setPosition(coords);
          markerRef.current.setMap(map);
        }

        map.panTo(coords);
        window.setTimeout(() => {
          onSelect?.(coords, area);
          onOpenChange(false);
          selectingRef.current = false;
        }, 120);
      };

      // Use renderer to draw areas with proper colors and labels
      const noop = () => {};
      renderer.syncAreas(areas, true, (area, coords) => {
        if (coords) selectPoint(coords, area);
      }, noop, null);

      renderer.syncLabels(areas, true, null, true);

      // Draw pending tasks
      renderer.syncTarefas(tarefasPendentes, areas, iconesConfig, noop);

      // Add click listener on map for clicking outside areas
      clickListenerRef.current = map.addListener("click", (event) => {
        const coords = { lat: event.latLng.lat(), lng: event.latLng.lng() };
        // Find if clicked inside an area polygon
        const point = new google.maps.LatLng(coords.lat, coords.lng);
        let foundArea = null;
        for (const area of areas) {
          const areaCoords = area.coordenadas?.coords || [];
          if (areaCoords.length < 3) continue;
          const path = areaCoords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
          const polygon = new google.maps.Polygon({ paths: path });
          if (google.maps.geometry.poly.containsLocation(point, polygon)) {
            foundArea = area;
            break;
          }
        }
        selectPoint(coords, foundArea);
      });

      // Position map
      if (initialCoordinates) {
        if (!markerRef.current) {
          markerRef.current = new google.maps.Marker({
            map,
            position: initialCoordinates,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#059669",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
          });
        } else {
          markerRef.current.setPosition(initialCoordinates);
          markerRef.current.setMap(map);
        }
        map.setCenter(initialCoordinates);
        map.setZoom(17);
      } else {
        const bounds = getAreaBounds(areas);
        if (bounds) map.fitBounds(bounds, 40);
      }

      google.maps.event.trigger(map, "resize");
    });

    return () => {
      // Cleanup on close
      if (clickListenerRef.current) {
        clickListenerRef.current.remove();
        clickListenerRef.current = null;
      }
    };
  }, [open, areas, initialCoordinates, onOpenChange, onSelect, tarefasPendentes, iconesConfig]);

  // Cleanup renderer when dialog closes
  useEffect(() => {
    if (!open) {
      renderer.clearAll();
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] md:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Selecionar local da tarefa</DialogTitle>
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