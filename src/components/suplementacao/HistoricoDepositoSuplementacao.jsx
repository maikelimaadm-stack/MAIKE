import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function HistoricoDepositoSuplementacao({ deposito }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ["historico-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list("-data_movimentacao");
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id));
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
  });

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="py-3 border-b bg-slate-50">
        <CardTitle className="text-sm font-semibold text-slate-900">Histórico do Depósito</CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        {isLoading ? (
          <div className="text-xs text-slate-500">Carregando...</div>
        ) : movimentacoes.length === 0 ? (
          <div className="text-xs text-slate-500">Nenhum registro encontrado.</div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {movimentacoes.map((movimentacao) => (
              <div key={movimentacao.id} className="rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{movimentacao.produto_nome}</div>
                    <div className="text-[10px] text-slate-500">{new Date(movimentacao.data_movimentacao).toLocaleString("pt-BR")}</div>
                  </div>
                  <Badge variant="outline" className="text-xs">{movimentacao.quantidade?.toFixed?.(2) || movimentacao.quantidade}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] text-slate-600">
                  <div>Tipo: <span className="font-semibold text-slate-900">{movimentacao.tipo_movimentacao}</span></div>
                  <div>Operação: <span className="font-semibold text-slate-900">{movimentacao.tipo_detalhado}</span></div>
                  <div>Origem: <span className="font-semibold text-slate-900">{movimentacao.local_origem || "-"}</span></div>
                  <div>Destino: <span className="font-semibold text-slate-900">{movimentacao.local_destino || "-"}</span></div>
                </div>
                {movimentacao.observacoes && <div className="mt-2 text-[10px] text-slate-500 italic">{movimentacao.observacoes}</div>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}