import React from "react";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function AccessDeniedCard() {
  return (
    <div className="p-4 md:p-6">
      <Card className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
        <CardContent className="p-6 md:p-8 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Acesso não permitido</h2>
            <p className="text-xs text-slate-600 mt-1">Esta tela não está liberada para o seu usuário.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}