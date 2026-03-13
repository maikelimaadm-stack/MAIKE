import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function LinhaDoTempoLote({ eventos }) {
  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold text-slate-700">Linha do Tempo do Lote</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-3 max-h-[520px] overflow-y-auto">
          {eventos.length === 0 ? (
            <div className="text-xs text-slate-500">Nenhum evento encontrado para este lote.</div>
          ) : (
            eventos.map((evento) => (
              <div key={evento.key} className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-slate-900">{evento.data}</span>
                  <Badge className="text-[10px]">{evento.tipo}</Badge>
                  <Badge variant="outline" className="text-[10px]">{evento.origem}</Badge>
                </div>
                <div className="text-xs font-medium text-slate-800">{evento.titulo}</div>
                {evento.descricao && <div className="text-xs text-slate-600 mt-1">{evento.descricao}</div>}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}