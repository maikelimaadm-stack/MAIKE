import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { excluirEventoSuplementacaoComReversao } from "./historicoSuplementacaoUtils";
import { formatDecimal, formatKg } from "./formatters";
import { safeDivide } from "../utils/pecuariaUtils";

function DesvioTag({ real, esperado }) {
  if (!esperado || esperado <= 0 || !real || real <= 0) return null;
  const desvio = (real - esperado) / esperado * 100;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-slate-300 bg-slate-100 text-[10px] font-semibold text-slate-700">
      {desvio > 0 ? "+" : ""}{desvio.toFixed(0)}%
    </span>
  );
}

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

  const handleDelete = async (evento, index) => {
    if (index !== 0) return toast.error("Exclua primeiro o último lançamento.");
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
              const pesoMedio = evento.peso_medio_lotes_kg || 0;

              return (
                <div key={evento.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50 space-y-1">
                  {/* Header com badges e botões */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">{new Date(evento.data_lancamento).toLocaleDateString("pt-BR")}</span>
                      {index === 0 && <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">Último</Badge>}
                      <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
                        {periodoFechado ? `${evento.dias_periodo} dia(s)` : 'Em aberto'}
                      </Badge>
                      {periodoFechado && consumoEsperadoCabDia > 0 &&
                        <DesvioTag real={consumoCabDia} esperado={consumoEsperadoCabDia} />
                      }
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="destructive" size="sm" className="h-7 text-[10px] px-2" disabled={index !== 0 || deletingId === evento.id} onClick={() => handleDelete(evento, index)}>Excluir</Button>
                    </div>
                  </div>

                  {/* Produto */}
                  <div className="text-xs font-semibold text-slate-900">{evento.produto}</div>

                  {/* Métricas - grid padrão sm:2 md:4 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Fornecido: <span className="font-semibold text-slate-900">{formatKg(evento.quantidade_total_kg || 0)}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Sobra: <span className="font-semibold text-slate-900">{formatKg(evento.sobra_kg || 0)}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Cabeças: <span className="font-semibold text-slate-900">{formatDecimal(cabecas, 0, true)}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Peso médio: <span className="font-semibold text-slate-900">{pesoMedio > 0 ? `${formatDecimal(pesoMedio, 0)} kg` : '-'}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Consumo PV/dia: <span className="font-semibold text-slate-900">{consumoEsperadoPV > 0 ? formatKg(consumoEsperadoPV) : '-'}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Consumo cab/dia: <span className="font-semibold text-slate-900">{consumoEsperadoCabDia > 0 ? `${formatDecimal(consumoEsperadoCabDia, 3)} kg` : '-'}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Realizado cab/dia: <span className="font-semibold text-slate-900">{periodoFechado && consumoCabDia > 0 ? `${formatDecimal(consumoCabDia, 3)} kg` : '-'}</span></div>
                    <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Fechamento: <span className="font-semibold text-slate-900">{periodoFechado ? `${evento.dias_periodo} dia(s)` : 'Em aberto'}</span></div>
                  </div>

                  {evento.observacoes && <div className="text-[10px] text-slate-500 break-words">Obs: {evento.observacoes}</div>}
                  {index !== 0 && <div className="text-[10px] text-slate-500 font-medium">Somente o último lançamento pode ser editado ou excluído.</div>}
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