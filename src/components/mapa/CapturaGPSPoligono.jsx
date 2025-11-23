import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Trash2, Check, X, Navigation } from 'lucide-react';
import { toast } from 'sonner';

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

export default function CapturaGPSPoligono({ tipo = 'area', onSalvar, onCancelar }) {
  const [pontos, setPontos] = useState([]);
  const [localizacaoAtual, setLocalizacaoAtual] = useState(null);
  const [rastreando, setRastreando] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const watchIdRef = useRef(null);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const userMarkerRef = useRef(null);
  const pontosMarkersRef = useRef([]);
  const polygonRef = useRef(null);
  const polylineRef = useRef(null);

  const iniciarRastreamento = () => {
    if (!navigator.geolocation) {
      toast.error('GPS não disponível neste dispositivo');
      return;
    }

    setRastreando(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setLocalizacaoAtual({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: Date.now()
        });
      },
      (error) => {
        toast.error('Erro no GPS: ' + error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      }
    );
  };

  const pararRastreamento = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setRastreando(false);
  };

  useEffect(() => {
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -15.0067, lng: -59.9533 },
        zoom: 18,
        mapTypeId: 'satellite',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
        zoomControl: true,
        disableDefaultUI: false
      });

      mapInstanceRef.current = map;
      
      google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        setMapReady(true);
      });
    });

    iniciarRastreamento();
    return () => pararRastreamento();
  }, []);

  // Atualizar marcador do usuário no mapa
  useEffect(() => {
    if (!mapInstanceRef.current || !localizacaoAtual || !mapReady) return;

    // Centralizar mapa na localização
    mapInstanceRef.current.setCenter({ lat: localizacaoAtual.lat, lng: localizacaoAtual.lng });

    // Atualizar marcador do usuário
    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition({ lat: localizacaoAtual.lat, lng: localizacaoAtual.lng });
    } else {
      userMarkerRef.current = new google.maps.Marker({
        position: { lat: localizacaoAtual.lat, lng: localizacaoAtual.lng },
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        },
        title: 'Sua localização',
        zIndex: 10000
      });

      // Círculo de precisão
      new google.maps.Circle({
        map: mapInstanceRef.current,
        center: { lat: localizacaoAtual.lat, lng: localizacaoAtual.lng },
        radius: localizacaoAtual.accuracy,
        fillColor: '#4285F4',
        fillOpacity: 0.15,
        strokeColor: '#4285F4',
        strokeOpacity: 0.3,
        strokeWeight: 1,
        zIndex: 9999
      });
    }
  }, [localizacaoAtual, mapReady]);

  // Renderizar pontos e linhas no mapa
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;

    // Limpar marcadores antigos
    pontosMarkersRef.current.forEach(m => m.setMap(null));
    pontosMarkersRef.current = [];

    // Adicionar marcadores dos pontos
    pontos.forEach((ponto, idx) => {
      const marker = new google.maps.Marker({
        position: { lat: ponto.lat, lng: ponto.lng },
        map: mapInstanceRef.current,
        label: {
          text: String(idx + 1),
          color: '#ffffff',
          fontSize: '12px',
          fontWeight: 'bold'
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: tipo === 'area' ? '#10b981' : '#f59e0b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        },
        zIndex: 5000
      });
      pontosMarkersRef.current.push(marker);
    });

    // Renderizar polígono ou linha
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (tipo === 'area' && pontos.length >= 3) {
      polygonRef.current = new google.maps.Polygon({
        paths: pontos,
        strokeColor: '#10b981',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#10b981',
        fillOpacity: 0.3,
        map: mapInstanceRef.current
      });
    } else if (tipo === 'linha' && pontos.length >= 2) {
      polylineRef.current = new google.maps.Polyline({
        path: pontos,
        strokeColor: '#f59e0b',
        strokeOpacity: 1,
        strokeWeight: 4,
        map: mapInstanceRef.current
      });
    }
  }, [pontos, tipo, mapReady]);

  const adicionarPonto = () => {
    if (!localizacaoAtual) {
      toast.error('Aguarde capturar localização GPS');
      return;
    }

    const novoPonto = {
      lat: localizacaoAtual.lat,
      lng: localizacaoAtual.lng,
      accuracy: localizacaoAtual.accuracy,
      timestamp: localizacaoAtual.timestamp
    };

    setPontos([...pontos, novoPonto]);
    toast.success(`Ponto ${pontos.length + 1} marcado! 📍`);
  };

  const removerUltimoPonto = () => {
    if (pontos.length === 0) return;
    setPontos(pontos.slice(0, -1));
    toast.info('Último ponto removido');
  };

  const calcularArea = () => {
    if (pontos.length < 3) return 0;
    
    // Fórmula de área usando coordenadas geográficas (aproximação)
    let area = 0;
    for (let i = 0; i < pontos.length; i++) {
      const j = (i + 1) % pontos.length;
      area += pontos[i].lat * pontos[j].lng;
      area -= pontos[j].lat * pontos[i].lng;
    }
    area = Math.abs(area) / 2.0;
    
    // Converter para hectares (aproximação: 1 grau² ≈ 12365 km² no equador)
    return (area * 12365000000 / 10000).toFixed(2);
  };

  const calcularDistancia = () => {
    if (pontos.length < 2) return 0;
    
    let distanciaTotal = 0;
    for (let i = 0; i < pontos.length - 1; i++) {
      const p1 = pontos[i];
      const p2 = pontos[i + 1];
      
      // Fórmula de Haversine simplificada
      const R = 6371000; // Raio da Terra em metros
      const dLat = (p2.lat - p1.lat) * Math.PI / 180;
      const dLng = (p2.lng - p1.lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      distanciaTotal += R * c;
    }
    
    return (distanciaTotal / 1000).toFixed(2);
  };

  const handleSalvar = () => {
    const minimosPontos = tipo === 'area' ? 3 : 2;
    if (pontos.length < minimosPontos) {
      toast.error(`Marque pelo menos ${minimosPontos} pontos`);
      return;
    }
    pararRastreamento();
    onSalvar(pontos);
  };

  const handleCancelar = () => {
    pararRastreamento();
    onCancelar();
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {tipo === 'area' ? '📐 Captura de Área' : '📏 Captura de Linha'}
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Ande e marque pontos em cada vértice
            </p>
          </div>
          <Button onClick={handleCancelar} variant="ghost" size="icon" className="h-8 w-8">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Mapa */}
      <div className="flex-1 relative">
        <div
          ref={mapRef}
          className="w-full h-full"
        />

        {!mapReady && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        )}

        {/* Info Cards no mapa */}
        <div className="absolute top-4 left-4 right-4 flex flex-col gap-2">
          {/* Status GPS */}
          <div className={`px-4 py-2 rounded-lg shadow-lg ${rastreando ? 'bg-emerald-600' : 'bg-slate-600'} text-white`}>
            <div className="flex items-center gap-2">
              <Navigation className={`w-4 h-4 ${rastreando ? 'animate-pulse' : ''}`} />
              <div className="text-xs font-semibold">
                {rastreando ? 'GPS Ativo' : 'GPS Inativo'}
                {localizacaoAtual && ` • Precisão: ${localizacaoAtual.accuracy.toFixed(0)}m`}
              </div>
            </div>
          </div>

          {/* Contador de pontos - versão compacta */}
          <div className="bg-white/95 backdrop-blur rounded-lg shadow-xl px-4 py-2">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="text-xl font-bold text-slate-900">{pontos.length}</div>
                <div className="text-xs text-slate-600">pontos</div>
              </div>
              
              {tipo === 'area' && pontos.length >= 3 && (
                <>
                  <div className="h-4 w-px bg-slate-300"></div>
                  <div className="flex items-center gap-2">
                    <div className="text-xl font-bold text-emerald-600">{calcularArea()}</div>
                    <div className="text-xs text-slate-600">ha</div>
                  </div>
                </>
              )}
              
              {tipo === 'linha' && pontos.length >= 2 && (
                <>
                  <div className="h-4 w-px bg-slate-300"></div>
                  <div className="flex items-center gap-2">
                    <div className="text-xl font-bold text-blue-600">{calcularDistancia()}</div>
                    <div className="text-xs text-slate-600">km</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Botões de ação */}
      <div className="bg-white border-t border-slate-200 p-4 space-y-2 shadow-2xl">
        <Button
          onClick={adicionarPonto}
          disabled={!localizacaoAtual}
          className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
        >
          <MapPin className="w-6 h-6 mr-2" />
          Marcar Ponto {pontos.length + 1}
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={removerUltimoPonto}
            disabled={pontos.length === 0}
            variant="outline"
            className="h-12 text-sm"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Remover Último
          </Button>

          <Button
            onClick={handleSalvar}
            disabled={pontos.length < (tipo === 'area' ? 3 : 2)}
            className="h-12 text-sm bg-blue-600 hover:bg-blue-700"
          >
            <Check className="w-4 h-4 mr-2" />
            Confirmar ({pontos.length})
          </Button>
        </div>
      </div>
    </div>
  );
}