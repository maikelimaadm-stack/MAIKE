import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";

export default function DetalhesLote({ lote, onClose }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600 p-3 rounded-full">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900">{lote.nome}</div>
            <div className="text-sm text-slate-500">Código: {lote.numero_lote}</div>
          </div>
        </div>
        <Badge className="bg-emerald-600 text-white text-xl px-6 py-3 rounded-lg">
          <Users className="w-5 h-5 mr-2" />
          {lote.quantidade_cabecas} cabeças
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-blue-600 mb-2">Último peso informado</div>
            <div className="text-3xl font-bold text-slate-900">{lote.peso_medio || '-'}</div>
            <div className="text-xs text-slate-500 mt-1">kg</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-blue-600 mb-2">Último GMD ocorrido</div>
            <div className="text-3xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">kg/cabeça/dia</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-blue-600 mb-2">Taxa de ganho (%)</div>
            <div className="text-3xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">%</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-blue-600 mb-2">Peso projetado</div>
            <div className="text-3xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">kg</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-blue-600 mb-2">Último peso consumo ocorrido</div>
            <div className="text-3xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">kg/cabeça/dia</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-blue-600 mb-2">Indivíduos</div>
            <div className="text-3xl font-bold text-slate-900">{lote.quantidade_cabecas || '-'}</div>
            <div className="text-xs text-slate-500 mt-1">Qtd</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-blue-600 mb-2">Categoria</div>
            <div className="text-xl font-bold text-slate-900">{lote.categoria || '-'}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-blue-600 mb-2">Sexo</div>
            <div className="text-xl font-bold text-slate-900">{lote.sexo || '-'}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-600 mb-2">Quantidade de cabeças</div>
            <div className="text-2xl font-bold text-slate-900">{lote.quantidade_cabecas || '-'}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-600 mb-2">Peso médio projetado</div>
            <div className="text-2xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">kg</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-600 mb-2">Taxa de lotação projetada</div>
            <div className="text-2xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">kg/ha</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-600 mb-2">Taxa de lotação (UA/ha)</div>
            <div className="text-2xl font-bold text-slate-900">-</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}