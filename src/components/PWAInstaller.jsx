import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Download, X, Smartphone } from "lucide-react";

export default function PWAInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('✅ Service Worker registrado', reg))
        .catch((err) => console.error('❌ Erro ao registrar SW:', err));
    }

    // Capturar evento de instalação
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      
      // Verificar se já foi instalado
      const isInstalled = localStorage.getItem('pwa-installed');
      if (!isInstalled) {
        setShowInstall(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Detectar se já está instalado
    if (window.matchMedia('(display-mode: standalone)').matches) {
      localStorage.setItem('pwa-installed', 'true');
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('✅ PWA instalado');
      localStorage.setItem('pwa-installed', 'true');
    }

    setDeferredPrompt(null);
    setShowInstall(false);
  };

  const handleDismiss = () => {
    setShowInstall(false);
    localStorage.setItem('pwa-dismissed', Date.now().toString());
  };

  if (!showInstall) return null;

  return (
    <Card className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 p-4 shadow-2xl border-2 border-emerald-500 animate-in slide-in-from-bottom">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 text-slate-400 hover:text-slate-600"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
            <Smartphone className="w-6 h-6 text-emerald-600" />
          </div>
        </div>

        <div className="flex-1">
          <h3 className="font-semibold text-sm text-slate-900 mb-1">
            Instalar App no seu dispositivo
          </h3>
          <p className="text-xs text-slate-600 mb-3">
            Use offline, acesso rápido e sincronização automática de dados
          </p>

          <div className="flex gap-2">
            <Button
              onClick={handleInstall}
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
            >
              <Download className="w-3 h-3 mr-1" />
              Instalar
            </Button>
            <Button
              onClick={handleDismiss}
              size="sm"
              variant="outline"
              className="h-8 text-xs"
            >
              Agora não
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}