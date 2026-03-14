import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { excluirTransferenciaDeposito } from "./historicoSuplementacaoUtils";
import { formatDecimal } from "./formatters";

export default function HistoricoDepositoSuplementacao({ deposito }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [editMov, setEditMov] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MovimentacaoEstoque.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["historico-deposito", "saldo-deposito", "movimentacoes-deposito-detalhe"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Lançamento atualizado.");
    },
  });

  const resumo = useMemo(() => {
    const ultimaData = movimentacoes[0] ? new Date(movimentacoes[0].data_movimentacao).toLocaleString("pt-BR") : "-";
    return { total: movimentacoes.length, ultimaData };
  }, [movimentacoes]);

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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <InfoCard label="Registros" value={String(resumo.total)} />
        <InfoCard label="Último registro" value={resumo.ultimaData} />
        <InfoCard label="Local" value={deposito.local_estoque_nome || "-"} />
        <InfoCard label="Depósito" value={deposito.nome_ponto} />
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Histórico do Depósito ({movimentacoes.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-500">Carregando...</div>
          ) : movimentacoes.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">Nenhum registro encontrado.</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-1.5">
              {movimentacoes.map((movimentacao, index) => {
                const bloqueado = index !== 0;
                const ehNutricao = movimentacao.tipo_detalhado === "suplementacao" || movimentacao.motivo_movimentacao === "Baixa automática de suplementação" || movimentacao.exclusao_somente_em === "cocho";
                const ehMovimentoDeposito = movimentacao.origem_sistema === "deposito" || movimentacao.exclusao_somente_em === "deposito" || ["transferencia_recebida", "transferencia_enviada"].includes(movimentacao.tipo_detalhado);
                const permiteExcluir = ehMovimentoDeposito;
                const permiteEditar = ehMovimentoDeposito;

                return (
                  <div key={movimentacao.id} className="border border-slate-200 rounded-lg p-2 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="bg-slate-100 text-slate-800 text-[10px] font-semibold">{movimentacao.tipo_movimentacao}</Badge>
                          <Badge variant="outline" className="text-[10px]">{movimentacao.tipo_detalhado}</Badge>
                          {index === 0 && <Badge variant="outline" className="text-[10px]">Último registro</Badge>}
                        </div>
                        <div className="text-xs font-semibold text-slate-900">{movimentacao.produto_nome}</div>
                        <div className="space-y-0.5 text-[10px] text-slate-600">
                          <div><strong>Quantidade:</strong> {formatDecimal(movimentacao.quantidade)} {movimentacao.unidade_medida || "KG"}</div>
                          <div><strong>Data:</strong> {new Date(movimentacao.data_movimentacao).toLocaleString("pt-BR")}</div>
                          <div><strong>Origem:</strong> {movimentacao.local_origem || "-"}</div>
                          <div><strong>Destino:</strong> {movimentacao.local_destino || "-"}</div>
                          {movimentacao.observacoes && <div className="break-words"><strong>Detalhes:</strong> {movimentacao.observacoes}</div>}
                          {bloqueado && <div className="text-amber-700 font-medium"><strong>Bloqueio:</strong> somente o último lançamento pode ser editado ou excluído.</div>}
                          {ehNutricao && <div className="text-slate-500 font-medium"><strong>Regra:</strong> lançamentos de nutrição só podem ser editados ou excluídos no histórico do cocho.</div>}
                          {!ehNutricao && !permiteExcluir && !bloqueado && <div className="text-slate-500 font-medium"><strong>Aviso:</strong> este lançamento não pode ser excluído por aqui.</div>}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0 flex-col sm:flex-row">
                        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={bloqueado || !permiteEditar} onClick={() => { setEditMov(movimentacao); setShowEdit(true); }}>Editar</Button>
                        <Button variant="destructive" size="sm" className="h-8 text-xs" disabled={bloqueado || deletingId === movimentacao.id || !permiteExcluir} onClick={() => handleDelete(movimentacao, index)}>Excluir</Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Editar Lançamento</DialogTitle></DialogHeader>
          {editMov && (
            <div className="space-y-2">
              <label className="text-xs text-slate-600">Observações</label>
              <Textarea rows={4} className="text-xs" value={editMov.observacoes || ""} onChange={(e) => setEditMov({ ...editMov, observacoes: e.target.value })} />
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEdit(false)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                  await updateMutation.mutateAsync({ id: editMov.id, data: { observacoes: editMov.observacoes } });
                  setShowEdit(false);
                }}>Salvar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}