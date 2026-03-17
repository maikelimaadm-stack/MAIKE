import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { excluirEventoSuplementacaoComReversao } from "./historicoSuplementacaoUtils";
import { safeDivide } from "../utils/pecuariaUtils";
import CardMetricaEvento from "./CardMetricaEvento";
import DesvioConsumoTag from "./DesvioConsumoTag";

export default function HistoricoSuplementacaoPonto({ pontoId, pontoNome, ponto }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const { data: user } = useQuery({ queryKey: ["user-historico-suplementacao"], queryFn: () => base44.auth.me() });

  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["suplementacao-ponto", pontoId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter((evento) => evento.empresa_id === empresaSelecionadaId && evento.ponto_suplementacao_id === pontoId).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!pontoId
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ["movimentacoes-bloqueio-suplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoMapa.list('-data_movimentacao');
      return all.filter((mov) => mov.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const podeExcluirEvento = React.useCallback(async (evento) => {
    const lotesSuplementacao = await base44.entities.SuplementacaoLote.list();
    const lotesRelacionados = lotesSuplementacao.filter((item) => item.suplementacao_evento_id === evento.id);
    const loteIds = new Set(lotesRelacionados.map((item) => item.lote_id).filter(Boolean));
    const loteNomes = new Set(lotesRelacionados.map((item) => String(item.lote_nome || '').trim().toUpperCase()).filter(Boolean));
    const areasEvento = new Set([evento.area_id, ...(Array.isArray(evento.area_ids) ? evento.area_ids : [])].filter(Boolean));
    const dataEvento = new Date(evento.data_lancamento || evento.created_date || 0).getTime();

    const existeMovimentoPosterior = movimentacoes.some((mov) => {
      const dataMov = new Date(mov.data_movimentacao || mov.created_date || 0).getTime();
      if (dataMov <= dataEvento) return false;

      const mesmaArea = areasEvento.size === 0 || areasEvento.has(mov.area_origem_id) || areasEvento.has(mov.area_destino_id);
      const mesmoLote = (mov.lote_id && loteIds.has(mov.lote_id)) || loteNomes.has(String(mov.lote || '').trim().toUpperCase());
      return mesmaArea && mesmoLote;
    });

    return !existeMovimentoPosterior;
  }, [movimentacoes]);

  const handleDelete = async (evento, index) => {
    if (index !== 0) return toast.error("Exclua primeiro o último lançamento.");
    const permitido = await podeExcluirEvento(evento);
    if (!permitido) return toast.error("Este lançamento do cocho não pode ser excluído porque já existem movimentações posteriores ligadas aos lotes/área.");
    if (!confirm("Excluir este lançamento e reverter o estoque do depósito?")) return;
    setDeletingId(evento.id);
    try {
      await excluirEventoSuplementacaoComReversao({ evento, ponto, userEmail: user?.email });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["suplementacao-ponto", "eventos-ponto", "mapa-eventos-supl", "mapa-pontos-supl", "lotes-nota-suplementacao", "movimentacoes", "produtos"].includes(query.queryKey[0]) });
      toast.success("Lançamento excluído.");
    } catch (error) {
      toast.error(error.message || "Não foi possível excluir o lançamento.");
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) return <div className="text-center py-8 text-xs text-slate-500">Carregando...</div>;

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50 border-b py-3 px-3">
          <CardTitle className="text-sm font-semibold">Histórico do Cocho ({eventos.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {eventos.length === 0 ?
          <div className="text-center py-8 text-xs text-slate-500">Nenhum lançamento encontrado.</div> :
          <div className="max-h-[60vh] overflow-y-auto space-y-1">
            {eventos.map((evento, index) => {
              const periodoFechado = (evento.dias_periodo || 0) > 0;
              const cabecas = evento.total_cabecas_afetadas || 0;
              const consumoDiarioGrupo = evento.consumo_diario_grupo_kg || 0;
              const consumoCabDia = cabecas > 0 ? safeDivide(consumoDiarioGrupo, cabecas) : 0;
              const consumoEsperadoPV = evento.consumo_esperado_pv_kg || 0;
              const consumoEsperadoCabDia = consumoEsperadoPV > 0 && cabecas > 0 ? consumoEsperadoPV / cabecas : 0;

              return (
                <div key={evento.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50 space-y-1">
                  {/* Header com data e botão */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">{evento.data_lancamento?.includes("T") ? evento.data_lancamento.split("T")[0].split("-").reverse().join("/") : new Date(evento.data_lancamento).toLocaleDateString("pt-BR")}</span>
                      <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
                        {periodoFechado ? 'Fechado' : 'Em aberto'}
                      </Badge>
                      {periodoFechado && consumoEsperadoCabDia > 0 &&
                        <DesvioConsumoTag real={consumoCabDia} esperado={consumoEsperadoCabDia} />
                      }
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="destructive" size="sm" className="h-7 text-[10px] px-2" disabled={index !== 0 || deletingId === evento.id || bloqueiosPorEvento[evento.id]} onClick={() => handleDelete(evento, index)}>Excluir</Button>
                    </div>
                  </div>

                  {/* Produto */}
                  <div className="text-xs font-semibold text-slate-900">{evento.produto}</div>

                  {/* Métricas organizadas por seção */}
                  <CardMetricaEvento evento={evento} showProjecao={true} />

                  {evento.observacoes && <div className="text-[10px] text-slate-500 break-words">Obs: {evento.observacoes}</div>}
                  {bloqueiosPorEvento[evento.id] && <div className="text-[10px] text-amber-600 font-medium">Existem movimentações posteriores na área após este lançamento.</div>}
                  {index !== 0 && <div className="text-[10px] text-slate-500 font-medium">Somente o último lançamento pode ser excluído.</div>}
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