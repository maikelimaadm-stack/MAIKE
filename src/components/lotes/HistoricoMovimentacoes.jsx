import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, TrendingUp, X, Plus, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const ICONES_TIPO = {
  "Transferência de Área": "⇄",
  "Morte": "✕",
  "Nascimento": "⭐",
  "Abate": "🥩",
  "Mudança de Categoria": "🔄",
  "Pesagem": "⚖"
};

const CORES_TIPO = {
  "Transferência de Área": "bg-blue-100 text-blue-800",
  "Morte": "bg-red-100 text-red-800",
  "Nascimento": "bg-green-100 text-green-800",
  "Abate": "bg-orange-100 text-orange-800",
  "Mudança de Categoria": "bg-purple-100 text-purple-800",
  "Pesagem": "bg-emerald-100 text-emerald-800"
};

export default function HistoricoMovimentacoes({ lotesIds, areaId }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['historico-movimentacoes', lotesIds, areaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list('-data_movimentacao');
      return all.filter(m => {
        if (m.empresa_id !== empresaSelecionadaId) return false;
        
        // Se tiver areaId, filtra por área origem ou destino
        if (areaId) {
          return m.area_origem_id === areaId || m.area_destino_id === areaId;
        }
        
        // Caso contrário, filtra por lotes
        return lotesIds.some(id => m.lote?.includes(id));
      });
    },
    enabled: !!empresaSelecionadaId && (lotesIds.length > 0 || !!areaId),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-center text-sm text-slate-500">Carregando histórico...</div>
        </CardContent>
      </Card>
    );
  }

  if (movimentacoes.length === 0) {
    return (
      <Card>
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Histórico de Movimentações</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="text-center py-8 text-slate-500">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Nenhuma movimentação registrada</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Histórico de Movimentações ({movimentacoes.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="max-h-[500px] overflow-y-auto pr-2 space-y-3">
          {movimentacoes.map((mov) => (
            <div key={mov.id} className="bg-white border border-slate-300 rounded-lg p-4 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-xl">
                    {ICONES_TIPO[mov.tipo] || "📋"}
                  </div>
                  <div>
                    <Badge className={`text-xs font-semibold ${CORES_TIPO[mov.tipo] || 'bg-slate-100 text-slate-800'}`}>
                      {mov.tipo}
                    </Badge>
                    <div className="text-xs text-slate-600 mt-1 font-medium">
                      {new Date(mov.data_movimentacao).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-emerald-600">
                    {mov.quantidade_animais} {mov.quantidade_animais === 1 ? 'animal' : 'animais'}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-semibold text-slate-700 min-w-[60px]">Lote:</span>
                  <span className="text-xs text-slate-900 font-medium">{mov.lote}</span>
                </div>
                
                {mov.tipo === 'Transferência de Área' && (
                  <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded p-2">
                    <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    <span className="text-blue-700 font-medium">{mov.area_origem_nome}</span>
                    <ArrowRight className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    <span className="text-blue-900 font-bold">{mov.area_destino_nome}</span>
                  </div>
                )}

                {mov.tipo === 'Nascimento' && mov.area_destino_nome && (
                  <div className="flex items-center gap-2 text-xs bg-green-50 border border-green-200 rounded p-2">
                    <MapPin className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <span className="text-green-700 font-medium">Área: </span>
                    <span className="text-green-900 font-bold">{mov.area_destino_nome}</span>
                  </div>
                )}

                {['Morte', 'Abate', 'Mudança de Categoria', 'Pesagem'].includes(mov.tipo) && mov.area_origem_nome && (
                  <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded p-2">
                    <MapPin className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    <span className="text-slate-700 font-medium">Área: </span>
                    <span className="text-slate-900 font-bold">{mov.area_origem_nome}</span>
                  </div>
                )}

                {mov.peso_medio && (
                  <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded p-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700 font-semibold">Peso médio: {mov.peso_medio} kg</span>
                  </div>
                )}

                {mov.observacoes && (
                  <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded p-3 leading-relaxed">
                    {mov.observacoes}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}