import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

function formatDateOnly(value) {
  const raw = String(value || "");
  if (!raw) return "-";
  const datePart = raw.includes("T") ? raw.split("T")[0] : raw;
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return new Date(value).toLocaleDateString("pt-BR");
  return `${day}/${month}/${year}`;
}

export default function HistoricoAbateCurral({ areaId }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (item) => {
      const mov = await base44.entities.MovimentacaoMapa.list("-data_movimentacao");
      const registro = mov.find((m) => m.id === item.id);
      if (!registro) return;

      if (registro.lote_id) {
        const lotes = await base44.entities.Lote.list();
        const lote = lotes.find((l) => l.id === registro.lote_id);
        if (lote) {
          await base44.entities.Lote.update(lote.id, {
            quantidade_cabecas: (lote.quantidade_cabecas || 0) + (registro.quantidade_animais || 0),
            status: "Ativo"
          });
        }
      }

      await base44.entities.MovimentacaoMapa.delete(item.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["historico-abate-curral"] });
      queryClient.invalidateQueries({ queryKey: ["mapa-lotes"] });
      queryClient.invalidateQueries({ queryKey: ["lotes"] });
      try { window.dispatchEvent(new CustomEvent('atualizar-mapa')); } catch {}
      toast.success("Abate excluído");
    },
  });

  const { data: historico = [], isLoading } = useQuery({
    queryKey: ["historico-abate-curral", areaId, empresaSelecionadaId],
    queryFn: async () => {
      const movimentacoes = await base44.entities.MovimentacaoMapa.list("-data_movimentacao");
      return movimentacoes
        .filter((mov) => mov.empresa_id === empresaSelecionadaId)
        .filter((mov) => mov.tipo === "Abate")
        .filter((mov) => mov.area_origem_id === areaId || mov.area_destino_id === areaId)
        .map((mov) => ({
          id: mov.id,
          data: mov.data_movimentacao,
          lote: mov.lote,
          quantidade: mov.quantidade_animais,
          peso_medio: mov.peso_medio,
          destino: mov.destino_venda,
          observacoes: mov.observacoes,
        }));
    },
    enabled: !!areaId && !!empresaSelecionadaId,
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

  if (historico.length === 0) {
    return (
      <Card>
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Histórico de Abate</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="text-center py-8 text-slate-500 text-sm">Nenhum abate encontrado</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Histórico de Abate ({historico.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        <div className="max-h-[500px] overflow-y-auto space-y-2">
          {historico.map((item) => (
            <div key={item.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">
                      {formatDateOnly(item.data)}
                    </span>
                    <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
                      Abate
                    </Badge>
                  </div>

                  <div className="text-xs font-semibold text-slate-900">{item.lote || "Sem lote"}</div>

                  <div className="space-y-0.5 text-[10px] text-slate-600">
                    {!!item.quantidade && <div><strong>Quantidade:</strong> {item.quantidade} cab</div>}
                    <div><strong>Data:</strong> {formatDateOnly(item.data)}</div>
                    {!!item.peso_medio && <div><strong>Peso médio:</strong> {item.peso_medio} kg</div>}
                    {!!item.destino && <div><strong>Destino:</strong> {item.destino}</div>}
                    {!!item.observacoes && <div className="break-words"><strong>Detalhes:</strong> {item.observacoes}</div>}
                  </div>
                </div>
                <div className="shrink-0">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (!confirm('Excluir este abate?')) return;
                      deleteMutation.mutate(item);
                    }}
                  >
                    Excluir
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}