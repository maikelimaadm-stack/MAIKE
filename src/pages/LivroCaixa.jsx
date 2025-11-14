import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen } from "lucide-react";

export default function LivroCaixa() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Livro-Caixa</h1>
          <p className="text-sm text-slate-600">Registro de movimentações financeiras</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-600" />
            Em Desenvolvimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">
            Módulo de Livro-Caixa em construção. Aqui você poderá visualizar todas as 
            movimentações de entrada e saída de forma detalhada.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}