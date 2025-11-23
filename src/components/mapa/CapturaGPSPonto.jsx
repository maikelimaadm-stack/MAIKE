import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

export default function CapturaGPSPonto({ onCapturar, onCancelar }) {
  const [carregando, setCarregando] = useState(false);
  const [localizacao, setLocalizacao] = useState(null);

  const capturarLocalizacao = () => {
    if (!navigator.geolocation) {
      toast.error('GPS não disponível neste dispositivo');
      return;
    }

    setCarregando(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        setLocalizacao(coords);
        setCarregando(false);
        toast.success(`📍 Localização capturada (precisão: ${coords.accuracy.toFixed(0)}m)`);
      },
      (error) => {
        setCarregando(false);
        toast.error('Erro ao capturar localização: ' + error.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  useEffect(() => {
    capturarLocalizacao();
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full">
        <h3 className="text-lg font-bold text-slate-900 mb-4">📍 Captura de Localização GPS</h3>

        {carregando && (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-600">Obtendo localização GPS...</p>
            <p className="text-xs text-slate-500 mt-2">Aguarde alguns segundos</p>
          </div>
        )}

        {localizacao && !carregando && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-5 h-5 text-emerald-600" />
                <span className="font-semibold text-emerald-900">Localização Capturada</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Latitude:</span>
                  <span className="font-mono font-semibold">{localizacao.lat.toFixed(6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Longitude:</span>
                  <span className="font-mono font-semibold">{localizacao.lng.toFixed(6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Precisão:</span>
                  <span className="font-semibold">{localizacao.accuracy.toFixed(0)}m</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={capturarLocalizacao}
                variant="outline"
                className="flex-1 h-10 text-xs"
              >
                Recapturar
              </Button>
              <Button
                onClick={() => onCapturar(localizacao)}
                className="flex-1 h-10 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                Confirmar
              </Button>
            </div>
          </div>
        )}

        <Button
          onClick={onCancelar}
          variant="ghost"
          size="sm"
          className="w-full mt-3 text-xs"
        >
          <X className="w-3 h-3 mr-1" />
          Cancelar
        </Button>
      </div>
    </div>
  );
}