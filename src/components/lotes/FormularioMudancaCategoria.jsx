import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, ChevronDown, ChevronRight } from "lucide-react";
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
      quantidade: lotesPorCategoria[cat].totalCabecas,
      categoria_nova: ""
    })),
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const mudancasValidas = formData.mudancas.filter(m => m.categoria_nova && m.quantidade > 0);
    if (mudancasValidas.length === 0) {
      alert("Configure pelo menos uma mudança de categoria");
      return;
    }

    onSubmit({
      ...formData,
      mudancas: mudancasValidas
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
          <div className="grid grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
            {formData.mudancas.map((mudanca, index) => {
              const infoCategoria = lotesPorCategoria[mudanca.categoria_atual];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === mudanca.categoria_atual?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;
              
              return (
                <div key={index} className="border rounded-lg p-2 bg-white">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1">
                      <div className="text-[10px] font-semibold text-emerald-600">
                        {infoCategoria.totalCabecas} cabeças - {mudanca.categoria_atual.split(' ')[0]}
                      </div>
                      <div className="text-[8px] text-slate-500 truncate">
                        {infoCategoria.lotes[0]?.nome}
                      </div>
                    </div>
                    {iconeUrl ? (
                      <img 
                        src={iconeUrl} 
                        alt={mudanca.categoria_atual} 
                        className="w-8 h-8 object-contain" 
                      />
                    ) : (
                      <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center text-white text-[10px] font-bold">
                        {mudanca.categoria_atual.substring(0, 2)}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div>
                      <Label className="text-[10px] text-slate-600">Quantidade *</Label>
                      <Input
                        type="number"
                        min="0"
                        max={infoCategoria.totalCabecas}
                        value={mudanca.quantidade}
                        onChange={(e) => handleMudancaChange(index, 'quantidade', parseInt(e.target.value) || 0)}
                        className="h-7 text-xs"
                        placeholder="Quantidade"
                      />
                    </div>

                    <div>
                      <Label className="text-[10px] text-slate-600">Categoria de manejo *</Label>
                      <Select
                        value={mudanca.categoria_nova}
                        onValueChange={(v) => handleMudancaChange(index, 'categoria_nova', v)}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS.filter(c => c !== mudanca.categoria_atual).map(cat => (
                            <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button
                    type="button"
                    className="h-6 text-[10px] mt-2 w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                  >
                    Salvar
                  </Button>
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
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}