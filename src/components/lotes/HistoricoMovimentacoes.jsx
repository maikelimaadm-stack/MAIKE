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

export default function HistoricoMovimentacoes({ lotesIds }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['historico-movimentacoes', lotesIds],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list('-data_movimentacao');
      return all.filter(m => 
        m.empresa_id === empresaSelecionadaId && 
        lotesIds.some(id => m.lote?.includes(id))
      );
    },
    enabled: !!empresaSelecionadaId && lotesIds.length > 0,
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
        <div className="max-h-[400px] overflow-y-auto pr-2 space-y-3">
          {movimentacoes.map((mov) => (
            <div key={mov.id} className="bg-slate-50 border rounded-lg p-3 hover:bg-slate-100 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{ICONES_TIPO[mov.tipo] || "📋"}</span>
                  <div>
                    <Badge className={`text-xs ${CORES_TIPO[mov.tipo] || 'bg-slate-100 text-slate-800'}`}>
                      {mov.tipo}
                    </Badge>
                    <div className="text-xs text-slate-600 mt-1">
                      {new Date(mov.data_movimentacao).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-900">
                    {mov.quantidade_animais} {mov.quantidade_animais === 1 ? 'animal' : 'animais'}
                  </div>
                </div>
              </div>

              {mov.tipo === 'Transferência de Área' && (
                <div className="flex items-center gap-2 text-xs text-slate-600 mt-2">
                  <MapPin className="w-3 h-3" />
                  <span>{mov.area_origem_nome}</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="font-semibold">{mov.area_destino_nome}</span>
                </div>
              )}

              {mov.observacoes && (
                <div className="mt-2 text-xs text-slate-600 bg-white border rounded p-2">
                  {mov.observacoes}
                </div>
              )}

              {mov.peso_medio && (
                <div className="flex items-center gap-1 text-xs text-emerald-700 mt-2">
                  <TrendingUp className="w-3 h-3" />
                  Peso: {mov.peso_medio} kg
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}