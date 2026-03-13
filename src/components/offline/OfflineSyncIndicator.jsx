import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, CheckCircle2, Clock, Copy, Download, FileText, RefreshCw, Wifi, WifiOff, XCircle } from "lucide-react";
import { toast } from "sonner";
import { getPendingCounts, initDB } from "./IndexedDBManager";
import { addSyncListener, isSyncing, syncAll } from "./SyncManager";

export default function OfflineSyncIndicator({ empresaId, onSyncComplete }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCounts, setPendingCounts] = useState({
    pesagens: 0,
    apartacoes: 0,
    lotes: 0,
    embarques: 0,
    documentos: 0,
    sanidade: 0,
    updates: 0,
    total: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [showLogDialog, setShowLogDialog] = useState(false);
  const [syncLog, setSyncLog] = useState([]);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [lastSyncMessage, setLastSyncMessage] = useState("");

  const updatePendingCounts = async () => {
    try {
      const counts = await getPendingCounts();
      setPendingCounts(counts);
      return counts;
    } catch (error) {
      console.error("Erro ao obter contagem de pendentes:", error);
      return pendingCounts;
    }
  };

  const handleSync = async ({ silent = false } = {}) => {
    if (!empresaId || !navigator.onLine || isSyncing()) {
      return;
    }

    if (!silent) {
      setShowLogDialog(true);
    }

    const result = await syncAll(empresaId);

    if (!result.success && result.message && !silent) {
      toast.error(result.message);
    }
  };

  useEffect(() => {
    initDB().catch(console.error);

    const requestSync = () => {
      if (empresaId && navigator.onLine && !isSyncing()) {
        handleSync({ silent: true });
      }
    };

    const handleOnline = async () => {
      setIsOnline(true);
      toast.success("Conexão restaurada");
      const counts = await updatePendingCounts();
      if (counts.total > 0) {
        setTimeout(requestSync, 1200);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus("idle");
      toast.warning("Modo offline ativado");
    };

    const unsubscribe = addSyncListener((event) => {
      if (event.type === "start") {
        setSyncing(true);
        setSyncStatus("syncing");
        setSyncLog([]);
        setLastSyncMessage("Iniciando sincronização...");
      } else if (event.type === "progress") {
        setLastSyncMessage(event.phaseLabel || `Sincronizando ${event.entity}...`);
        if (event.item) {
          setSyncLog((prev) => [
            ...prev,
            {
              timestamp: new Date().toISOString(),
              type: event.phaseLabel || event.entity || "info",
              message: event.currentItem || event.item.name || "",
              status: event.item.status || "pending",
              details: event.item.message || event.item.details,
            },
          ]);
        }
      } else if (event.type === "complete") {
        setSyncing(false);
        setSyncStatus(event.hasErrors ? "error" : "success");
        setLastSyncMessage(event.message || "Sincronização concluída");
        updatePendingCounts();

        if (event.success && onSyncComplete) {
          onSyncComplete();
        }

        if (event.results) {
          const total = (event.results.pesagens?.successCount || 0) +
            (event.results.apartacoes?.successCount || 0) +
            (event.results.embarques_docs?.successCount || 0) +
            (event.results.sanidade?.successCount || 0) +
            (event.results.updates?.successCount || 0);

          if (total > 0) {
            toast.success(`${total} registro(s) sincronizado(s)`);
          }
        }

        setTimeout(() => setSyncStatus("idle"), 3000);
      } else if (event.type === "error") {
        setSyncing(false);
        setSyncStatus("error");
        toast.error(`Erro na sincronização: ${event.error}`);
        setSyncLog((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            type: "error",
            message: event.error || "Erro desconhecido",
            status: "error",
          },
        ]);
        setTimeout(() => setSyncStatus("idle"), 5000);
      }
    });

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("offline-sync-requested", requestSync);

    updatePendingCounts().then((counts) => {
      if (empresaId && navigator.onLine && counts.total > 0) {
        setTimeout(requestSync, 800);
      }
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("offline-sync-requested", requestSync);
      unsubscribe();
    };
  }, [empresaId, onSyncComplete]);

  const errorLogItems = useMemo(() => syncLog.filter((item) => item.status === "error"), [syncLog]);
  const errorLogReport = useMemo(
    () => errorLogItems.map((item, index) => `${index + 1}. ${item.message || item.type || "Erro"}\nMotivo: ${item.details || item.message || "Sem detalhe"}`).join("\n\n"),
    [errorLogItems]
  );

  const handleCopyErrors = async () => {
    if (!errorLogReport) return;
    await navigator.clipboard.writeText(errorLogReport);
    toast.success("Erros copiados");
  };

  const handleExportErrors = () => {
    if (!errorLogReport) return;
    const blob = new Blob([errorLogReport], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "erros_sincronizacao_pesagens.txt";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Erros exportados");
  };

  const statusMeta = useMemo(() => {
    if (syncing || syncStatus === "syncing") {
      return {
        label: "Sincronizando",
        description: lastSyncMessage || "Enviando dados pendentes para o servidor",
        icon: <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />,
        cardClass: "border-blue-500 bg-blue-50",
      };
    }

    if (!isOnline) {
      return {
        label: "Offline",
        description: pendingCounts.total > 0
          ? `${pendingCounts.total} registro(s) salvos localmente`
          : "Você pode continuar usando o aplicativo sem internet",
        icon: <WifiOff className="h-4 w-4 text-amber-600" />,
        cardClass: "border-amber-500 bg-amber-50",
      };
    }

    if (syncStatus === "error") {
      return {
        label: "Erro na sincronização",
        description: "Os dados continuam salvos e serão tentados novamente",
        icon: <AlertCircle className="h-4 w-4 text-red-600" />,
        cardClass: "border-red-500 bg-red-50",
      };
    }

    if (syncStatus === "success") {
      return {
        label: "Sincronizado",
        description: "Todos os dados pendentes foram enviados com sucesso",
        icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
        cardClass: "border-emerald-500 bg-emerald-50",
      };
    }

    return {
      label: "Online",
      description: pendingCounts.total > 0
        ? `${pendingCounts.total} registro(s) aguardando sincronização`
        : "Todos os dados estão sincronizados",
      icon: <Wifi className="h-4 w-4 text-emerald-600" />,
      cardClass: "border-emerald-500 bg-white",
    };
  }, [isOnline, lastSyncMessage, pendingCounts.total, syncStatus, syncing]);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm">
        <Card className={`border-2 p-3 shadow-lg ${statusMeta.cardClass}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <div className="mt-0.5">{statusMeta.icon}</div>
              <div>
                <div className="text-xs font-semibold text-slate-900">{statusMeta.label}</div>
                <div className="text-[10px] text-slate-600">{statusMeta.description}</div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {pendingCounts.pesagens} pesagens • {pendingCounts.sanidade} sanidade • {pendingCounts.updates} edições
                </div>
              </div>
            </div>

            <div className="flex gap-1">
              {isOnline && pendingCounts.total > 0 && (
                <Button onClick={() => handleSync()} disabled={syncing} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                  Sincronizar
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowLogDialog(true)}>
                Ver log
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Dialog open={showLogDialog} onOpenChange={(open) => { if (!syncing) setShowLogDialog(open); }}>
        <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4" />
              Log de sincronização
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {syncLog.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                <Clock className="mx-auto mb-2 h-12 w-12 opacity-50" />
                <p className="text-sm">Nenhum log disponível</p>
                <p className="mt-1 text-xs">O histórico aparecerá aqui nas próximas sincronizações</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 border border-black py-1 text-xs font-bold">Status</TableHead>
                    <TableHead className="border border-black py-1 text-xs font-bold">Tipo</TableHead>
                    <TableHead className="border border-black py-1 text-xs font-bold">Mensagem</TableHead>
                    <TableHead className="w-24 border border-black py-1 text-xs font-bold">Horário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncLog.map((log, idx) => (
                    <TableRow key={idx} className="hover:bg-gray-50">
                      <TableCell className="border border-gray-300 py-1 text-xs">
                        {log.status === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                        {log.status === "error" && <XCircle className="h-4 w-4 text-red-600" />}
                        {log.status === "skip" && <AlertCircle className="h-4 w-4 text-amber-600" />}
                        {log.status === "pending" && <Clock className="h-4 w-4 animate-pulse text-blue-600" />}
                      </TableCell>
                      <TableCell className="border border-gray-300 py-1 text-xs font-medium">{log.type || "-"}</TableCell>
                      <TableCell className="border border-gray-300 py-1 text-xs">{log.message || log.details || "-"}</TableCell>
                      <TableCell className="border border-gray-300 py-1 text-xs text-slate-500">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString("pt-BR") : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <div className="text-xs text-slate-600">
              <span className="font-semibold">Total:</span> {syncLog.length} evento(s)
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {errorLogItems.length > 0 && (
                <>
                  <Button variant="outline" size="sm" onClick={handleCopyErrors} className="h-8 text-xs gap-1">
                    <Copy className="w-3.5 h-3.5" />
                    Copiar erros
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportErrors} className="h-8 text-xs gap-1">
                    <Download className="w-3.5 h-3.5" />
                    Exportar erros
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => setSyncLog([])} className="h-8 text-xs">
                Limpar log
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowLogDialog(false)} className="h-8 text-xs">
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}