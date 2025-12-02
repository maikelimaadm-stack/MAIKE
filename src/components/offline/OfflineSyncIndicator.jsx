import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle, Database } from "lucide-react";
import { toast } from "sonner";
import { getPendingCounts, initDB } from "./IndexedDBManager";
import { syncAll, addSyncListener } from "./SyncManager";

export default function OfflineSyncIndicator({ empresaId, onSyncComplete }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCounts, setPendingCounts] = useState({ pesagens: 0, apartacoes: 0, lotes: 0, total: 0 });
  const [syncing, setSyncing] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState("");

  useEffect(() => {
    // Inicializar IndexedDB
    initDB().catch(console.error);

    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Conexão restaurada!");
      updatePendingCounts();
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning("Modo offline ativado");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listener para atualizações de sincronização
    const unsubscribe = addSyncListener((event) => {
      if (event.type === 'start') {
        setSyncing(true);
        setLastSyncMessage("Iniciando sincronização...");
      } else if (event.type === 'progress') {
        setLastSyncMessage(`Sincronizando ${event.entity}...`);
      } else if (event.type === 'complete') {
        setSyncing(false);
        setLastSyncMessage(event.message);
        updatePendingCounts();
        if (event.success && onSyncComplete) {
          onSyncComplete();
        }
        if (event.results) {
          const total = event.results.pesagens.successCount + 
                        event.results.apartacoes.successCount + 
                        event.results.lotes.successCount;
          if (total > 0) {
            toast.success(`✅ ${total} registro(s) sincronizado(s)!`);
          }
        }
      } else if (event.type === 'error') {
        setSyncing(false);
        toast.error("Erro na sincronização: " + event.error);
      }
    });

    updatePendingCounts();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [onSyncComplete]);

  const updatePendingCounts = async () => {
    try {
      const counts = await getPendingCounts();
      setPendingCounts(counts);
    } catch (error) {
      console.error('Erro ao obter contagem de pendentes:', error);
    }
  };

  const handleSync = async () => {
    if (!empresaId) {
      toast.error("Empresa não selecionada");
      return;
    }

    if (!navigator.onLine) {
      toast.error("Sem conexão com a internet");
      return;
    }

    if (syncing) {
      toast.warning("Sincronização já em andamento");
      return;
    }

    setSyncing(true);
    const result = await syncAll(empresaId);
    setSyncing(false);
    
    if (!result.success && result.message) {
      toast.error(result.message);
    }
  };

  // Não mostrar se está online e não tem pendentes
  if (isOnline && pendingCounts.total === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-white rounded-lg shadow-lg border-2 border-slate-200 p-3 max-w-xs">
        <div className="flex items-center gap-2 mb-2">
          {isOnline ? (
            <>
              <Wifi className="w-4 h-4 text-emerald-600" />
              <Badge className="bg-emerald-100 text-emerald-800 text-xs">Online</Badge>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-amber-600" />
              <Badge className="bg-amber-100 text-amber-800 text-xs">Offline</Badge>
            </>
          )}
          <Database className="w-4 h-4 text-blue-500 ml-auto" title="Dados salvos localmente (IndexedDB)" />
        </div>

        {pendingCounts.total > 0 && (
          <>
            <div className="text-xs text-slate-600 mb-2 space-y-1">
              <p className="font-medium">Pendentes para sincronizar:</p>
              {pendingCounts.pesagens > 0 && (
                <p>• {pendingCounts.pesagens} pesagem(ns)</p>
              )}
              {pendingCounts.apartacoes > 0 && (
                <p>• {pendingCounts.apartacoes} apartação(ões)</p>
              )}
              {pendingCounts.lotes > 0 && (
                <p>• {pendingCounts.lotes} lote(s)</p>
              )}
            </div>
            
            {syncing && (
              <p className="text-xs text-blue-600 mb-2">{lastSyncMessage}</p>
            )}

            {isOnline && (
              <Button
                onClick={handleSync}
                size="sm"
                disabled={syncing}
                className="h-7 text-xs w-full bg-emerald-600 hover:bg-emerald-700"
              >
                {syncing ? (
                  <>
                    <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Sincronizar Agora
                  </>
                )}
              </Button>
            )}

            {!isOnline && (
              <div className="flex items-center gap-1 text-xs text-amber-600">
                <AlertCircle className="w-3 h-3" />
                <span>Aguardando conexão...</span>
              </div>
            )}
          </>
        )}

        {pendingCounts.total === 0 && !isOnline && (
          <p className="text-xs text-slate-500">
            Seus dados estão salvos localmente e serão sincronizados quando a conexão voltar.
          </p>
        )}
      </div>
    </div>
  );
}