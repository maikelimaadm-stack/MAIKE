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

  const [formData, setFormData] = useState({
    data_movimentacao: new Date().toISOString().split('T')[0],
    mover_todos: 'sim',
    area_saida_id: areaOrigem?.id || '',
    areas_entrada: [],
    movimentacoes: []
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
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
      [field]: field === 'quantidade' || field === 'peso_medio' ? parseFloat(value) || 0 : value
    };
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleRemoveMovimentacao = (index) => {
    const novasMovimentacoes = formData.movimentacoes.filter((_, i) => i !== index);
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.area_saida_id) {
      alert('Selecione a área de saída');
      return;
    }

    if (formData.areas_entrada.length === 0 || formData.areas_entrada.some(a => !a)) {
      alert('Adicione pelo menos uma área de entrada válida');
      return;
    }

    if (formData.mover_todos === 'nao' && formData.movimentacoes.length === 0) {
      alert('Adicione pelo menos uma movimentação');
      return;
    }

    onSubmit(formData);
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
              <div className="space-y-2">
                {formData.movimentacoes.map((mov, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-3">
                      <Label className="text-[10px]">Quantidade</Label>
                      <Input
                        type="number"
                        value={mov.quantidade}
                        onChange={(e) => handleMovimentacaoChange(index, 'quantidade', e.target.value)}
                        max={mov.quantidade_maxima}
                        className="h-7 text-xs"
                        required
                      />
                      <span className="text-[9px] text-slate-500">Máx: {mov.quantidade_maxima}</span>
                    </div>
                    <div className="col-span-4">
                      <Label className="text-[10px]">Categoria de Manejo</Label>
                      <Input
                        value={mov.categoria}
                        disabled
                        className="h-7 text-xs bg-slate-100"
                      />
                    </div>
                    <div className="col-span-4">
                      <Label className="text-[10px]">Peso (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={mov.peso_medio}
                        onChange={(e) => handleMovimentacaoChange(index, 'peso_medio', e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveMovimentacao(index)}
                        className="h-7 w-7 text-red-600"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Save className="w-3 h-3 mr-1" />
              Avançar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}