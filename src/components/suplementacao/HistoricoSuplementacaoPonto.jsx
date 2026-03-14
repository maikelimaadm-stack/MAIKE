import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { excluirEventoSuplementacaoComReversao } from "./historicoSuplementacaoUtils";
import IndicadorCopoNivel from "./IndicadorCopoNivel";

export default function HistoricoSuplementacaoPonto({ pontoId, pontoNome, ponto, indicador }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [editEvento, setEditEvento] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const { data: user } = useQuery({ queryKey: ["user-historico-suplementacao"], queryFn: () => base44.auth.me() });

  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["suplementacao-ponto", pontoId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter((evento) => evento.empresa_id === empresaSelecionadaId && evento.ponto_suplementacao_id === pontoId).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!pontoId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.SuplementacaoEvento.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["suplementacao-ponto", "eventos-ponto", "mapa-eventos-supl", "ultimo-evento-ponto"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Lançamento atualizado.");
    },
  });

  const resumo = useMemo(() => {
    const totalFornecido = eventos.reduce((total, evento) => total + (evento.quantidade_total_kg || 0), 0);
    const ultimaData = eventos[0] ? new Date(eventos[0].data_lancamento).toLocaleDateString("pt-BR") : "-";
    return { totalFornecido, ultimaData };
  }, [eventos]);

  const handleDelete = async (evento, index) => {
    if (index !== 0) {
      return toast.error("Exclua primeiro o último lançamento.");
    }
    if (!confirm("Excluir este lançamento e reverter o estoque do depósito?")) return;

    setDeletingId(evento.id);
    try {
      await excluirEventoSuplementacaoComReversao({ evento, ponto, userEmail: user?.email });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["suplementacao-ponto", "eventos-ponto", "mapa-eventos-supl", "mapa-pontos-supl", "lotes-nota-suplementacao", "movimentacoes", "produtos"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Lançamento excluído.");
    } catch (error) {
      toast.error(error.message || "Não foi possível excluir o lançamento.");
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-xs text-slate-500">Carregando...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <IndicadorCopoNivel
          titulo="Nível do cocho"
          valor={`${Math.round((indicador?.percent || 0) * 100)}%`}
          subtitulo={indicador?.helperLabel}
          percent={indicador?.percent || 0}
          cor="#10b981"
        />
        <InfoCard label="Lançamentos" value={String(eventos.length)} />
        <InfoCard label="Total fornecido" value={`${resumo.totalFornecido.toFixed(1)} kg`} />
        <InfoCard label="Última data" value={resumo.ultimaData} />
        <InfoCard label="Ponto" value={pontoNome} />
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Histórico do Cocho ({eventos.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {eventos.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">Nenhum lançamento encontrado.</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-2">
              {eventos.map((evento, index) => (
                <div key={evento.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold">Nutrição</Badge>
                        {index === 0 && <Badge variant="outline" className="text-[10px]">Último registro</Badge>}
                        <span className="text-[10px] text-slate-500">{new Date(evento.data_lancamento).toLocaleDateString("pt-BR")}</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-900">{evento.produto}</div>
                      <div className="space-y-0.5 text-[10px] text-slate-600">
                        <div><strong>Quantidade:</strong> {(evento.quantidade_total_kg || 0).toFixed(2)} kg</div>
                        <div><strong>Sobra:</strong> {(evento.sobra_kg || 0).toFixed(2)} kg</div>
                        <div><strong>Cabeças:</strong> {evento.total_cabecas_afetadas || 0}</div>
                        <div><strong>Peso de consumo:</strong> {(evento.peso_total_consumo || 0).toFixed(2)}</div>
                        {evento.observacoes && <div className="break-words"><strong>Detalhes:</strong> {evento.observacoes}</div>}
                        {index !== 0 && <div className="text-amber-700 font-medium"><strong>Bloqueio:</strong> somente o último lançamento pode ser editado ou excluído.</div>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 flex-col sm:flex-row">
                      <Button variant="outline" size="sm" className="h-8 text-xs" disabled={index !== 0} onClick={() => { setEditEvento(evento); setShowEdit(true); }}>Editar</Button>
                      <Button variant="destructive" size="sm" className="h-8 text-xs" disabled={index !== 0 || deletingId === evento.id} onClick={() => handleDelete(evento, index)}>Excluir</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Editar Lançamento</DialogTitle></DialogHeader>
          {editEvento && (
            <div className="space-y-2">
              <label className="text-xs text-slate-600">Data</label>
              <Input type="date" className="h-8 text-xs" value={editEvento.data_lancamento || ""} onChange={(e) => setEditEvento({ ...editEvento, data_lancamento: e.target.value })} />
              <label className="text-xs text-slate-600">Sobra (kg)</label>
              <Input type="number" step="0.01" className="h-8 text-xs" value={editEvento.sobra_kg || 0} onChange={(e) => setEditEvento({ ...editEvento, sobra_kg: parseFloat(e.target.value || 0) })} />
              <label className="text-xs text-slate-600">Observações</label>
              <Textarea rows={3} className="text-xs" value={editEvento.observacoes || ""} onChange={(e) => setEditEvento({ ...editEvento, observacoes: e.target.value })} />
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEdit(false)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                  await updateMutation.mutateAsync({ id: editEvento.id, data: { data_lancamento: editEvento.data_lancamento, sobra_kg: editEvento.sobra_kg, observacoes: editEvento.observacoes } });
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