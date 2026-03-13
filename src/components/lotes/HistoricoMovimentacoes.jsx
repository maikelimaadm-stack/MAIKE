import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const CORES_TIPO = {
  "Transferência de Área": "bg-blue-100 text-blue-800",
  "Morte": "bg-red-100 text-red-800",
  "Nascimento": "bg-green-100 text-green-800",
  "Abate": "bg-orange-100 text-orange-800",
  "Mudança de Categoria": "bg-purple-100 text-purple-800",
  "Pesagem": "bg-emerald-100 text-emerald-800",
  "Renomear Lote": "bg-slate-100 text-slate-800",
  "Junção de Lotes": "bg-indigo-100 text-indigo-800",
};

export default function HistoricoMovimentacoes({ lotesIds, areaId }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [editMov, setEditMov] = React.useState(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MovimentacaoMapa.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] })
  });

  const handleDelete = async (mov) => {
    // Só permite excluir a movimentação mais recente de cada lote
    const sameLote = movimentacoes.filter(m => m.lote === mov.lote);
    const later = sameLote.filter(m => m.id !== mov.id && new Date(m.data_movimentacao) > new Date(mov.data_movimentacao));
    if (later.length > 0) {
      alert('Não é possível excluir: existem movimentações posteriores deste lote. Exclua primeiramente as mais recentes.');
      return;
    }

    if (!confirm('Excluir este registro? O saldo será revertido automaticamente.')) return;

    setDeleting(true);
    try {
      // Encontrar o lote correspondente
      const lotesAll = await base44.entities.Lote.list();
      let loteRecord = null;
      if (mov.lote_id) {
        loteRecord = lotesAll.find(l => l.id === mov.lote_id) || null;
      }
      if (!loteRecord) {
        loteRecord = lotesAll.find(l => l.nome === mov.lote && l.empresa_id === empresaSelecionadaId) || null;
      }

      // Reverter saldo baseado no tipo de movimentação
      if (loteRecord) {
        const tipo = mov.tipo;
        const qtd = mov.quantidade_animais || 0;

        if (tipo === 'Morte' || tipo === 'Abate') {
          // Saída: reverter = somar de volta
          await base44.entities.Lote.update(loteRecord.id, {
            quantidade_cabecas: (loteRecord.quantidade_cabecas || 0) + qtd
          });
        } else if (tipo === 'Nascimento') {
          // Entrada: reverter = subtrair
          const novaQtd = Math.max(0, (loteRecord.quantidade_cabecas || 0) - qtd);
          await base44.entities.Lote.update(loteRecord.id, {
            quantidade_cabecas: novaQtd
          });
        } else if (tipo === 'Transferência de Área') {
          // Voltar para área de origem
          if (mov.area_origem_id) {
            await base44.entities.Lote.update(loteRecord.id, {
              area_atual_id: mov.area_origem_id,
              area_atual_nome: mov.area_origem_nome || ''
            });
          }
        } else if (tipo === 'Pesagem') {
          // Reverter peso: buscar peso anterior nas observações
          const obsMatch = (mov.observacoes || '').match(/Peso anterior:\s*([\d.]+)\s*kg/i);
          if (obsMatch) {
            const pesoAnterior = parseFloat(obsMatch[1]);
            await base44.entities.Lote.update(loteRecord.id, {
              peso_medio_kg: pesoAnterior
            });
          }
        } else if (tipo === 'Mudança de Categoria') {
          // Reverter categoria: buscar categoria anterior nas observações  
          const catMatch = (mov.observacoes || '').match(/De\s+(.+?)\s+para\s+/i);
          if (catMatch) {
            const catAnterior = catMatch[1];
            await base44.entities.Lote.update(loteRecord.id, {
              categoria: catAnterior
            });
          }
        }
      }

      // Deletar o registro
      await base44.entities.MovimentacaoMapa.delete(mov.id);

      // Atualizar queries
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
      try { window.dispatchEvent(new Event('atualizar-mapa')); } catch {}
      toast.success('Movimentação excluída e saldo revertido');
    } catch (e) {
      console.error('Erro ao excluir:', e);
      toast.error('Erro ao excluir movimentação');
    } finally {
      setDeleting(false);
    }
  };

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['historico-movimentacoes', lotesIds, areaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoMapa.list('-data_movimentacao');
      return all.filter(m => {
        if (m.empresa_id !== empresaSelecionadaId) return false;
        if (areaId) {
          return m.area_origem_id === areaId || m.area_destino_id === areaId;
        }
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
            <p className="text-sm">Nenhuma movimentação registrada</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">
          Histórico de Movimentações ({movimentacoes.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        <div className="max-h-[500px] overflow-y-auto space-y-1">
          {movimentacoes.map((mov) => {
            // Verificar se é a última do lote (pode excluir)
            const sameLote = movimentacoes.filter(m => m.lote === mov.lote);
            const isLast = !sameLote.some(m => m.id !== mov.id && new Date(m.data_movimentacao) > new Date(mov.data_movimentacao));

            return (
              <div key={mov.id} className="border border-slate-200 rounded p-2.5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Badge className={`text-[10px] font-semibold shrink-0 ${CORES_TIPO[mov.tipo] || 'bg-slate-100 text-slate-800'}`}>
                      {mov.tipo}
                    </Badge>
                    <span className="text-[11px] text-slate-600">
                      {new Date(mov.data_movimentacao).toLocaleDateString('pt-BR')}
                    </span>
                    <span className="text-[11px] font-bold text-slate-900">
                      {mov.quantidade_animais} cab
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2"
                      onClick={() => { setEditMov(mov); setShowEdit(true); }}>
                      Editar
                    </Button>
                    <Button variant="destructive" size="sm" className="h-6 text-[10px] px-2"
                      disabled={deleting || !isLast}
                      title={!isLast ? 'Exclua primeiro as movimentações mais recentes' : ''}
                      onClick={() => handleDelete(mov)}>
                      Excluir
                    </Button>
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-slate-600 space-y-0.5">
                  <div><strong>Lote:</strong> {mov.lote}</div>
                  {mov.tipo === 'Transferência de Área' && (
                    <div>{mov.area_origem_nome} → {mov.area_destino_nome}</div>
                  )}
                  {mov.peso_medio && <div>Peso médio: {mov.peso_medio} kg</div>}
                  {mov.observacoes && <div className="text-slate-500 truncate">{mov.observacoes}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>

    <Dialog open={showEdit} onOpenChange={setShowEdit}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Editar Movimentação</DialogTitle>
        </DialogHeader>
        {editMov && (
          <div className="space-y-2">
            <div>
              <label className="text-xs text-slate-600">Quantidade</label>
              <Input type="number" className="h-8 text-xs" value={editMov.quantidade_animais || 0}
                onChange={(e) => setEditMov({ ...editMov, quantidade_animais: parseInt(e.target.value || '0', 10) })} />
            </div>
            <div>
              <label className="text-xs text-slate-600">Observações</label>
              <Textarea rows={3} className="text-xs" value={editMov.observacoes || ''}
                onChange={(e) => setEditMov({ ...editMov, observacoes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEdit(false)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                onClick={async () => { await updateMutation.mutateAsync({ id: editMov.id, data: { quantidade_animais: editMov.quantidade_animais, observacoes: editMov.observacoes } }); setShowEdit(false); }}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}