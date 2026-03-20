import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

const formatDateBR = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
};

const formatDateTimeBR = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
};

export default function HistoricoTarefaPanel({ tarefaId, tarefaTitulo, historico = [] }) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (item, index) => {
    if (index !== 0) return toast.error("Exclua primeiro o último histórico.");
    if (!confirm("Excluir este histórico da tarefa?")) return;

    setDeletingId(item.id);
    try {
      await base44.entities.HistoricoLancamentoTarefa.delete(item.id);
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", tarefaId] });
      toast.success("Histórico excluído.");
    } catch (error) {
      toast.error(error.message || "Não foi possível excluir o histórico.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50 border-b py-3 px-3">
          <CardTitle className="text-sm font-semibold">Histórico da Tarefa ({historico.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {historico.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">Nenhum histórico encontrado.</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-1">
              {historico.map((item, index) => (
                <div key={item.id} className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1 hover:bg-gray-50">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <div className="text-[11px] font-bold text-slate-900">{tarefaTitulo}</div>
                      {item.status && (
                        <Badge className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200">
                          {item.status}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-[10px] px-2"
                        disabled={index !== 0 || deletingId === item.id}
                        onClick={() => handleDelete(item, index)}
                      >
                        Excluir
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1 text-[10px]">
                    <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Evento:</span><span className="font-semibold text-slate-900">{item.evento || "-"}</span></div>
                    <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Responsável:</span><span className="font-semibold text-slate-900">{item.responsavel || "-"}</span></div>
                    <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Descrição:</span><span className="font-semibold text-slate-900 break-words">{item.descricao || "-"}</span></div>
                  </div>

                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-200">
                    Data: {formatDateBR(item.data_evento || item.created_date)} • {formatDateTimeBR(item.data_evento || item.created_date).split(", ")[1] || "-"}
                  </div>

                  {index !== 0 && <div className="text-[10px] text-slate-400">Somente o último histórico pode ser excluído.</div>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}