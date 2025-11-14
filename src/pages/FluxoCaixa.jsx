import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

export default function FluxoCaixa() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Fluxo de Caixa</h1>
          <p className="text-sm text-slate-600">Planejamento e projeção financeira</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            Em Desenvolvimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">
            Módulo de Fluxo de Caixa em construção. Aqui você poderá visualizar projeções, 
            entradas e saídas previstas, e planejar seu fluxo financeiro.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}