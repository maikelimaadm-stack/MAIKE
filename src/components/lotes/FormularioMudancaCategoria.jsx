import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const CATEGORIAS = [
  "Bezerro 0 a 12 meses",
  "Bezerra 0 a 12 meses",
  "Garrote 13 a 24 meses",
  "Novilha 13 a 24 meses",
  "Boi 25 a 36 meses",
  "Vaca 25 a 36 meses",
  "Touro + 36 meses",
  "Vaca + 36 meses"
];

export default function FormularioMudancaCategoria({ lote, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showHistorico, setShowHistorico] = useState(false);
  
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
      acc[cat] = {
        categoria: cat,
        lotes: [],
        totalCabecas: 0
      };
    }
    acc[cat].lotes.push(l);
    acc[cat].totalCabecas += l.quantidade_cabecas || 0;
    return acc;
  }, {});

  const categoriasDisponiveis = Object.keys(lotesPorCategoria).sort();

  const [formData, setFormData] = useState({
    data_mudanca: new Date().toISOString().split('T')[0],
    mudancas: [],
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const mudancasValidas = formData.mudancas.filter(m => m.categoria_nova && parseInt(m.quantidade) > 0);
    if (mudancasValidas.length === 0) {
      alert("Preencha pelo menos uma mudança com quantidade e categoria nova");
      return;
    }

    onSubmit({
      ...formData,
      mudancas: mudancasValidas.map(m => ({
        ...m, 
        quantidade: parseInt(m.quantidade),
        peso_medio: m.peso_medio ? parseFloat(m.peso_medio) : null
      }))
    });
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      mudancas: [...prev.mudancas, {
        categoria_atual: primeiraCategoria,
        quantidade: "",
        categoria_nova: "",
        peso_medio: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      mudancas: prev.mudancas.filter((_, i) => i !== index)
    }));
  };

  const handleMudancaChange = (index, field, value) => {
    const novasMudancas = [...formData.mudancas];
    novasMudancas[index] = {
      ...novasMudancas[index],
      [field]: value
    };
    setFormData({ ...formData, mudancas: novasMudancas });
  };

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Mudança de categoria</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Data da Mudança *</Label>
            <Input
              type="date"
              value={formData.data_mudanca}
              onChange={(e) => setFormData({ ...formData, data_mudanca: e.target.value })}
              className="h-8 text-xs"
              required
            />
          </div>

          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {formData.mudancas.map((mudanca, index) => {
              const infoCategoria = lotesPorCategoria[mudanca.categoria_atual];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === mudanca.categoria_atual?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <div key={index} className="border border-slate-200 rounded-lg p-3 bg-white">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold">Categoria Atual</Label>
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
                    value={mudanca.categoria_atual}
                    onValueChange={(v) => handleMudancaChange(index, 'categoria_atual', v)}
                  >
                    <SelectTrigger className="h-10 text-xs mb-3">
                      <SelectValue>
                        <div className="flex items-center gap-2">
                          {iconeUrl && <img src={iconeUrl} alt="" className="w-5 h-5" />}
                          <span>{infoCategoria.totalCabecas} cb - {mudanca.categoria_atual}</span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasDisponiveis.map(cat => {
                        const info = lotesPorCategoria[cat];
                        const icon = iconesConfig.find(ic => 
                          ic.tipo_entidade === 'Lote' && 
                          ic.categoria?.toUpperCase() === cat?.toUpperCase()
                        );
                        const iconUrl = icon?.sub_icone_url || icon?.icone_url;
                        return (
                          <SelectItem key={cat} value={cat} className="text-xs">
                            <div className="flex items-center gap-2">
                              {iconUrl && <img src={iconUrl} alt="" className="w-5 h-5" />}
                              <span>{info.totalCabecas} cb - {cat}</span>
                            </div>
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
                        value={mudanca.quantidade}
                        onChange={(e) => handleMudancaChange(index, 'quantidade', e.target.value)}
                        className="h-10 text-xs"
                        placeholder="0"
                        required
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-slate-600">Nova Categoria *</Label>
                      <Select
                        value={mudanca.categoria_nova}
                        onValueChange={(v) => handleMudancaChange(index, 'categoria_nova', v)}
                      >
                        <SelectTrigger className="h-10 text-xs">
                          <SelectValue placeholder="Selecione a nova categoria" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS.filter(c => c !== mudanca.categoria_atual).map(cat => (
                            <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs text-slate-600">Peso Médio (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={mudanca.peso_medio || ""}
                        onChange={(e) => handleMudancaChange(index, 'peso_medio', e.target.value)}
                        className="h-10 text-xs"
                        placeholder="0"
                      />
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

          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => setShowHistorico(!showHistorico)}
              className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900"
            >
              {showHistorico ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Histórico
            </button>
            {showHistorico && (
              <div className="mt-2 p-3 bg-slate-50 rounded text-xs text-slate-600">
                Nenhum histórico disponível
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
              Confirmar Mudanças
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}