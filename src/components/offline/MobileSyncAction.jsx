import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getPendingCounts } from "@/components/offline/IndexedDBManager";
import { base44 } from "@/api/base44Client";
import { getOfflineSyncEventName, syncOfflineEntityQueue } from "@/lib/offlineEntitySync";
import { syncAll } from "@/components/offline/SyncManager";

export default function MobileSyncAction({ onAfterSync }) {
  const [syncing, setSyncing] = useState(false);
  const [pendingTotal, setPendingTotal] = useState(0);

  const loadPending = async () => {
    const legacy = await getPendingCounts().catch(() => ({ total: 0 }));
    setPendingTotal(legacy?.total || 0);
  };

  useEffect(() => {
    loadPending();
    const reload = () => loadPending();
    window.addEventListener("online", reload);
    window.addEventListener("offline", reload);
    window.addEventListener("offline-sync-requested", reload);
    window.addEventListener(getOfflineSyncEventName(), reload);
    return () => {
      window.removeEventListener("online", reload);
      window.removeEventListener("offline", reload);
      window.removeEventListener("offline-sync-requested", reload);
      window.removeEventListener(getOfflineSyncEventName(), reload);
    };
  }, []);

  const handleSync = async () => {
    if (!navigator.onLine) {
      toast.warning("Sem conexão para sincronizar.");
      return;
    }

    setSyncing(true);

    try {
      const empresaId = localStorage.getItem("empresa_selecionada_id");
      const genericResult = await syncOfflineEntityQueue(base44);

      if (empresaId) {
        const legacyResult = await syncAll(empresaId);
        if (legacyResult?.success === false && legacyResult?.message) {
          toast.error(legacyResult.message);
        }
        window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      }

      window.dispatchEvent(new CustomEvent("offline-sync-requested"));
      await loadPending();
      onAfterSync?.();

      if (genericResult?.success === false && genericResult?.message) {
        toast.error(genericResult.message);
        return;
      }

      toast.success("Sincronização iniciada.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mt-4 px-2">
      <Button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="w-full h-9 text-xs bg-emerald-600 hover:bg-emerald-700"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Sincronizando..." : `Sincronizar${pendingTotal > 0 ? ` (${pendingTotal})` : ""}`}
      </Button>
    </div>
  );
}