import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Trash2, Check, X, Navigation } from 'lucide-react';
import { toast } from 'sonner';

export default function CapturaGPSPoligono({ tipo = 'area', onSalvar, onCancelar }) {
  const [pontos, setPontos] = useState([]);
  const [localizacaoAtual, setLocalizacaoAtual] = useState(null);
  const [rastreando, setRastreando] = useState(false);
  const watchIdRef = useRef(null);

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
    iniciarRastreamento();
    return () => pararRastreamento();
  }, []);

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
      <div className="bg-white border-b border-slate-200 p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {tipo === 'area' ? '📐 Captura de Área' : '📏 Captura de Linha'}
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Ande pelo perímetro e clique em "Marcar Ponto" em cada vértice
            </p>
          </div>
          <Button onClick={handleCancelar} variant="ghost" size="icon">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 space-y-4">
        {/* Status GPS */}
        <div className={`px-6 py-4 rounded-xl shadow-lg ${rastreando ? 'bg-emerald-600' : 'bg-slate-600'} text-white`}>
          <div className="flex items-center gap-3">
            <Navigation className={`w-6 h-6 ${rastreando ? 'animate-pulse' : ''}`} />
            <div>
              <div className="font-bold">
                {rastreando ? 'GPS Ativo' : 'GPS Inativo'}
              </div>
              {localizacaoAtual && (
                <div className="text-xs opacity-90 mt-1">
                  Precisão: {localizacaoAtual.accuracy.toFixed(0)}m
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contador de pontos */}
        <div className="bg-white rounded-xl shadow-2xl p-6 text-center min-w-[300px]">
          <div className="text-6xl font-bold text-slate-900 mb-2">
            {pontos.length}
          </div>
          <div className="text-sm text-slate-600">
            {tipo === 'area' ? 'Pontos Marcados' : 'Pontos da Linha'}
          </div>
          
          {tipo === 'area' && pontos.length >= 3 && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-xs text-slate-600 mb-1">Área Aproximada</div>
              <div className="text-2xl font-bold text-emerald-600">{calcularArea()} ha</div>
            </div>
          )}
          
          {tipo === 'linha' && pontos.length >= 2 && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-xs text-slate-600 mb-1">Distância Total</div>
              <div className="text-2xl font-bold text-blue-600">{calcularDistancia()} km</div>
            </div>
          )}
        </div>

        {/* Lista de pontos */}
        {pontos.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-4 max-w-md w-full max-h-40 overflow-y-auto">
            {pontos.map((ponto, idx) => (
              <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-semibold">Ponto {idx + 1}</span>
                </div>
                <span className="text-xs text-slate-500 font-mono">
                  {ponto.lat.toFixed(6)}, {ponto.lng.toFixed(6)}
                </span>
              </div>
            ))}
          </div>
        )}
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