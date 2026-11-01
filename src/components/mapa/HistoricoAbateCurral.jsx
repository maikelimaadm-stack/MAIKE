import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { listarTodasMovimentacoes } from "@/services/loteManejoService";
import CancelarMovimentacao from "@/components/lotes/CancelarMovimentacao";
import { ehMovimentoCancelado } from "@/domain/lotes/situacaoMovimento";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

function formatDateOnly(value) {
  const raw = String(value || "");
  if (!raw) return "-";
  const datePart = raw.includes("T") ? raw.split("T")[0] : raw;
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return new Date(value).toLocaleDateString("pt-BR");
  return `${day}/${month}/${year}`;
}

export default function HistoricoAbateCurral({ areaId }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  // R2A (D-PROD-97): a exclusão antiga (somar no lote e apagar o movimento em
  // duas chamadas) saiu. Cancelar abate é o comando do servidor.
  const { data: historico = [], isLoading } = useQuery({
    queryKey: ["historico-abate-curral", areaId, empresaSelecionadaId],
    queryFn: async () => {
      const movimentacoes = await listarTodasMovimentacoes();
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
          cancelado: ehMovimentoCancelado(mov),
          cancelamento: mov.cancelamento || null,
          raw: mov,
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
                    {item.cancelado && (
                      <Badge variant="outline" className="text-[10px] text-red-800 border-red-300 bg-red-50">
                        Cancelado
                      </Badge>
                    )}
                  </div>

                  <div className="text-xs font-semibold text-slate-900">{item.lote || "Sem lote"}</div>

                  <div className="space-y-0.5 text-[10px] text-slate-600">
                    {!!item.quantidade && <div><strong>Quantidade:</strong> {item.quantidade} cab</div>}
                    <div><strong>Data:</strong> {formatDateOnly(item.data)}</div>
                    {!!item.peso_medio && <div><strong>Peso médio:</strong> {item.peso_medio} kg</div>}
                    {!!item.destino && <div><strong>Destino:</strong> {item.destino}</div>}
                    {!!item.observacoes && <div className="break-words"><strong>Detalhes:</strong> {item.observacoes}</div>}
                    {item.cancelado && (
                      <div className="text-red-800">
                        Cancelado{item.cancelamento?.por_login ? ` por ${item.cancelamento.por_login}` : ""}
                        {item.cancelamento?.motivo ? ` — Motivo: ${item.cancelamento.motivo}` : ""}
                      </div>
                    )}
                  </div>
                </div>
                {!item.cancelado && (
                  <div className="shrink-0">
                    <CancelarMovimentacao movimento={item.raw} />
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