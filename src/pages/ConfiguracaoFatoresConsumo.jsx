import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

export default function ConfiguracaoFatoresConsumo() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [editando, setEditando] = useState(null);
  const [novoFator, setNovoFator] = useState({ categoria: "", fator: "", descricao: "" });
  const queryClient = useQueryClient();

  const { data: fatores = [] } = useQuery({
    queryKey: ['fatores-consumo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FatorConsumoCategoria.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.tipo_entidade === 'Lote' && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FatorConsumoCategoria.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fatores-consumo'] });
      setNovoFator({ categoria: "", fator: "", descricao: "" });
      toast.success('Fator cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FatorConsumoCategoria.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fatores-consumo'] });
      setEditando(null);
      toast.success('Fator atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FatorConsumoCategoria.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fatores-consumo'] });
      toast.success('Fator excluído!');
    },
  });

  const handleCreate = () => {
    if (!novoFator.categoria || !novoFator.fator) {
      toast.error('Preencha categoria e fator!');
      return;
    }

    createMutation.mutate({
      empresa_id: empresaSelecionadaId,
      categoria: novoFator.categoria.toUpperCase(),
      fator: parseFloat(novoFator.fator),
      descricao: novoFator.descricao?.toUpperCase(),
      ativo: true
    });
  };

  const handleUpdate = (fator) => {
    if (!fator.categoria || !fator.fator) {
      toast.error('Preencha categoria e fator!');
      return;
    }

    updateMutation.mutate({
      id: fator.id,
      data: {
        categoria: fator.categoria.toUpperCase(),
        fator: parseFloat(fator.fator),
        descricao: fator.descricao?.toUpperCase()
      }
    });
  };

  const categoriasDisponiveis = iconesConfig.map(ic => ic.categoria).filter(Boolean);
  const fatoresPadrao = [
    { categoria: "BEZERRO 0 A 12 MESES", fator: 0.5 },
    { categoria: "BEZERRA 0 A 12 MESES", fator: 0.5 },
    { categoria: "NOVILHO 12 A 24 MESES", fator: 0.8 },
    { categoria: "NOVILHA 12 A 24 MESES", fator: 0.75 },
    { categoria: "GARROTE 24 A 36 MESES", fator: 0.9 },
    { categoria: "VACA SECA", fator: 1.0 },
    { categoria: "VACA LACTAÇÃO", fator: 1.2 },
    { categoria: "TOURO", fator: 1.3 }
  ];

  const aplicarFatoresPadrao = () => {
    fatoresPadrao.forEach(fp => {
      const existe = fatores.find(f => f.categoria === fp.categoria);
      if (!existe) {
        createMutation.mutate({
          empresa_id: empresaSelecionadaId,
          categoria: fp.categoria,
          fator: fp.fator,
          descricao: `Fator padrão para ${fp.categoria}`,
          ativo: true
        });
      }
    });
    toast.success('Fatores padrão aplicados!');
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Fatores de Consumo por Categoria</h1>
          <p className="text-xs text-slate-600">Configure os fatores para cálculo de suplementação</p>
        </div>
        <Button onClick={aplicarFatoresPadrao} size="sm" className="h-8 text-xs">
          Aplicar Fatores Padrão
        </Button>
      </div>

      <Card>
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Novo Fator</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Categoria *</Label>
              <Input
                value={novoFator.categoria}
                onChange={(e) => setNovoFator({ ...novoFator, categoria: e.target.value })}
                placeholder="VACA SECA"
                className="h-8 text-xs uppercase"
                list="categorias-list"
              />
              <datalist id="categorias-list">
                {categoriasDisponiveis.map(cat => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Fator *</Label>
              <Input
                type="number"
                step="0.1"
                value={novoFator.fator}
                onChange={(e) => setNovoFator({ ...novoFator, fator: e.target.value })}
                placeholder="1.0"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Input
                value={novoFator.descricao}
                onChange={(e) => setNovoFator({ ...novoFator, descricao: e.target.value })}
                placeholder="DESCRIÇÃO"
                className="h-8 text-xs uppercase"
              />
            </div>

            <Button onClick={handleCreate} size="sm" className="h-8 text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" />
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Fatores Cadastrados</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-2">
            {fatores.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                Nenhum fator cadastrado. Clique em "Aplicar Fatores Padrão" para começar.
              </div>
            ) : (
              fatores.map(fator => (
                <div key={fator.id} className="bg-white border border-slate-200 rounded-lg p-3">
                  {editando?.id === fator.id ? (
                    <div className="grid grid-cols-4 gap-3 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Categoria</Label>
                        <Input
                          value={editando.categoria}
                          onChange={(e) => setEditando({ ...editando, categoria: e.target.value })}
                          className="h-8 text-xs uppercase"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Fator</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={editando.fator}
                          onChange={(e) => setEditando({ ...editando, fator: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Descrição</Label>
                        <Input
                          value={editando.descricao || ""}
                          onChange={(e) => setEditando({ ...editando, descricao: e.target.value })}
                          className="h-8 text-xs uppercase"
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button onClick={() => handleUpdate(editando)} size="sm" className="h-8 text-xs">
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button onClick={() => setEditando(null)} variant="outline" size="sm" className="h-8 text-xs">
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-slate-900 mb-1">{fator.categoria}</div>
                        <div className="flex items-center gap-3 text-xs">
                          <Badge className="bg-emerald-100 text-emerald-800">
                            Fator: {fator.fator}
                          </Badge>
                          {fator.descricao && (
                            <span className="text-slate-600">{fator.descricao}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          onClick={() => setEditando(fator)} 
                          variant="outline" 
                          size="sm" 
                          className="h-8 text-xs"
                        >
                          Editar
                        </Button>
                        <Button 
                          onClick={() => {
                            if (window.confirm('Excluir fator?')) {
                              deleteMutation.mutate(fator.id);
                            }
                          }}
                          variant="outline" 
                          size="sm" 
                          className="h-8 text-xs text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="text-xs text-blue-900 space-y-2">
            <p className="font-semibold">ℹ️ Como funciona:</p>
            <ul className="list-disc ml-4 space-y-1">
              <li>Os fatores definem quanto cada categoria consome em relação a uma vaca padrão (fator 1.0)</li>
              <li>Bezerros (fator 0.5) consomem metade do que uma vaca</li>
              <li>Vacas em lactação (fator 1.2) consomem 20% a mais</li>
              <li>O sistema distribui automaticamente o suplemento considerando esses fatores</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}