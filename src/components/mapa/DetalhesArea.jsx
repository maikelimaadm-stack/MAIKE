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
      return all.filter((l) => l.area_atual_id === area.id && l.status === 'Ativo');
    },
    enabled: !!area?.id && !!empresaSelecionadaId
  });

  const totalCabecas = lotes.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);

  if (!isCurral) return null;

  return (
    <div className="space-y-1" translate="no">
      














      

      <Card className="border-slate-200 bg-slate-50">
        


















        
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="historico" className="w-full">
        




        

        <TabsContent value="historico" className="mt-3">
          <HistoricoMovimentacoes lotes={lotes} areaId={area.id} />
        </TabsContent>

      </Tabs>

    </div>);

}