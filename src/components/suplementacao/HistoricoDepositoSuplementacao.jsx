import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { excluirTransferenciaDeposito } from "./historicoSuplementacaoUtils";
import { formatDecimal, formatKg, formatDateBR } from "./formatters";

export default function HistoricoDepositoSuplementacao({ deposito }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ["historico-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list("-data_movimentacao");
      return all
        .filter((item) => item.empresa_id === empresaSelecionadaId
          && (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id)
          && item.origem_sistema !== "reversao"
          && !(item.tipo_detalhado === "ajuste_positivo" && String(item.observacoes || "").includes("Reversão do lançamento do cocho")))
        .sort((a, b) => new Date(b.data_movimentacao) - new Date(a.data_movimentacao));
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
  });

  const handleDelete = async (movimentacao, index) => {
    if (index !== 0) {
      return toast.error("Exclua primeiro o último lançamento.");
    }
    if (!["transferencia_recebida", "transferencia_enviada"].includes(movimentacao.tipo_detalhado)) {
      return toast.error("No depósito você só pode excluir movimentações próprias do depósito; nutrição deve ser excluída no histórico do cocho.");
    }
    if (!confirm("Excluir este lançamento e reverter a transferência?")) return;

    setDeletingId(movimentacao.id);
    try {
      await excluirTransferenciaDeposito({ movimentacao });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["historico-deposito", "saldo-deposito", "movimentacoes-deposito-detalhe", "estoque-lotes-transferencia", "mapa-estoque-lotes", "movimentacoes"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Transferência excluída.");
    } catch (error) {
      toast.error(error.message || "Não foi possível excluir a transferência.");
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) return <div className="text-center py-8 text-xs text-slate-500">Carregando...</div>;

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50 border-b py-3 px-3">
          <CardTitle className="text-sm font-semibold">Histórico do Depósito ({movimentacoes.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {movimentacoes.length === 0 ?
          <div className="text-center py-8 text-xs text-slate-500">Nenhum registro encontrado.</div> :
          <div className="max-h-[60vh] overflow-y-auto space-y-1">
            {movimentacoes.map((movimentacao, index) => {
              const ehNutricao = movimentacao.tipo_detalhado === "suplementacao" || movimentacao.motivo_movimentacao === "Baixa automática de suplementação" || movimentacao.exclusao_somente_em === "cocho";
              const ehMovimentoDeposito = movimentacao.origem_sistema === "deposito" || movimentacao.exclusao_somente_em === "deposito" || ["transferencia_recebida", "transferencia_enviada"].includes(movimentacao.tipo_detalhado);
              const permiteExcluir = ehMovimentoDeposito;

              // Extrair data corretamente (usar apenas a parte da data, sem timezone)
              const dataRaw = movimentacao.data_movimentacao || "";
              const dataDisplay = dataRaw.includes("T")
                ? dataRaw.split("T")[0].split("-").reverse().join("/")
                : new Date(dataRaw).toLocaleDateString("pt-BR");

              return (
                <div key={movimentacao.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50 space-y-1">
                  {/* Header com badges e botões */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">{dataDisplay}</span>
                      {index === 0 && <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">Último</Badge>}
                      <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">{movimentacao.tipo_movimentacao}</Badge>
                      <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">{movimentacao.tipo_detalhado}</Badge>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="destructive" size="sm" className="h-7 text-[10px] px-2" disabled={index !== 0 || deletingId === movimentacao.id || !permiteExcluir} onClick={() => handleDelete(movimentacao, index)}>Excluir</Button>
                    </div>
                  </div>

                  {/* Produto */}
                  <div className="text-xs font-semibold text-slate-900">{movimentacao.produto_nome}</div>

                  {/* Métricas - grid padrão sm:2 md:4 (igual ao cocho) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Quantidade: <span className="font-semibold text-slate-900">{formatKg(movimentacao.quantidade || 0)}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Data: <span className="font-semibold text-slate-900">{dataDisplay}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Origem: <span className="font-semibold text-slate-900">{movimentacao.local_origem || "-"}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Destino: <span className="font-semibold text-slate-900">{movimentacao.local_destino || "-"}</span></div>
                  </div>

                  {movimentacao.observacoes && <div className="text-[10px] text-slate-500 break-words">Obs: {movimentacao.observacoes}</div>}
                  {index !== 0 && <div className="text-[10px] text-slate-500 font-medium">Somente o último lançamento pode ser editado ou excluído.</div>}
                  {ehNutricao && <div className="text-[10px] text-slate-500 font-medium">Lançamentos de nutrição só podem ser excluídos no histórico do cocho.</div>}
                </div>
              );
            })}
          </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}