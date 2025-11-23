import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, RefreshCw, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function OfflineManager() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingActions, setPendingActions] = useState([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Conexão restaurada");
      syncPendingActions();
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.error("Sem conexão - modo offline ativado");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Carregar ações pendentes
    loadPendingActions();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadPendingActions = () => {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    setPendingActions(pending);
  };

  const syncPendingActions = async () => {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    if (pending.length === 0) return;

    setSyncing(true);
    const empresaId = localStorage.getItem('empresa_selecionada_id');
    let successCount = 0;
    const failedActions = [];

    for (const action of pending) {
      try {
        if (action.type === 'suplementacao') {
          const { evento, lotes, eventoAnterior, lotesAnteriores } = action.data;
          
          // Atualizar evento anterior se existir
          if (eventoAnterior) {
            await base44.entities.SuplementacaoEvento.update(eventoAnterior.id, {
              dias_periodo: eventoAnterior.dias_periodo,
              consumo_diario_grupo_kg: eventoAnterior.consumo_diario_grupo_kg
            });

            // Atualizar lotes do evento anterior
            if (lotesAnteriores && lotesAnteriores.length > 0) {
              const allLotesSupl = await base44.entities.SuplementacaoLote.list();
              for (const loteUpdate of lotesAnteriores) {
                const loteExistente = allLotesSupl.find(l => 
                  l.suplementacao_evento_id === eventoAnterior.id && 
                  l.lote_id === loteUpdate.lote_id
                );
                if (loteExistente) {
                  await base44.entities.SuplementacaoLote.update(loteExistente.id, loteUpdate);
                }
              }
            }
          }

          // Criar novo evento
          const eventoCreated = await base44.entities.SuplementacaoEvento.create({
            ...evento,
            empresa_id: empresaId
          });
          
          // Criar lotes do novo evento
          for (const lote of lotes) {
            await base44.entities.SuplementacaoLote.create({
              ...lote,
              empresa_id: empresaId,
              suplementacao_evento_id: eventoCreated.id
            });
          }
          
          successCount++;
        } else if (action.type === 'movimentacao') {
          await base44.entities.MovimentacaoPecuaria.create({
            ...action.data,
            empresa_id: empresaId
          });
          successCount++;
        }
      } catch (error) {
        console.error('Erro ao sincronizar:', error);
        failedActions.push(action);
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} ação(ões) sincronizada(s)`);
      localStorage.setItem('pending_actions', JSON.stringify(failedActions));
      loadPendingActions();
    } else if (failedActions.length > 0) {
      toast.error('Erro ao sincronizar algumas ações');
    }

    setSyncing(false);
  };

  if (isOnline && pendingActions.length === 0) return null;

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
        </div>

        {pendingActions.length > 0 && (
          <>
            <p className="text-xs text-slate-600 mb-2">
              {pendingActions.length} ação(ões) aguardando sincronização
            </p>
            {isOnline && (
              <Button
                onClick={syncPendingActions}
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
          </>
        )}
      </div>
    </div>
  );
}