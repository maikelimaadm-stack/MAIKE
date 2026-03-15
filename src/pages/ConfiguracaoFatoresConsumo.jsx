import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowRight, Beaker } from "lucide-react";

export default function ConfiguracaoFatoresConsumo() {
  return (
    <div className="p-4 md:p-6 flex items-center justify-center min-h-[50vh]">
      <Card className="max-w-lg w-full">
        <CardContent className="p-8 text-center space-y-4">
          <Beaker className="w-12 h-12 mx-auto text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-900">Fatores de Consumo Descontinuado</h2>
          <p className="text-sm text-slate-600">
            O sistema agora utiliza o <strong>%PV (Percentual do Peso Vivo)</strong> configurado diretamente no cadastro do produto (categoria Suplementação) para calcular o consumo esperado.
          </p>
          <p className="text-xs text-slate-500">
            Acesse o cadastro de Produtos e edite os produtos de suplementação para configurar o tipo de consumo e os percentuais de %PV.
          </p>
          <Link to={createPageUrl("Produtos")}>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1.5">
              <ArrowRight className="w-3.5 h-3.5" />
              Ir para Produtos
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}