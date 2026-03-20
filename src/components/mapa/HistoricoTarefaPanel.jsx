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
                <div key={item.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
                        {item.evento}
                      </Badge>
                      {item.status && (
                        <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
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

                  <div className="text-xs font-semibold text-slate-900">{tarefaTitulo}</div>

                  {item.descricao && <div className="text-[10px] text-slate-600 break-words">{item.descricao}</div>}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-[10px]">
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">
                      Responsável: <span className="font-semibold text-slate-900">{item.responsavel || "-"}</span>
                    </div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">
                      Status: <span className="font-semibold text-slate-900">{item.status || "-"}</span>
                    </div>
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