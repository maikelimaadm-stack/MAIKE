import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Syringe, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function SelecionarSanidadeAnimal({ 
  open, 
  onOpenChange, 
  empresaId, 
  numeroAnimal, 
  dataPesagem 
}) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  // Buscar configurações de sanidade
  const { data: configuracoes = [] } = useQuery({
    queryKey: ['configuracoes-sanidade', empresaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoSanidade.list();
      return all.filter(c => c.empresa_id === empresaId && c.ativo);
    },
    enabled: !!empresaId && open,
  });

  // Buscar itens de sanidade
  const { data: itensParaAplicar = [] } = useQuery({
    queryKey: ['itens-sanidade-todos'],
    queryFn: async () => {
      const all = await base44.entities.ItemSanidade.list();
      return all;
    },
    enabled: open,
  });

  // Buscar sanidades já aplicadas neste animal
  const { data: sanidadesAplicadas = [] } = useQuery({
    queryKey: ['sanidades-aplicadas', numeroAnimal, dataPesagem],
    queryFn: async () => {
      const all = await base44.entities.SanidadeAnimal.list();
      return all.filter(s => 
        s.numero_animal === numeroAnimal && 
        s.data_aplicacao === dataPesagem
      );
    },
    enabled: !!numeroAnimal && !!dataPesagem && open,
  });

  // Agrupar sanidades aplicadas por nome
  const sanidadesAgrupadas = React.useMemo(() => {
    const grupos = {};
    sanidadesAplicadas.forEach(s => {
      const key = s.configuracao_sanidade_id || 'sem_config';
      if (!grupos[key]) {
        grupos[key] = {
          nome: s.nome_sanidade || 'Sem nome',
          medicamentos: [],
          custoTotal: 0,
          ids: []
        };
      }
      grupos[key].medicamentos.push({
        nome: s.medicamento,
        quantidade: s.quantidade,
        unidade: s.unidade_medida,
        custo: s.custo_total || 0
      });
      grupos[key].custoTotal += (s.custo_total || 0);
      grupos[key].ids.push(s.id);
    });
    return Object.values(grupos);
  }, [sanidadesAplicadas]);

  const deleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await base44.entities.SanidadeAnimal.delete(id);
      }
    },
    onSuccess: () => {
      toast.success("Sanidade removida!");
      queryClient.invalidateQueries({ queryKey: ['sanidades-aplicadas'] });
    },
  });

  const handleAplicarSanidade = async (configuracao) => {
    const itens = itensParaAplicar.filter(i => i.configuracao_sanidade_id === configuracao.id);
    
    if (itens.length === 0) {
      toast.error("Esta sanidade não possui medicamentos cadastrados!");
      return;
    }

    if (!confirm(`Aplicar "${configuracao.nome_sanidade}" no animal ${numeroAnimal}?`)) return;

    setIsSaving(true);
    try {
      const registros = [];
      for (const item of itens) {
        const qtd = item.quantidade_padrao || 0;
        const custo = item.custo_unitario || 0;
        registros.push({
          empresa_id: empresaId,
          configuracao_sanidade_id: configuracao.id,
          nome_sanidade: configuracao.nome_sanidade,
          numero_animal: numeroAnimal,
          data_aplicacao: dataPesagem,
          medicamento: item.medicamento,
          finalidade: item.finalidade || null,
          quantidade: qtd,
          unidade_medida: item.unidade_medida,
          custo_unitario: custo > 0 ? custo : null,
          custo_total: (qtd * custo) > 0 ? qtd * custo : null,
          observacao: null,
        });
      }

      await base44.entities.SanidadeAnimal.bulkCreate(registros);

      const custoTotal = registros.reduce((s, r) => s + (r.custo_total || 0), 0);
      toast.success(`✓ "${configuracao.nome_sanidade}" aplicada! Custo: R$ ${custoTotal.toFixed(2)}`);
      queryClient.invalidateQueries({ queryKey: ['sanidades-aplicadas'] });
    } catch (error) {
      toast.error("Erro: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700">
            <Syringe className="w-5 h-5" />
            Sanidade - Animal {numeroAnimal}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Sanidades Já Aplicadas */}
          {sanidadesAgrupadas.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-2">Sanidades Aplicadas</h3>
              <div className="space-y-2">
                {sanidadesAgrupadas.map((san, idx) => (
                  <Card key={idx} className="border-emerald-200 bg-emerald-50">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-semibold text-emerald-800 text-sm">{san.nome}</h4>
                          <div className="text-xs font-bold text-emerald-700 mt-1">
                            Custo: R$ {san.custoTotal.toFixed(2)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500"
                          onClick={() => {
                            if (confirm(`Remover "${san.nome}"?`)) {
                              deleteMutation.mutate(san.ids);
                            }
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {san.medicamentos.map((med, i) => (
                          <div key={i} className="text-xs text-slate-700 bg-white rounded px-2 py-1">
                            • {med.nome} - {med.quantidade} {med.unidade}
                            {med.custo > 0 && ` (R$ ${med.custo.toFixed(2)})`}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Aplicar Nova Sanidade */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 mb-2">Aplicar Sanidade</h3>
            {configuracoes.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                Nenhuma sanidade cadastrada
              </div>
            ) : (
              <div className="space-y-2">
                {configuracoes.map(c => {
                  const itens = itensParaAplicar.filter(i => i.configuracao_sanidade_id === c.id);
                  const custoTotal = itens.reduce((s, i) => s + ((i.quantidade_padrao || 0) * (i.custo_unitario || 0)), 0);

                  return (
                    <Card key={c.id} className="border-slate-200">
                      <CardContent className="p-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-800 text-sm">{c.nome_sanidade}</h4>
                            {custoTotal > 0 && (
                              <div className="text-xs font-bold text-emerald-700 mt-1">
                                Custo: R$ {custoTotal.toFixed(2)}
                              </div>
                            )}
                            {itens.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {itens.map((item, idx) => (
                                  <div key={idx} className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1">
                                    • {item.medicamento} - {item.quantidade_padrao} {item.unidade_medida}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button 
                            onClick={() => handleAplicarSanidade(c)}
                            disabled={isSaving || itens.length === 0}
                            size="sm" 
                            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                          >
                            Aplicar
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="sm" className="h-8 text-xs">
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}