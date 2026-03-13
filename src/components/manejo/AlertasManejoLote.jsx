import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AlertasManejoLote({ alertas }) {
  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold text-slate-700">Alertas do Lote</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-2">
        {alertas.length === 0 ? (
          <div className="text-xs text-emerald-700">Nenhum alerta técnico no momento.</div>
        ) : (
          alertas.map((alerta, index) => (
            <div key={index} className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-800">
              <div className="font-semibold">{alerta.titulo}</div>
              <div>{alerta.descricao}</div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}