import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, MapPin } from "lucide-react";
import { toast } from "sonner";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

export default function SelecaoPontosMapa({ onClose, onConfirmSelection, initialPoints = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const [ready, setReady] = useState(false);
  const [pontos, setPontos] = useState(initialPoints);

  useEffect(() => {
    const load = () => new Promise((resolve, reject) => {
      if (window.google?.maps) return resolve();
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    load().then(() => setReady(true)).catch(() => toast.error("Erro ao carregar mapa"));
  }, []);

  useEffect(() => {
    if (!ready || mapInstanceRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: -15.0067, lng: -59.9533 },
      zoom: 15,
      mapTypeId: "satellite",
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: "greedy",
      clickableIcons: false,
    });

    map.addListener("click", (event) => {
      const novoPonto = {
        id: crypto.randomUUID(),
        lat: Number(event.latLng.lat().toFixed(6)),
        lng: Number(event.latLng.lng().toFixed(6)),
      };
      setPontos((prev) => [...prev, novoPonto]);
    });

    mapInstanceRef.current = map;
  }, [ready]);

  useEffect(() => {
    if (!mapInstanceRef.current || !ready) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();

    pontos.forEach((ponto, index) => {
      const marker = new google.maps.Marker({
        position: { lat: ponto.lat, lng: ponto.lng },
        map: mapInstanceRef.current,
        draggable: true,
        label: {
          text: String(index + 1),
          color: "#ffffff",
          fontSize: "11px",
          fontWeight: "700",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#16a34a",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      marker.addListener("dragend", (event) => {
        const lat = Number(event.latLng.lat().toFixed(6));
        const lng = Number(event.latLng.lng().toFixed(6));
        setPontos((prev) => prev.map((item) => item.id === ponto.id ? { ...item, lat, lng } : item));
      });

      marker.addListener("dblclick", () => {
        setPontos((prev) => prev.filter((item) => item.id !== ponto.id));
      });

      markersRef.current.push(marker);
      bounds.extend({ lat: ponto.lat, lng: ponto.lng });
    });

    if (pontos.length) {
      mapInstanceRef.current.fitBounds(bounds, 60);
      const zoom = mapInstanceRef.current.getZoom?.();
      if (typeof zoom === "number" && zoom > 19) mapInstanceRef.current.setZoom(19);
    }
  }, [pontos, ready]);

  return (
    <div className="fixed inset-0 z-[60] bg-white">
      <div ref={mapRef} className="absolute inset-0" />

      <Button onClick={onClose} variant="secondary" size="icon" className="absolute top-4 left-4 z-20 h-10 w-10 bg-white/90">
        <X className="w-5 h-5 text-slate-700" />
      </Button>

      <div className="absolute top-4 right-4 z-20 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
        Clique no mapa para adicionar pontos e dê duplo clique num ponto para remover
      </div>

      <div className="absolute bottom-4 left-4 z-20 w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border bg-white/95 shadow-sm">
        <div className="border-b px-3 py-2">
          <div className="text-xs font-semibold text-slate-900 uppercase">Pontos selecionados</div>
        </div>
        <div className="max-h-[220px] overflow-y-auto p-2 space-y-1">
          {pontos.length === 0 ? (
            <div className="text-xs text-slate-500 px-1 py-2">Nenhum ponto marcado ainda.</div>
          ) : (
            pontos.map((ponto, index) => (
              <div key={ponto.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-800">Ponto {index + 1}</div>
                  <div className="text-[11px] text-slate-500 truncate">{ponto.lat}, {ponto.lng}</div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPontos((prev) => prev.filter((item) => item.id !== ponto.id))}>
                  <X className="w-3.5 h-3.5 text-slate-500" />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-3 py-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancelar</Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => {
              if (!pontos.length) {
                toast.error("Marque pelo menos um ponto no mapa");
                return;
              }
              onConfirmSelection?.(pontos);
            }}
          >
            <MapPin className="w-3.5 h-3.5" />
            Usar pontos marcados
          </Button>
        </div>
      </div>
    </div>
  );
}