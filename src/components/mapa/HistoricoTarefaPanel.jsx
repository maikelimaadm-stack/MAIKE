import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function HistoricoTarefaPanel({ tarefaTitulo, historico = [] }) {
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
              {historico.map((item) => (
                <div key={item.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">
                        {new Date(item.data_evento || item.created_date).toLocaleDateString("pt-BR")}
                      </span>
                      <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
                        {item.evento}
                      </Badge>
                      {item.status && (
                        <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
                          {item.status}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 shrink-0">
                      {new Date(item.data_evento || item.created_date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>

                  <div className="text-xs font-semibold text-slate-900">{tarefaTitulo}</div>

                  {item.descricao && (
                    <div className="text-[10px] text-slate-600 break-words">{item.descricao}</div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-[10px]">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="text-slate-500">Responsável</div>
                      <div className="font-semibold text-slate-900">{item.responsavel || "-"}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="text-slate-500">Data e hora</div>
                      <div className="font-semibold text-slate-900">
                        {new Date(item.data_evento || item.created_date).toLocaleString("pt-BR")}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}