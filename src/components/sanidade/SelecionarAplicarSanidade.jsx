import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Syringe } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function SelecionarAplicarSanidade({ open, onOpenChange, empresaId, apartacaoSelecionada, pesagensDia, dataPesagem, onGerenciar }) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  // Buscar configurações
  const { data: configuracoes = [] } = useQuery({
    queryKey: ['configuracoes-sanidade', empresaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoSanidade.list();
      return all.filter(c => c.empresa_id === empresaId && c.ativo);
    },
    enabled: !!empresaId && open,
  });

  // Buscar todos os itens
  const { data: todosItens = [] } = useQuery({
    queryKey: ['itens-sanidade-todos'],
    queryFn: async () => {
      const all = await base44.entities.ItemSanidade.list();
      return all;
    },
    enabled: open,
  });

  const handleAplicarSanidade = async (configId) => {
    if (!apartacaoSelecionada) {
      toast.error("Selecione uma apartação primeiro!");
      return;
    }

    const animaisParaAplicar = pesagensDia
      ?.filter(p => p.apartacao_id === apartacaoSelecionada)
      .map(p => p.numero_animal) || [];

    if (animaisParaAplicar.length === 0) {
      toast.error("Nenhum animal pesado nesta apartação hoje!");
      return;
    }

    const config = configuracoes.find(c => c.id === configId);
    const itens = todosItens.filter(i => i.configuracao_sanidade_id === configId);

    if (itens.length === 0) {
      toast.error("Esta sanidade não possui medicamentos cadastrados!");
      return;
    }

    if (!confirm(`Aplicar "${config.nome_sanidade}" em ${animaisParaAplicar.length} animal(is)?`)) return;

    setIsSaving(true);
    try {
      const registros = [];
      for (const numAnimal of animaisParaAplicar) {
        for (const item of itens) {
          const qtd = item.quantidade_padrao || 0;
          const custo = item.custo_unitario || 0;
          registros.push({
            empresa_id: empresaId,
            configuracao_sanidade_id: configId,
            nome_sanidade: config.nome_sanidade,
            numero_animal: numAnimal,
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
      }

      await base44.entities.SanidadeAnimal.bulkCreate(registros);

      const custoTotalGeral = registros.reduce((s, r) => s + (r.custo_total || 0), 0);
      const custoPorAnimal = custoTotalGeral / animaisParaAplicar.length;

      toast.success(`✓ "${config.nome_sanidade}" aplicada em ${animaisParaAplicar.length} animais! Total: R$ ${custoTotalGeral.toFixed(2)} (R$ ${custoPorAnimal.toFixed(2)}/animal)`);
      queryClient.invalidateQueries();
      onOpenChange(false);
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
            Aplicar Sanidade nos Animais Lançados
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded p-2">
            <p className="text-xs text-blue-800">
              ℹ️ Selecione uma sanidade abaixo para aplicar nos <strong>{pesagensDia?.filter(p => p.apartacao_id === apartacaoSelecionada).length || 0} animais</strong> pesados nesta apartação hoje.
            </p>
          </div>

          {configuracoes.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Syringe className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm mb-3">Nenhuma sanidade cadastrada</p>
              <Button 
                onClick={() => {
                  onOpenChange(false);
                  onGerenciar();
                }}
                size="sm" 
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Cadastrar Nova Sanidade
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {configuracoes.map(c => {
                const itens = todosItens.filter(i => i.configuracao_sanidade_id === c.id);
                const custoTotal = itens.reduce((s, i) => s + ((i.quantidade_padrao || 0) * (i.custo_unitario || 0)), 0);

                return (
                  <Card key={c.id} className="border-emerald-200 bg-white">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-emerald-800">{c.nome_sanidade}</h4>
                          <div className="text-xs font-bold text-emerald-700 mt-1">
                            Custo por animal: R$ {custoTotal.toFixed(2)}
                          </div>
                        </div>
                        <Button 
                          onClick={() => handleAplicarSanidade(c.id)}
                          disabled={isSaving || itens.length === 0}
                          size="sm" 
                          className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Aplicar
                        </Button>
                      </div>
                      {itens.length > 0 && (
                        <div className="space-y-1 mt-2">
                          {itens.map((item, idx) => (
                            <div key={idx} className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1">
                              • {item.medicamento} {item.finalidade && `(${item.finalidade})`} - {item.quantidade_padrao} {item.unidade_medida}
                              {item.custo_unitario > 0 && ` - R$ ${((item.quantidade_padrao || 0) * (item.custo_unitario || 0)).toFixed(2)}`}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 pt-3 border-t">
          <Button 
            variant="outline" 
            onClick={() => {
              onOpenChange(false);
              onGerenciar();
            }}
            size="sm" 
            className="h-8 text-xs"
          >
            Gerenciar Sanidades
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} size="sm" className="h-8 text-xs">
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}