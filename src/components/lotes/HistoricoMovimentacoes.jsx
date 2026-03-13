import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, TrendingUp, X, Plus, ArrowRight } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { aplicarSnapshotsLote, movimentacaoAfetaIds, getIdsAfetados } from "./movimentacaoLoteUtils";

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
  "Pesagem": "bg-emerald-100 text-emerald-800",
  "Renomeação de Lote": "bg-slate-100 text-slate-800",
  "União de Lotes": "bg-amber-100 text-amber-800"
};

export default function HistoricoMovimentacoes({ lotesIds, areaId }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [editMov, setEditMov] = React.useState(null);
  const [showEdit, setShowEdit] = React.useState(false);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MovimentacaoMapa.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MovimentacaoMapa.delete(id)
  });

  const handleDelete = async (mov) => {
    if (!confirm('Excluir este registro? O lote será ajustado automaticamente.')) return;

    const all = await base44.entities.MovimentacaoMapa.list('-data_movimentacao');
    const snapshotsAntes = Array.isArray(mov.lotes_antes) ? mov.lotes_antes : [];
    const snapshotsDepois = Array.isArray(mov.lotes_depois) ? mov.lotes_depois : [];
    const idsAfetados = getIdsAfetados(mov);

    if (snapshotsAntes.length > 0 && snapshotsDepois.length > 0 && idsAfetados.length > 0) {
      const posteriores = all
        .filter(item => item.id !== mov.id && new Date(item.data_movimentacao) > new Date(mov.data_movimentacao))
        .filter(item => movimentacaoAfetaIds(item, idsAfetados))
        .sort((a, b) => new Date(a.data_movimentacao) - new Date(b.data_movimentacao));

      await aplicarSnapshotsLote(snapshotsAntes);
      for (const item of posteriores) {
        if (Array.isArray(item.lotes_depois) && item.lotes_depois.length > 0) {
          await aplicarSnapshotsLote(item.lotes_depois);
        }
      }
    } else {
      const lotesAll = await base44.entities.Lote.list();
      const loteAtual = mov.lote_id
        ? lotesAll.find(l => l.id === mov.lote_id)
        : lotesAll.find(l => l.nome === mov.lote || l.identificacao === mov.lote);

      if (loteAtual) {
        if (mov.tipo === 'Morte' || mov.tipo === 'Abate') {
          await base44.entities.Lote.update(loteAtual.id, {
            quantidade_cabecas: (loteAtual.quantidade_cabecas || 0) + (mov.quantidade_animais || 0),
            status: 'Ativo'
          });
        } else if (mov.tipo === 'Nascimento') {
          const novaQuantidade = Math.max(0, (loteAtual.quantidade_cabecas || 0) - (mov.quantidade_animais || 0));
          await base44.entities.Lote.update(loteAtual.id, {
            quantidade_cabecas: novaQuantidade,
            status: novaQuantidade > 0 ? 'Ativo' : 'Inativo'
          });
        } else if (mov.tipo === 'Pesagem') {
          const matchPeso = (mov.observacoes || '').match(/Peso anterior:\s*([0-9.,]+)/i);
          if (matchPeso) {
            await base44.entities.Lote.update(loteAtual.id, {
              peso_medio_kg: Number(matchPeso[1].replace(',', '.')) || loteAtual.peso_medio_kg
            });
          }
        } else if (mov.tipo === 'Mudança de Categoria') {
          const matchCategoria = (mov.observacoes || '').match(/de\s+(.+?)\s+para\s+(.+?)(\.|$)/i);
          if (matchCategoria) {
            await base44.entities.Lote.update(loteAtual.id, {
              categoria: matchCategoria[1].trim()
            });
          }
        } else if (mov.tipo === 'Transferência de Área' && mov.area_origem_id) {
          await base44.entities.Lote.update(loteAtual.id, {
            area_atual_id: mov.area_origem_id,
            area_atual_nome: mov.area_origem_nome || loteAtual.area_atual_nome
          });
        }
      }
    }

    await deleteMutation.mutateAsync(mov.id);
    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    try { window.dispatchEvent(new Event('atualizar-mapa')); } catch {}
  };

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['historico-movimentacoes', lotesIds, areaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoMapa.list('-data_movimentacao');
      return all.filter(m => {
        if (m.empresa_id !== empresaSelecionadaId) return false;
        
        // Se tiver areaId, filtra por área origem ou destino
        if (areaId) {
          return m.area_origem_id === areaId || m.area_destino_id === areaId;
        }
        
        // Caso contrário, filtra por lotes
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
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
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
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Histórico de Movimentações ({movimentacoes.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="max-h-[500px] overflow-y-auto pr-2 space-y-3">
          {movimentacoes.map((mov) => (
            <div key={mov.id} className="bg-white border border-slate-300 rounded-lg p-3 hover:bg-slate-50 transition-colors">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={`text-xs font-semibold ${CORES_TIPO[mov.tipo] || 'bg-slate-100 text-slate-800'}`}>
                      {mov.tipo}
                    </Badge>
                    <span className="text-xs text-slate-600">{new Date(mov.data_movimentacao).toLocaleDateString('pt-BR')}</span>
                    <span className="text-xs font-semibold text-emerald-700">{mov.quantidade_animais} {mov.quantidade_animais === 1 ? 'animal' : 'animais'}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div><span className="font-semibold text-slate-700">Lote:</span> <span className="text-slate-900">{mov.lote || '-'}</span></div>
                    <div><span className="font-semibold text-slate-700">Área:</span> <span className="text-slate-900">{mov.area_destino_nome || mov.area_origem_nome || '-'}</span></div>
                    {mov.peso_medio && <div><span className="font-semibold text-slate-700">Peso médio:</span> <span className="text-slate-900">{mov.peso_medio} kg</span></div>}
                    {mov.categoria_animal && <div><span className="font-semibold text-slate-700">Categoria:</span> <span className="text-slate-900">{mov.categoria_animal}</span></div>}
                  </div>
                  {mov.observacoes && (
                    <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded p-2 leading-relaxed">
                      {mov.observacoes}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 md:pl-4">
                  <Button variant="outline" size="sm" className="h-8 text-xs"
                    onClick={() => { setEditMov(mov); setShowEdit(true); }}>
                    Editar
                  </Button>
                  <Button variant="destructive" size="sm" className="h-8 text-xs"
                    disabled={deleteMutation.isPending}
                    onClick={() => handleDelete(mov)}>
                    Excluir
                  </Button>
                </div>
              </div>
            </div>
          ))}
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