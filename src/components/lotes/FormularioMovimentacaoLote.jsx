import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { X, Plus, Save } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function FormularioMovimentacaoLote({ lotesOriginais, areaOrigem, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState(() => {
    const areaDestino = window.areaDestinoArrastada;
    return {
      data_movimentacao: new Date().toISOString().split('T')[0],
      mover_todos: 'sim',
      area_saida_id: areaOrigem?.id || '',
      areas_entrada: areaDestino ? [areaDestino] : [],
      movimentacoes: [],
      unir_lotes: {}
    };
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: todosLotes = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
  });

  // Agrupar lotes por categoria
  const categoriasPorLote = lotesOriginais.reduce((acc, lote) => {
    const cat = lote.categoria?.toUpperCase() || 'SEM CATEGORIA';
    if (!acc[cat]) {
      acc[cat] = {
        categoria: cat,
        quantidade_total: 0,
        peso_medio: lote.peso_medio_kg || 0,
        lotes: []
      };
    }
    acc[cat].quantidade_total += lote.quantidade_cabecas || 0;
    acc[cat].lotes.push(lote);
    return acc;
  }, {});

  const categorias = Object.values(categoriasPorLote);

  // Verificar se há lotes com mesma categoria nas áreas de destino
  const categoriasComLotesExistentes = React.useMemo(() => {
    if (formData.areas_entrada.length === 0) return {};
    
    const resultado = {};
    formData.areas_entrada.forEach(areaId => {
      if (!areaId) return;
      
      const lotesNaArea = todosLotes.filter(l => l.area_atual_id === areaId);
      
      categorias.forEach(cat => {
        const loteExistente = lotesNaArea.find(l => l.categoria?.toUpperCase() === cat.categoria);
        if (loteExistente) {
          if (!resultado[cat.categoria]) {
            resultado[cat.categoria] = [];
          }
          resultado[cat.categoria].push({
            area_nome: areas.find(a => a.id === areaId)?.nome || '',
            lote: loteExistente
          });
        }
      });
    });
    
    return resultado;
  }, [formData.areas_entrada, todosLotes, areas, categorias]);

  // Inicializar movimentações quando mudar para "não"
  React.useEffect(() => {
    if (formData.mover_todos === 'nao' && formData.movimentacoes.length === 0) {
      const novasMovimentacoes = categorias.map(cat => ({
        categoria: cat.categoria,
        quantidade: cat.quantidade_total,
        peso_medio: cat.peso_medio,
        quantidade_maxima: cat.quantidade_total
      }));
      setFormData({ ...formData, movimentacoes: novasMovimentacoes });
    } else if (formData.mover_todos === 'sim') {
      setFormData({ ...formData, movimentacoes: [] });
    }
  }, [formData.mover_todos]);

  const handleAddAreaEntrada = () => {
    if (formData.areas_entrada.length < 5) {
      setFormData({
        ...formData,
        areas_entrada: [...formData.areas_entrada, '']
      });
    }
  };

  const handleRemoveAreaEntrada = (index) => {
    const novasAreas = formData.areas_entrada.filter((_, i) => i !== index);
    setFormData({ ...formData, areas_entrada: novasAreas });
  };

  const handleAreaEntradaChange = (index, valor) => {
    const novasAreas = [...formData.areas_entrada];
    novasAreas[index] = valor;
    setFormData({ ...formData, areas_entrada: novasAreas });
  };

  const handleMovimentacaoChange = (index, field, value) => {
    const novasMovimentacoes = [...formData.movimentacoes];
    novasMovimentacoes[index] = {
      ...novasMovimentacoes[index],
      [field]: field === 'quantidade' || field === 'peso_medio' ? (value === '' ? '' : parseFloat(value) || 0) : value
    };
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleRemoveMovimentacao = (index) => {
    const novasMovimentacoes = formData.movimentacoes.filter((_, i) => i !== index);
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.area_saida_id) {
      alert('Selecione a área de saída');
      return;
    }

    if (formData.areas_entrada.length === 0 || formData.areas_entrada.some(a => !a)) {
      alert('Adicione pelo menos uma área de entrada válida');
      return;
    }

    if (formData.mover_todos === 'nao') {
      if (formData.movimentacoes.length === 0) {
        alert('Adicione pelo menos uma movimentação');
        return;
      }
      
      const temQuantidadeInvalida = formData.movimentacoes.some(m => !m.quantidade || m.quantidade <= 0);
      if (temQuantidadeInvalida) {
        alert('Todas as movimentações devem ter quantidade maior que zero');
        return;
      }
    }

    console.log('Enviando movimentação:', formData);
    setLoading(true);
    try {
      await onSubmit(formData);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Movimentação de Lotes</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Data da Movimentação *</Label>
              <Input
                type="date"
                value={formData.data_movimentacao}
                onChange={(e) => setFormData({ ...formData, data_movimentacao: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Movimentar todo o lote? *</Label>
              <RadioGroup
                value={formData.mover_todos}
                onValueChange={(v) => setFormData({ ...formData, mover_todos: v })}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="sim" id="sim" />
                  <Label htmlFor="sim" className="text-xs cursor-pointer">Sim</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="nao" id="nao" />
                  <Label htmlFor="nao" className="text-xs cursor-pointer">Não</Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Área e módulo de saída *</Label>
              <Select
                value={formData.area_saida_id}
                onValueChange={(v) => setFormData({ ...formData, area_saida_id: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione a área de saída" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map(area => (
                    <SelectItem key={area.id} value={area.id} className="text-xs">
                      {area.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Área e módulo de entrada *</Label>
              <div className="space-y-2">
                {formData.areas_entrada.map((areaId, index) => (
                  <div key={index} className="flex gap-2">
                    <Select
                      value={areaId}
                      onValueChange={(v) => handleAreaEntradaChange(index, v)}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Selecione a área" />
                      </SelectTrigger>
                      <SelectContent>
                        {areas
                          .filter(a => a.id !== formData.area_saida_id)
                          .map(area => (
                            <SelectItem key={area.id} value={area.id} className="text-xs">
                              {area.nome}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveAreaEntrada(index)}
                      className="h-8 w-8 text-red-600"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddAreaEntrada}
                  className="h-7 text-xs w-full"
                  disabled={formData.areas_entrada.length >= 5}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Adicionar Área de Entrada
                </Button>
              </div>
            </div>
          </div>

          {formData.mover_todos === 'nao' && (
            <div className="border rounded p-3 bg-slate-50">
              <div className="text-xs font-semibold text-slate-700 mb-3">
                Selecione quantidade por categoria
              </div>
              <div className="space-y-3">
                {formData.movimentacoes.map((mov, index) => (
                  <div key={index} className="bg-white border rounded p-3">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
                      <div className="space-y-1">
                        <Label className="text-xs">Quantidade *</Label>
                        <Input
                          type="number"
                          value={mov.quantidade}
                          onChange={(e) => {
                            const valor = e.target.value;
                            if (valor === '' || parseFloat(valor) <= mov.quantidade_maxima) {
                              handleMovimentacaoChange(index, 'quantidade', valor);
                            }
                          }}
                          max={mov.quantidade_maxima}
                          className="h-8 text-xs"
                          required
                        />
                        <span className="text-[10px] text-slate-500">Máximo: {mov.quantidade_maxima} cabeças</span>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Categoria de Manejo</Label>
                        <Input
                          value={mov.categoria}
                          disabled
                          className="h-8 text-xs bg-slate-100 font-semibold"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Peso (kg)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={mov.peso_medio}
                          onChange={(e) => handleMovimentacaoChange(index, 'peso_medio', e.target.value)}
                          className="h-8 text-xs"
                          placeholder="Peso médio"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs opacity-0">.</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveMovimentacao(index)}
                          className="h-8 text-xs text-red-600 w-full"
                        >
                          <X className="w-3 h-3 mr-1" />
                          Remover
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Object.keys(categoriasComLotesExistentes).length > 0 && (
            <div className="border border-amber-300 rounded p-3 bg-amber-50">
              <div className="text-xs font-semibold text-amber-800 mb-3 flex items-center gap-2">
                <span className="text-lg">⚠️</span>
                Existem lotes com mesma categoria na(s) área(s) de destino
              </div>
              <div className="space-y-3">
                {Object.entries(categoriasComLotesExistentes).map(([categoria, lotes]) => (
                  <div key={categoria} className="bg-white border rounded p-3">
                    <div className="text-xs font-semibold text-slate-700 mb-2">{categoria}</div>
                    {lotes.map((item, idx) => (
                      <div key={idx} className="text-[10px] text-slate-600 mb-2">
                        • {item.area_nome}: {item.lote.nome} ({item.lote.quantidade_cabecas} cabeças)
                      </div>
                    ))}
                    <div className="mt-2">
                      <Label className="text-xs mb-2 block">Deseja unir ao lote existente?</Label>
                      <RadioGroup
                        value={formData.unir_lotes[categoria] || 'nao'}
                        onValueChange={(v) => setFormData({ 
                          ...formData, 
                          unir_lotes: { ...formData.unir_lotes, [categoria]: v }
                        })}
                        className="flex gap-4"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="sim" id={`unir-sim-${categoria}`} />
                          <Label htmlFor={`unir-sim-${categoria}`} className="text-xs cursor-pointer">Sim, unir</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="nao" id={`unir-nao-${categoria}`} />
                          <Label htmlFor={`unir-nao-${categoria}`} className="text-xs cursor-pointer">Não, criar novo</Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs" disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
              <Save className="w-3 h-3 mr-1" />
              {loading ? 'Movimentando...' : 'Avançar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}