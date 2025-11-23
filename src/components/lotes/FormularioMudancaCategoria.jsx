import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, ChevronDown, ChevronRight, Save } from "lucide-react";
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
  
  // Agrupar lotes por categoria
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
    mudancas: categoriasDisponiveis.map(cat => ({
      categoria_atual: cat,
      quantidade: "",
      categoria_nova: "",
      selecionada: false
    })),
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const mudancasValidas = formData.mudancas.filter(m => m.selecionada && m.categoria_nova && parseInt(m.quantidade) > 0);
    if (mudancasValidas.length === 0) {
      alert("Selecione e configure pelo menos uma mudança de categoria");
      return;
    }

    onSubmit({
      ...formData,
      mudancas: mudancasValidas.map(m => ({...m, quantidade: parseInt(m.quantidade)}))
    });
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
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {formData.mudancas.map((mudanca, index) => {
              const infoCategoria = lotesPorCategoria[mudanca.categoria_atual];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === mudanca.categoria_atual?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;
              
              return (
                <div key={index} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-slate-900 mb-1.5">{mudanca.categoria_atual}</div>
                      <div className="text-xl font-bold text-emerald-600 mb-2">{infoCategoria.totalCabecas} cab</div>
                      <div className="space-y-1.5 text-[10px]">
                        <div className="flex gap-2">
                          <span className="font-medium text-slate-600 whitespace-nowrap">Lotes:</span>
                          <span className="font-semibold text-slate-900 break-words">{infoCategoria.lotes.map(l => l.nome).join(', ')}</span>
                        </div>
                      </div>
                    </div>
                    {iconeUrl && (
                      <img src={iconeUrl} alt={mudanca.categoria_atual} className="w-12 h-12 object-contain flex-shrink-0" />
                    )}
                  </div>

                  <div className="space-y-3 mt-3 pt-3 border-t">
                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Quantidade *</Label>
                      <Input
                        type="number"
                        min="0"
                        max={infoCategoria.totalCabecas}
                        value={mudanca.quantidade}
                        onChange={(e) => handleMudancaChange(index, 'quantidade', e.target.value)}
                        className="h-9 text-xs"
                        placeholder="0"
                        disabled={!mudanca.selecionada}
                      />
                    </div>

                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Categoria de manejo *</Label>
                      <Select
                        value={mudanca.categoria_nova}
                        onValueChange={(v) => handleMudancaChange(index, 'categoria_nova', v)}
                        disabled={!mudanca.selecionada}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS.filter(c => c !== mudanca.categoria_atual).map(cat => (
                            <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      type="button"
                      onClick={() => handleMudancaChange(index, 'selecionada', !mudanca.selecionada)}
                      className={`h-8 text-[10px] w-full ${mudanca.selecionada ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-600 hover:bg-emerald-700'} text-white`}
                    >
                      {mudanca.selecionada ? 'Cancelar' : 'Selecionar'}
                    </Button>
                  </div>
                </div>
              );
            })}
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
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs gap-1.5">
              <X className="w-3.5 h-3.5" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800 gap-1.5">
              <Save className="w-3.5 h-3.5" />
              Confirmar Mudanças
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}