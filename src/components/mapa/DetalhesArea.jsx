import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, ClipboardList } from "lucide-react";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";

export default function DetalhesArea({ area }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const isCurral = area?.tipo_cultura === 'Infraestrutura' && String(area?.tipo_infraestrutura || area?.tipo_pastagem || '').trim().toLowerCase() === 'curral';

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-area', area.id],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.area_atual_id === area.id && l.status === 'Ativo');
    },
    enabled: !!area?.id && !!empresaSelecionadaId,
  });

  const totalCabecas = lotes.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);

  if (!isCurral) return null;

  return (
    <div className="space-y-4" translate="no">
      <div className="flex items-start justify-between pb-2 border-b">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-bold text-slate-900">{area.nome}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
            <span>{area.tipo_infraestrutura || area.tipo_pastagem || 'Sem tipo'}</span>
            <span>•</span>
            <span>{area.tipo_cultura || 'Sem tipo'}</span>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] border-slate-300 bg-white text-slate-700">
          {totalCabecas.toLocaleString('pt-BR')} cabeças
        </Badge>
      </div>

      <Card className="border-slate-200 bg-slate-50">
        <CardContent className="p-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="text-slate-500">Nome</div>
              <div className="font-semibold text-slate-900">{area.nome || '-'}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="text-slate-500">Tipo de infraestrutura</div>
              <div className="font-semibold text-slate-900">{area.tipo_infraestrutura || area.tipo_pastagem || '-'}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="text-slate-500">Setor</div>
              <div className="font-semibold text-slate-900">{area.setor_nome || '-'}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-2 sm:col-span-3">
              <div className="text-slate-500">Observações</div>
              <div className="font-semibold text-slate-900">{area.observacoes || '-'}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="historico" className="w-full">
        <TabsList className="grid w-full grid-cols-1">
          <TabsTrigger value="historico" className="text-xs">
            <ClipboardList className="w-3 h-3 mr-1" />
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="historico" className="mt-3">
          <HistoricoMovimentacoes lotes={lotes} areaId={area.id} />
        </TabsContent>

      </Tabs>

    </div>
  );
}