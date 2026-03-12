import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Download, Smartphone, X } from "lucide-react";

const DISMISS_KEY = "pwa_install_dismissed_at";
const DISMISS_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

const isStandalone = () => {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
};

export default function PWAInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      return undefined;
    }

    let onlineHandler;
    let messageHandler;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }

          registration.addEventListener("updatefound", () => {
            const installingWorker = registration.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener("statechange", () => {
              if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
                installingWorker.postMessage({ type: "SKIP_WAITING" });
              }
            });
          });

          onlineHandler = async () => {
            if ("sync" in registration) {
              await registration.sync.register("sync-data");
            }
          };

          window.addEventListener("online", onlineHandler);
        })
        .catch((error) => console.error("Erro ao registrar service worker:", error));

      messageHandler = (event) => {
        if (event.data?.type === "TRIGGER_SYNC") {
          window.dispatchEvent(new CustomEvent("offline-sync-requested"));
        }
      };

      navigator.serviceWorker.addEventListener("message", messageHandler);
    }

    const beforeInstallHandler = (event) => {
      event.preventDefault();
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);

      if (dismissedAt && Date.now() - dismissedAt < DISMISS_WINDOW_MS) {
        return;
      }

      setDeferredPrompt(event);
      setShowInstall(true);
    };

    const installedHandler = () => {
      setDeferredPrompt(null);
      setShowInstall(false);
      localStorage.removeItem(DISMISS_KEY);
    };

    window.addEventListener("beforeinstallprompt", beforeInstallHandler);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstallHandler);
      window.removeEventListener("appinstalled", installedHandler);
      if (onlineHandler) {
        window.removeEventListener("online", onlineHandler);
      }
      if (messageHandler) {
        navigator.serviceWorker.removeEventListener("message", messageHandler);
      }
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome !== "accepted") {
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    }

    setDeferredPrompt(null);
    setShowInstall(false);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setShowInstall(false);
  };

  if (!showInstall || !deferredPrompt || isStandalone()) {
    return null;
  }

  return (
    <Card className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 border-2 border-emerald-500 p-4 shadow-2xl">
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-2 text-slate-400 transition-colors hover:text-slate-600"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100">
          <Smartphone className="h-6 w-6 text-emerald-600" />
        </div>

        <div className="flex-1">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Instalar aplicativo</h3>
          <p className="mb-3 text-xs text-slate-600">
            Abra mesmo sem internet, com acesso rápido e sincronização automática.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleInstall} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Download className="h-3.5 w-3.5" />
              Instalar
            </Button>
            <Button onClick={handleDismiss} variant="outline" size="sm" className="h-8 text-xs">
              Agora não
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}