import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function FormularioAbate({ lote, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const lotesArray = Array.isArray(lote) ? lote : [lote];
  
  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const lotesPorCategoria = lotesArray.reduce((acc, l) => {
    const cat = l.categoria || 'SEM CATEGORIA';
    if (!acc[cat]) {
      acc[cat] = { categoria: cat, lotes: [], totalCabecas: 0 };
    }
    acc[cat].lotes.push(l);
    acc[cat].totalCabecas += l.quantidade_cabecas || 0;
    return acc;
  }, {});

  const categoriasDisponiveis = Object.keys(lotesPorCategoria).sort();

  const [formData, setFormData] = useState({
    data_abate: new Date().toISOString().split('T')[0],
    abates: [],
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const abatesValidos = formData.abates.filter(a => parseInt(a.quantidade) > 0);
    if (abatesValidos.length === 0) {
      alert("Preencha pelo menos um abate com quantidade");
      return;
    }
    
    abatesValidos.forEach(abate => {
      onSubmit({
        data_abate: formData.data_abate,
        categoria: abate.categoria,
        quantidade: parseInt(abate.quantidade),
        peso_vivo_total: abate.peso_vivo_total ? parseFloat(abate.peso_vivo_total) : null,
        peso_carcaca_total: abate.peso_carcaca_total ? parseFloat(abate.peso_carcaca_total) : null,
        destino: abate.destino,
        observacoes: formData.observacoes
      });
    });
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      abates: [...prev.abates, {
        categoria: primeiraCategoria,
        quantidade: "",
        peso_vivo_total: "",
        peso_carcaca_total: "",
        destino: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      abates: prev.abates.filter((_, i) => i !== index)
    }));
  };

  const handleAbateChange = (index, field, value) => {
    const novosAbates = [...formData.abates];
    novosAbates[index] = { ...novosAbates[index], [field]: value };
    setFormData({ ...formData, abates: novosAbates });
  };

  const nomeExibicao = lotesArray.map(l => l.nome).join(' - ');

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Abate para Consumo - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Data do Abate *</Label>
            <Input
              type="date"
              value={formData.data_abate}
              onChange={(e) => setFormData({ ...formData, data_abate: e.target.value })}
              className="h-8 text-xs"
              required
            />
          </div>

          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {formData.abates.map((abate, index) => {
              const infoCategoria = lotesPorCategoria[abate.categoria];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === abate.categoria?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <div key={index} className="border border-slate-200 rounded-lg p-3 bg-white">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold">Categoria</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removerCategoria(index)}
                      className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <Select
                    value={abate.categoria}
                    onValueChange={(v) => handleAbateChange(index, 'categoria', v)}
                  >
                    <SelectTrigger className="h-10 text-xs mb-3">
                      <SelectValue>
                        {infoCategoria?.totalCabecas || 0} cb - {abate.categoria}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasDisponiveis.map(cat => {
                        const info = lotesPorCategoria[cat];
                        return (
                          <SelectItem key={cat} value={cat} className="text-xs">
                            {info.totalCabecas} cb - {cat}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs text-slate-600">Quantidade *</Label>
                      <Input
                        type="number"
                        min="0"
                        max={infoCategoria.totalCabecas}
                        value={abate.quantidade}
                        onChange={(e) => handleAbateChange(index, 'quantidade', e.target.value)}
                        className="h-10 text-xs"
                        placeholder="0"
                        required
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-slate-600">Peso Vivo Total (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={abate.peso_vivo_total}
                        onChange={(e) => handleAbateChange(index, 'peso_vivo_total', e.target.value)}
                        className="h-10 text-xs"
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-slate-600">Peso Carcaça Total (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={abate.peso_carcaca_total}
                        onChange={(e) => handleAbateChange(index, 'peso_carcaca_total', e.target.value)}
                        className="h-10 text-xs"
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-slate-600">Destino</Label>
                      <Select
                        value={abate.destino}
                        onValueChange={(v) => handleAbateChange(index, 'destino', v)}
                      >
                        <SelectTrigger className="h-10 text-xs">
                          <SelectValue placeholder="Selecione o destino" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Frigorífico" className="text-xs">Frigorífico</SelectItem>
                          <SelectItem value="Açougue" className="text-xs">Açougue</SelectItem>
                          <SelectItem value="Consumo Próprio" className="text-xs">Consumo Próprio</SelectItem>
                          <SelectItem value="Venda Direta" className="text-xs">Venda Direta</SelectItem>
                          <SelectItem value="Outro" className="text-xs">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              onClick={adicionarCategoria}
              variant="outline"
              className="w-full h-10 text-xs border-dashed border-2 border-slate-300 hover:border-slate-400"
            >
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Categoria
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observações Gerais</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
              Registrar Abates
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}