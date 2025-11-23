import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, AlertCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import FormularioLancamentoSuplementacao from "../suplementacao/FormularioLancamentoSuplementacao";
import HistoricoSuplementacaoPonto from "../suplementacao/HistoricoSuplementacaoPonto";
import { toast } from "sonner";

export default function DetalhesPontoSuplementacao({ ponto, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showLancamento, setShowLancamento] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const queryClient = useQueryClient();

  const { data: eventos = [] } = useQuery({
    queryKey: ['eventos-ponto', ponto.id],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter(e => 
        e.empresa_id === empresaSelecionadaId && 
        e.ponto_suplementacao_id === ponto.id
      ).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!ponto.id,
  });

  const lancamentoMutation = useMutation({
    mutationFn: async ({ evento, lotes }) => {
      const eventoCreated = await base44.entities.SuplementacaoEvento.create(evento);
      
      for (const lote of lotes) {
        await base44.entities.SuplementacaoLote.create({
          ...lote,
          suplementacao_evento_id: eventoCreated.id
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventos-ponto'] });
      queryClient.invalidateQueries({ queryKey: ['suplementacao-lote'] });
      toast.success('Suplementação registrada com sucesso');
      setShowLancamento(false);
    },
  });

  const handleLancamento = (data) => {
    lancamentoMutation.mutate(data);
  };

  const ultimoEvento = eventos.length > 0 ? eventos[0] : null;
  const diasSemLancamento = ultimoEvento
    ? Math.floor((new Date() - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24))
    : null;

  const totalFornecido = eventos.reduce((sum, e) => sum + e.quantidade_total_kg, 0);
  const temAlerta = ponto.status === 'Ativo' && 
    (diasSemLancamento === null || diasSemLancamento > (ponto.alerta_sem_lancamento_dias || 10));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between pb-2 border-b">
        <div>
          <div className="text-sm font-bold text-slate-900 mb-1">{ponto.nome_ponto}</div>
          <div className="flex items-center gap-2">
            <Badge variant={ponto.status === 'Ativo' ? 'default' : 'secondary'} className="text-xs">
              {ponto.status}
            </Badge>
            {temAlerta && (
              <Badge className="bg-amber-100 text-amber-800 text-xs">
                <AlertCircle className="w-3 h-3 mr-1" />
                Alerta
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
          <div className="text-[11px] font-bold text-slate-900 mb-2">Informações</div>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex gap-2">
              <span className="font-medium text-slate-600 whitespace-nowrap">Tipo:</span>
              <span className="font-semibold text-slate-900">{ponto.tipo}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-medium text-slate-600 whitespace-nowrap">Área:</span>
              <span className="font-semibold text-slate-900">{ponto.area_vinculada_nome}</span>
            </div>
            {ponto.produto_padrao && (
              <div className="flex gap-2">
                <span className="font-medium text-slate-600 whitespace-nowrap">Produto:</span>
                <span className="font-semibold text-slate-900">{ponto.produto_padrao}</span>
              </div>
            )}
            {ponto.capacidade_cocho_kg && (
              <div className="flex gap-2">
                <span className="font-medium text-slate-600 whitespace-nowrap">Capacidade:</span>
                <span className="font-semibold text-slate-900">{ponto.capacidade_cocho_kg} kg</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
          <div className="grid grid-cols-3 gap-3 text-[10px]">
            <div>
              <div className="text-slate-600 mb-0.5">Lançamentos</div>
              <div className="text-sm font-bold text-slate-900">{eventos.length}</div>
            </div>
            <div>
              <div className="text-slate-600 mb-0.5">Total fornecido</div>
              <div className="text-sm font-bold text-slate-900">{totalFornecido.toFixed(0)} kg</div>
            </div>
            <div>
              <div className="text-slate-600 mb-0.5">Último lançamento</div>
              <div className="text-sm font-bold text-slate-900">
                {diasSemLancamento !== null ? `${diasSemLancamento}d` : '-'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          onClick={() => setShowLancamento(true)}
          variant="outline"
          className="h-11 text-[10px] font-semibold border-slate-300 hover:bg-slate-50 gap-1 flex-col py-1.5"
        >
          <span>Lançar</span>
        </Button>

        <Button
          onClick={() => setShowHistorico(true)}
          variant="outline"
          className="h-11 text-[10px] font-semibold border-slate-300 hover:bg-slate-50 gap-1 flex-col py-1.5"
        >
          <TrendingUp className="w-4 h-4 text-slate-600" />
          <span>Histórico</span>
        </Button>
      </div>

      <Dialog open={showLancamento} onOpenChange={setShowLancamento}>
        <DialogContent className="max-w-2xl">
          <FormularioLancamentoSuplementacao
            ponto={ponto}
            onSubmit={handleLancamento}
            onCancel={() => setShowLancamento(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <HistoricoSuplementacaoPonto
            pontoId={ponto.id}
            pontoNome={ponto.nome_ponto}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}