import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

export default function DetalhesLote({ lotes, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Calcular total de cabeças
  const totalCabecas = lotes.reduce((sum, lote) => sum + (lote.quantidade_cabecas || 0), 0);
  
  // Título com nomes dos lotes
  const tituloLotes = lotes.map(l => l.nome).join(' - ');

  return (
    <div className="space-y-4">
      <div className="text-xl font-bold text-slate-900 pb-2 border-b">
        {tituloLotes}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${lotes.length}, 1fr)` }}>
        {lotes.map((lote, index) => (
          <div key={lote.id} className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-emerald-600 font-semibold text-base mb-1">
                  {lote.quantidade_cabecas} cabeças - {lote.categoria?.toUpperCase() || 'SEM CATEGORIA'}
                </div>
                <div className="text-xs text-slate-600">LOTE {lote.numero_lote || lote.nome}</div>
                <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center mt-2">
                  <Check className="w-5 h-5 text-white" />
                </div>
              </div>
              {(() => {
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === lote.categoria?.toUpperCase()
                );
                
                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;
                
                if (iconeUrl) {
                  return (
                    <img 
                      src={iconeUrl} 
                      alt={lote.categoria} 
                      className="w-20 h-20 object-contain" 
                    />
                  );
                }
                return null;
              })()}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Último peso informado</div>
                <div className="text-xs text-slate-500">(kg)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.peso_medio || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Último GMD ocorrido</div>
                <div className="text-xs text-slate-500">(kg/cabeça/dia)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.gmd || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Taxa de ganho</div>
                <div className="text-xs text-slate-500">(%)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.taxa_ganho || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Peso projetado</div>
                <div className="text-xs text-slate-500">(kg)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.peso_projetado || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Último consumo</div>
                <div className="text-xs text-slate-500">(kg/cabeça/dia)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.ultimo_consumo || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">{lote.categoria || 'Categoria'}</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.quantidade_cabecas || '-'} cab.
                </div>
                <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mt-1">
                  <span className="text-white text-xs">✓</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3 pt-3 border-t">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Quantidade de cabeças</div>
            <div className="text-xl font-bold text-slate-900">{totalCabecas}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Peso médio projetado</div>
            <div className="text-xs text-slate-500">(kg)</div>
            <div className="text-xl font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Taxa de lotação projetada</div>
            <div className="text-xs text-slate-500">(kg/ha)</div>
            <div className="text-xl font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Taxa de lotação (UA/ha)</div>
            <div className="text-xl font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Última movimentação</div>
            <div className="text-sm font-bold text-slate-900">
              {lotes[0]?.data_entrada ? new Date(lotes[0].data_entrada).toLocaleDateString() : '-'}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Última suplementação</div>
            <div className="text-sm font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Índice consumo anterior</div>
            <div className="text-xs text-slate-500">(kg/100 kg/dia)</div>
            <div className="text-sm font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Oferta de forragem</div>
            <div className="text-xs text-slate-500">(%)</div>
            <div className="text-sm font-bold text-slate-900">-</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-6 gap-2 pt-3">
        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">🥩</div>
          <span className="text-xs font-semibold">Abate para consumo</span>
        </Button>
        
        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">✕</div>
          <span className="text-xs font-semibold">Morte</span>
        </Button>

        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">⇄</div>
          <span className="text-xs font-semibold">Movimentação</span>
        </Button>

        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">🔄</div>
          <span className="text-xs font-semibold">Mudança de categoria</span>
        </Button>

        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">⭐</div>
          <span className="text-xs font-semibold">Nascimento</span>
        </Button>

        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">⚖</div>
          <span className="text-xs font-semibold">Pesagem</span>
        </Button>
      </div>
    </div>
  );
}