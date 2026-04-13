/* global google */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { X, MapPin, Check } from "lucide-react";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const loadGoogleMapsScript = () => {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
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
};

const applyMarkerIconPreservingAspectRatio = (marker, iconUrl, baseSize = 42) => {
  if (!marker || !iconUrl || !window.google?.maps) return;
  const image = new Image();
  image.onload = () => {
    const w = image.naturalWidth || baseSize;
    const h = image.naturalHeight || baseSize;
    const ratio = w / h;
    const width = ratio >= 1 ? baseSize : Math.max(20, Math.round(baseSize * ratio));
    const height = ratio >= 1 ? Math.max(20, Math.round(baseSize / ratio)) : baseSize;
    marker.setIcon({
      url: iconUrl,
      scaledSize: new google.maps.Size(width, height),
      anchor: new google.maps.Point(width / 2, height / 2)
    });
  };
  image.src = iconUrl;
};

export default function SelecaoDepositoMapa({ cochoCoords, depositoSelecionadoId, onSelect, onClose }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const lineRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [hoveredDepositoId, setHoveredDepositoId] = useState(depositoSelecionadoId || null);

  const { data: pontosSuplementacao = [] } = useQuery({
    queryKey: ["pontos-suplementacao-mapa-selecao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: pontosReferencia = [] } = useQuery({
    queryKey: ["pontos-referencia-mapa-selecao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoReferencia.list();
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const depositos = useMemo(() => {
    return pontosSuplementacao
      .filter((ponto) => normalizeText(ponto.categoria_ponto) === "DEPOSITO" && ponto.coordenadas?.lat && ponto.coordenadas?.lng)
      .map((deposito) => {
        const referencia = pontosReferencia.find((ponto) => {
          const mesmoNome = normalizeText(ponto.nome || "") === normalizeText(deposito.nome_ponto || "");
          const mesmaSigla = deposito.sigla && normalizeText(ponto.sigla || "") === normalizeText(deposito.sigla || "");
          return mesmoNome || mesmaSigla;
        });
        return {
          ...deposito,
          icone_url: referencia?.icone_url || null
        };
      });
  }, [pontosSuplementacao, pontosReferencia]);

  const depositoEmDestaque = depositos.find((item) => item.id === (hoveredDepositoId || depositoSelecionadoId)) || null;

  useEffect(() => {
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;
      const map = new google.maps.Map(mapRef.current, {
        center: cochoCoords || { lat: -15.0067, lng: -59.9533 },
        zoom: 18,
        mapTypeId: "satellite",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
        clickableIcons: false
      });
      mapInstanceRef.current = map;
      google.maps.event.addListenerOnce(map, "tilesloaded", () => setMapReady(true));
    });

    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      if (lineRef.current) {
        lineRef.current.setMap(null);
        lineRef.current = null;
      }
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, [cochoCoords]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    if (cochoCoords?.lat && cochoCoords?.lng) bounds.extend(cochoCoords);

    if (cochoCoords?.lat && cochoCoords?.lng) {
      const cochoMarker = new google.maps.Marker({
        position: cochoCoords,
        map,
        zIndex: 3000,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#16a34a",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2
        }
      });
      markersRef.current.push(cochoMarker);
    }

    depositos.forEach((deposito) => {
      const isSelected = deposito.id === depositoSelecionadoId;
      const isHovered = deposito.id === hoveredDepositoId;
      const marker = new google.maps.Marker({
        position: deposito.coordenadas,
        map,
        title: deposito.nome_ponto,
        zIndex: isSelected || isHovered ? 2500 : 2000,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isSelected || isHovered ? 10 : 8,
          fillColor: isSelected ? "#2563eb" : isHovered ? "#f59e0b" : "#dc2626",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2
        }
      });

      if (deposito.icone_url) {
        applyMarkerIconPreservingAspectRatio(marker, deposito.icone_url, isSelected || isHovered ? 50 : 42);
      }

      marker.addListener("click", () => onSelect(deposito.id));
      marker.addListener("mouseover", () => setHoveredDepositoId(deposito.id));
      marker.addListener("mouseout", () => setHoveredDepositoId((prev) => prev === deposito.id ? depositoSelecionadoId || null : prev));
      markersRef.current.push(marker);
      bounds.extend(deposito.coordenadas);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 70, right: 40, bottom: 40, left: 40 });
      const zoomAtual = map.getZoom?.();
      if (typeof zoomAtual === "number" && zoomAtual > 19) map.setZoom(19);
    }
  }, [depositos, cochoCoords, depositoSelecionadoId, hoveredDepositoId, mapReady, onSelect]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    if (lineRef.current) {
      lineRef.current.setMap(null);
      lineRef.current = null;
    }

    if (!cochoCoords?.lat || !cochoCoords?.lng || !depositoEmDestaque?.coordenadas?.lat || !depositoEmDestaque?.coordenadas?.lng) return;

    lineRef.current = new google.maps.Polyline({
      path: [cochoCoords, depositoEmDestaque.coordenadas],
      strokeColor: "#f59e0b",
      strokeOpacity: 0.9,
      strokeWeight: 2,
      icons: [{
        icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: "#ffffff", scale: 3 },
        offset: "0",
        repeat: "12px"
      }]
    });
    lineRef.current.setMap(mapInstanceRef.current);
  }, [cochoCoords, depositoEmDestaque, mapReady]);

  const distanciaMetros = useMemo(() => {
    if (!window.google?.maps?.geometry?.spherical || !cochoCoords?.lat || !cochoCoords?.lng || !depositoEmDestaque?.coordenadas?.lat || !depositoEmDestaque?.coordenadas?.lng) {
      return null;
    }
    return google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(cochoCoords.lat, cochoCoords.lng),
      new google.maps.LatLng(depositoEmDestaque.coordenadas.lat, depositoEmDestaque.coordenadas.lng)
    );
  }, [cochoCoords, depositoEmDestaque]);

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div className="relative h-full w-full">
        <div ref={mapRef} className="h-full w-full bg-slate-200" />

        <Button onClick={onClose} variant="secondary" size="icon" className="absolute top-4 left-4 z-20 h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white">
          <X className="w-6 h-6 text-slate-700" />
        </Button>

        <div className="absolute top-4 right-4 z-20 w-[280px] rounded-xl border bg-white/95 p-3 shadow-xl backdrop-blur-sm space-y-2">
          <div>
            <p className="text-xs font-bold text-slate-900 uppercase">Selecionar depósito no mapa</p>
            <p className="text-[11px] text-slate-600">Clique em um depósito para vincular ao cocho.</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs space-y-1">
            <div className="flex items-center gap-2 text-slate-700"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Cocho</div>
            <div className="flex items-center gap-2 text-slate-700"><span className="h-2 w-2 rounded-full bg-red-600" /> Depósitos</div>
            <div className="flex items-center gap-2 text-slate-700"><span className="h-2 w-2 rounded-full bg-blue-600" /> Selecionado</div>
          </div>

          {depositoEmDestaque && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs space-y-1">
              <div className="font-semibold text-amber-900">{depositoEmDestaque.nome_ponto}</div>
              {distanciaMetros !== null && (
                <div className="text-amber-800">Distância: {distanciaMetros.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m</div>
              )}
            </div>
          )}
        </div>

        <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-white/95 px-3 py-2 shadow-xl backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancelar</Button>
            <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!depositoSelecionadoId} onClick={onClose}>
              <Check className="w-3.5 h-3.5 mr-1.5" /> Confirmado
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}