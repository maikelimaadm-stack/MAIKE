import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle, Database, FileText, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { getPendingCounts, initDB } from "./IndexedDBManager";
import { syncAll, addSyncListener, isSyncing } from "./SyncManager";

export default function OfflineSyncIndicator({ empresaId, onSyncComplete }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCounts, setPendingCounts] = useState({ pesagens: 0, apartacoes: 0, lotes: 0, total: 0 });
  const [syncing, setSyncing] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState("");
  const [showLogDialog, setShowLogDialog] = useState(false);
  const [syncLog, setSyncLog] = useState([]);
  const [syncStatus, setSyncStatus] = useState('idle');

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
        setSyncStatus('syncing');
        setSyncLog([]);
        setLastSyncMessage("Iniciando sincronização...");
      } else if (event.type === 'progress') {
        setLastSyncMessage(`Sincronizando ${event.entity}...`);
        if (event.item) {
          setSyncLog(prev => [...prev, {
            timestamp: new Date().toISOString(),
            type: event.entity || 'info',
            message: event.currentItem || '',
            status: event.item.status || 'pending',
            details: event.item.details
          }]);
        }
      } else if (event.type === 'complete') {
        setSyncing(false);
        setSyncStatus(event.hasErrors ? 'error' : 'success');
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
        setTimeout(() => setSyncStatus('idle'), 3000);
      } else if (event.type === 'error') {
        setSyncing(false);
        setSyncStatus('error');
        toast.error("Erro na sincronização: " + event.error);
        setSyncLog(prev => [...prev, {
          timestamp: new Date().toISOString(),
          type: 'error',
          message: event.error || 'Erro desconhecido',
          status: 'error'
        }]);
        setTimeout(() => setSyncStatus('idle'), 3000);
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

    if (isSyncing()) {
      toast.warning("Sincronização já em andamento");
      return;
    }

    setSyncing(true);
    setSyncStatus('syncing');
    setSyncLog([]);

    const result = await syncAll(empresaId);
    
    if (!result.success && result.message) {
      toast.error(result.message);
    }
  };

  const StatusIcon = () => {
    if (syncStatus === 'syncing') return <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />;
    if (syncStatus === 'success') return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
    if (syncStatus === 'error') return <AlertCircle className="w-5 h-5 text-red-600" />;
    return <Database className="w-5 h-5 text-blue-600" />;
  };

  const StatusText = () => {
    if (syncStatus === 'syncing') return 'Sincronizando...';
    if (syncStatus === 'success') return 'Sincronizado!';
    if (syncStatus === 'error') return 'Erro na sincronização';
    return `${pendingCounts.total} pendente(s)`;
  };

  if (pendingCounts.total === 0 && syncStatus === 'idle') return null;

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50">
        <Card className={`shadow-lg border-2 p-3 transition-colors ${
          syncStatus === 'syncing' ? 'bg-blue-50 border-blue-500' :
          syncStatus === 'success' ? 'bg-emerald-50 border-emerald-500' :
          syncStatus === 'error' ? 'bg-red-50 border-red-500' :
          'bg-white border-blue-500'
        }`}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <StatusIcon />
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  <StatusText />
                </div>
                {pendingCounts.total > 0 && syncStatus === 'idle' && (
                  <div className="text-[10px] text-slate-500">
                    {pendingCounts.pesagens} pesagens • {pendingCounts.sanidade || 0} sanidade • {pendingCounts.updates || 0} edições
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex gap-1">
              {syncLog.length > 0 && (
                <Button 
                  onClick={() => setShowLogDialog(true)} 
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Log
                </Button>
              )}
              
              {isOnline && pendingCounts.total > 0 && (
                <Button 
                  onClick={handleSync} 
                  disabled={syncing}
                  size="sm"
                  className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  Sincronizar
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Dialog open={showLogDialog} onOpenChange={setShowLogDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Log de Sincronização Detalhado
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto">
            {syncLog.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhum log de sincronização disponível</p>
                <p className="text-xs mt-1">Inicie uma sincronização para ver o histórico</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-10">Status</TableHead>
                    <TableHead className="text-xs">Tipo</TableHead>
                    <TableHead className="text-xs">Mensagem</TableHead>
                    <TableHead className="text-xs w-24">Horário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncLog.map((log, idx) => (
                    <TableRow key={idx} className={
                      log.status === 'success' ? 'bg-emerald-50' :
                      log.status === 'error' ? 'bg-red-50' :
                      log.status === 'skip' ? 'bg-amber-50' :
                      ''
                    }>
                      <TableCell className="text-xs">
                        {log.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                        {log.status === 'error' && <XCircle className="w-4 h-4 text-red-600" />}
                        {log.status === 'skip' && <AlertCircle className="w-4 h-4 text-amber-600" />}
                        {log.status === 'pending' && <Clock className="w-4 h-4 text-blue-600 animate-pulse" />}
                      </TableCell>
                      <TableCell className="text-xs font-medium">{log.type || '-'}</TableCell>
                      <TableCell className="text-xs">{log.message || log.details || '-'}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('pt-BR') : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="flex justify-between items-center pt-3 border-t">
            <div className="text-xs text-slate-600">
              <span className="font-semibold">Total:</span> {syncLog.length} eventos | 
              <span className="text-emerald-600 ml-2">✓ {syncLog.filter(l => l.status === 'success').length}</span> | 
              <span className="text-red-600 ml-1">✗ {syncLog.filter(l => l.status === 'error').length}</span> | 
              <span className="text-amber-600 ml-1">⊘ {syncLog.filter(l => l.status === 'skip').length}</span>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setSyncLog([])}
                className="h-7 text-xs"
              >
                Limpar Log
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowLogDialog(false)}
                className="h-7 text-xs"
              >
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}