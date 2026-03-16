import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { excluirTransferenciaDeposito } from "./historicoSuplementacaoUtils";
import { formatKg } from "./formatters";

function formatObsKgPtBR(obs) {
  if (!obs) return "";
  return obs.replace(/([\d]+)\.([\d]+)\s*kg/g, (match, intPart, decPart) => {
    const num = parseFloat(`${intPart}.${decPart}`);
    return num.toLocaleString("pt-BR", { minimumFractionDigits: decPart.length, maximumFractionDigits: decPart.length }) + " kg";
  });
}

function getLabelTipoDetalhado(tipo) {
  const map = {
    transferencia_recebida: "Entrada (transferência)",
    transferencia_enviada: "Saída (transferência)",
    suplementacao: "Saída (suplementação)",
  };
  return map[tipo] || tipo || "-";
}

export default function HistoricoDepositoSuplementacao({ deposito }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ["historico-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list("-data_movimentacao");
      const depositoLocalId = deposito.local_estoque_id;

      return all
        .filter((item) => {
          if (item.empresa_id !== empresaSelecionadaId) return false;
          if (item.origem_sistema === "reversao") return false;
          if (item.tipo_detalhado === "ajuste_positivo" && String(item.observacoes || "").includes("Reversão do lançamento do cocho")) return false;

          const isOrigin = item.local_estoque_origem === depositoLocalId;
          const isDestination = item.local_estoque_destino === depositoLocalId;

          if (!isOrigin && !isDestination) return false;

          if (item.tipo_detalhado === "transferencia_enviada" && !isOrigin) return false;
          if (item.tipo_detalhado === "transferencia_recebida" && !isDestination) return false;
          if (item.tipo_detalhado === "suplementacao" && !isOrigin) return false;

          return true;
        })
        .sort((a, b) => new Date(b.data_movimentacao) - new Date(a.data_movimentacao));
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
  });

  const handleDelete = async (movimentacao, index) => {
    if (index !== 0) return toast.error("Exclua primeiro o último lançamento.");
    if (!["transferencia_recebida", "transferencia_enviada"].includes(movimentacao.tipo_detalhado)) {
      return toast.error("Nutrição deve ser excluída no histórico do cocho.");
    }
    if (!confirm("Excluir este lançamento e reverter a transferência?")) return;

    setDeletingId(movimentacao.id);
    try {
      await excluirTransferenciaDeposito({ movimentacao });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["historico-deposito", "saldo-deposito", "movimentacoes-deposito-detalhe", "estoque-lotes-transferencia", "mapa-estoque-lotes", "movimentacoes"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Transferência excluída.");
    } catch (error) {
      toast.error(error.message || "Não foi possível excluir.");
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) return <div className="text-center py-8 text-xs text-slate-500">Carregando...</div>;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 border-b py-2 px-3">
        <CardTitle className="text-sm font-semibold">Histórico do Depósito ({movimentacoes.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {movimentacoes.length === 0 ?
        <div className="text-center py-8 text-xs text-slate-500">Nenhum registro encontrado.</div> :
        <div className="max-h-[60vh] overflow-y-auto space-y-1">
          {movimentacoes.map((movimentacao, index) => {
            const ehNutricao = movimentacao.tipo_detalhado === "suplementacao" || movimentacao.exclusao_somente_em === "cocho";
            const ehMovimentoDeposito = movimentacao.origem_sistema === "deposito" || movimentacao.exclusao_somente_em === "deposito" || ["transferencia_recebida", "transferencia_enviada"].includes(movimentacao.tipo_detalhado);

            const dataRaw = movimentacao.data_movimentacao || "";
            const dataDisplay = dataRaw.includes("T")
              ? dataRaw.split("T")[0].split("-").reverse().join("/")
              : new Date(dataRaw).toLocaleDateString("pt-BR");

            const destinoLabel = movimentacao.tipo_detalhado === "suplementacao"
              ? "Suplementação"
              : (movimentacao.local_destino || "-");

            const unidade = movimentacao.unidade_medida || "KG";

            return (
              <div key={movimentacao.id} className="border border-slate-200 rounded-lg p-2 hover:bg-gray-50 space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="inline-flex items-center rounded-md border px-2 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">{dataDisplay}</span>
                    {index === 0 && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50">Último</Badge>}
                    <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">{getLabelTipoDetalhado(movimentacao.tipo_detalhado)}</Badge>
                  </div>
                  <Button variant="destructive" size="sm" className="h-6 text-[10px] px-2" disabled={index !== 0 || deletingId === movimentacao.id || !ehMovimentoDeposito} onClick={() => handleDelete(movimentacao, index)}>Excluir</Button>
                </div>

                <div className="text-xs font-bold text-slate-900">{movimentacao.produto_nome}</div>

                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Quantidade: <span className="font-semibold text-slate-900">{formatKg(movimentacao.quantidade || 0)}</span></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Unidade: <span className="font-semibold text-slate-900">{unidade}</span></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Origem: <span className="font-semibold text-slate-900">{movimentacao.local_origem || "-"}</span></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Destino: <span className="font-semibold text-slate-900">{destinoLabel}</span></div>
                </div>

                {movimentacao.observacoes && <div className="text-[10px] text-slate-500 break-words">Obs: {formatObsKgPtBR(movimentacao.observacoes)}</div>}
                {index !== 0 && <div className="text-[10px] text-slate-400">Somente o último lançamento pode ser excluído.</div>}
                {ehNutricao && <div className="text-[10px] text-slate-400">Nutrição só pode ser excluída no histórico do cocho.</div>}
              </div>
            );
          })}
        </div>
        }
      </CardContent>
    </Card>
  );
}