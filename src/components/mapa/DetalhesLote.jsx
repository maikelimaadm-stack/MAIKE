import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Beef, MapPin, Calendar, Weight, Activity, Move, Scale, Tag, Heart, Users } from "lucide-react";

export default function DetalhesLote({ lote, onClose }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-4">
          <div className="bg-emerald-100 p-3 rounded-lg">
            <Beef className="w-8 h-8 text-emerald-700" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">{lote.nome}</div>
            <div className="text-sm text-slate-600">Código: {lote.numero_lote}</div>
          </div>
        </div>
        <Badge className="bg-emerald-600 text-white text-2xl px-6 py-3">
          <Users className="w-6 h-6 mr-2" />
          {lote.quantidade_cabecas} cabeças
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card className="border-slate-200">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-500 mb-2">Último peso informado</div>
            <div className="text-2xl font-bold text-slate-900">{lote.peso_medio || '-'}</div>
            <div className="text-xs text-slate-500 mt-1">kg</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-500 mb-2">Último GMD ocorrido</div>
            <div className="text-2xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">kg/cabeça/dia</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-500 mb-2">Taxa de ganho (%)</div>
            <div className="text-2xl font-bold text-slate-900">{lote.idade_media || '-'}</div>
            <div className="text-xs text-slate-500 mt-1">%</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-500 mb-2">Peso projetado</div>
            <div className="text-2xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">kg</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-500 mb-2">Último peso consumo ocorrido</div>
            <div className="text-2xl font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500 mt-1">kg/cabeça/dia</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-500 mb-2">Indivíduos</div>
            <div className="text-2xl font-bold text-slate-900">{lote.quantidade_cabecas || '-'}</div>
            <div className="text-xs text-slate-500 mt-1">Qtd</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-500 mb-2">Categoria</div>
            <div className="text-lg font-bold text-slate-900">{lote.categoria || '-'}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 text-center">
            <div className="text-xs text-slate-500 mb-2">Sexo</div>
            <div className="text-lg font-bold text-slate-900">{lote.sexo || '-'}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Quantidade de cabeças</div>
            <div className="text-lg font-bold text-slate-900">{lote.quantidade_cabecas || '-'}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Peso médio projetado</div>
            <div className="text-lg font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500">kg</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Taxa de lotação projetada</div>
            <div className="text-lg font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500">kg/ha</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Taxa de lotação (UA/ha)</div>
            <div className="text-lg font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Última movimentação</div>
            <div className="text-sm font-bold text-slate-900">{lote.data_entrada ? new Date(lote.data_entrada).toLocaleDateString() : '-'}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Última suplementação</div>
            <div className="text-sm font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Índice consumo anterior</div>
            <div className="text-sm font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500">kg/100 kg/dia</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Oferta de forragem</div>
            <div className="text-sm font-bold text-slate-900">-</div>
            <div className="text-xs text-slate-500">%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-6 gap-2 pt-2 border-t">
        <Button variant="outline" size="sm" className="h-20 flex-col gap-2 bg-emerald-50 hover:bg-emerald-100 border-emerald-200">
          <div className="bg-emerald-600 p-2 rounded-full">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="text-xs font-semibold">Alotas para consumo</span>
        </Button>
        
        <Button variant="outline" size="sm" className="h-20 flex-col gap-2 bg-slate-50 hover:bg-slate-100">
          <div className="bg-slate-600 p-2 rounded-full">
            <Tag className="w-5 h-5 text-white" />
          </div>
          <span className="text-xs font-semibold">Mortes</span>
        </Button>

        <Button variant="outline" size="sm" className="h-20 flex-col gap-2 bg-emerald-50 hover:bg-emerald-100 border-emerald-200">
          <div className="bg-emerald-600 p-2 rounded-full">
            <Move className="w-5 h-5 text-white" />
          </div>
          <span className="text-xs font-semibold">Movimentação</span>
        </Button>

        <Button variant="outline" size="sm" className="h-20 flex-col gap-2 bg-emerald-50 hover:bg-emerald-100 border-emerald-200">
          <div className="bg-emerald-600 p-2 rounded-full">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="text-xs font-semibold">Mudança de categoria</span>
        </Button>

        <Button variant="outline" size="sm" className="h-20 flex-col gap-2 bg-emerald-50 hover:bg-emerald-100 border-emerald-200">
          <div className="bg-emerald-600 p-2 rounded-full">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="text-xs font-semibold">Nascimento</span>
        </Button>

        <Button variant="outline" size="sm" className="h-20 flex-col gap-2 bg-emerald-50 hover:bg-emerald-100 border-emerald-200">
          <div className="bg-emerald-600 p-2 rounded-full">
            <Scale className="w-5 h-5 text-white" />
          </div>
          <span className="text-xs font-semibold">Pesagem</span>
        </Button>
      </div>
    </div>
  );
}