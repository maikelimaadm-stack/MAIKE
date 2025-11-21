import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Save } from "lucide-react";

export default function FormularioPesagem({ lote, onSubmit, onCancel }) {
  const lotesArray = Array.isArray(lote) ? lote : [lote];
  const categoriasDisponiveis = [...new Set(lotesArray.map(l => l.categoria).filter(Boolean))];

  const [formData, setFormData] = useState({
    data_pesagem: new Date().toISOString().split('T')[0],
    categorias_selecionadas: categoriasDisponiveis.length === 1 ? [categoriasDisponiveis[0]] : [],
    pesos_por_categoria: {},
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formData.categorias_selecionadas.length === 0) {
      alert("Selecione pelo menos uma categoria");
      return;
    }
    
    for (const cat of formData.categorias_selecionadas) {
      if (!formData.pesos_por_categoria[cat] || formData.pesos_por_categoria[cat] <= 0) {
        alert(`Informe o peso para a categoria ${cat}`);
        return;
      }
    }
    
    onSubmit(formData);
  };

  const toggleCategoria = (cat) => {
    const atual = formData.categorias_selecionadas;
    if (atual.includes(cat)) {
      setFormData({ ...formData, categorias_selecionadas: atual.filter(c => c !== cat) });
    } else {
      setFormData({ ...formData, categorias_selecionadas: [...atual, cat] });
    }
  };

  const setPesoCategoria = (cat, peso) => {
    setFormData({
      ...formData,
      pesos_por_categoria: {
        ...formData.pesos_por_categoria,
        [cat]: peso
      }
    });
  };

  const nomeExibicao = lotesArray.map(l => l.nome).join(' - ');

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Registrar Pesagem - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="bg-slate-50 border rounded p-3 mb-3">
            <div className="text-xs text-slate-600 mb-2">Categorias Disponíveis - Selecione quais deseja pesar:</div>
            <div className="flex flex-wrap gap-2">
              {categoriasDisponiveis.map(cat => {
                const lotesCat = lotesArray.filter(l => l.categoria === cat);
                const qtdTotal = lotesCat.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);
                const pesoAnterior = lotesCat[0]?.peso_medio_kg;
                const isSelected = formData.categorias_selecionadas.includes(cat);
                
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategoria(cat)}
                    className={`px-3 py-2 text-xs rounded border transition-all ${
                      isSelected 
                        ? 'bg-emerald-600 text-white border-emerald-600' 
                        : 'bg-white text-slate-700 border-slate-300 hover:border-emerald-600'
                    }`}
                  >
                    <div className="font-semibold">{cat}</div>
                    <div className="text-[10px] opacity-80">{qtdTotal} cabeças</div>
                    {pesoAnterior && (
                      <div className="text-[10px] opacity-80">Peso ant: {pesoAnterior}kg</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Data da Pesagem *</Label>
            <Input
              type="date"
              value={formData.data_pesagem}
              onChange={(e) => setFormData({ ...formData, data_pesagem: e.target.value })}
              className="h-8 text-xs"
              required
            />
          </div>

          {formData.categorias_selecionadas.length > 0 && (
            <div className="border rounded p-3 bg-white space-y-3">
              <div className="text-xs font-semibold text-slate-700">Pesos por Categoria:</div>
              {formData.categorias_selecionadas.map(cat => {
                const lotesCat = lotesArray.filter(l => l.categoria === cat);
                const pesoAnterior = lotesCat[0]?.peso_medio_kg;
                const pesoAtual = formData.pesos_por_categoria[cat];

                return (
                  <div key={cat} className="space-y-2">
                    <Label className="text-xs font-semibold">{cat}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={pesoAtual || ""}
                      onChange={(e) => setPesoCategoria(cat, e.target.value)}
                      placeholder="Peso médio (kg)"
                      className="h-8 text-xs"
                      required
                    />
                    {pesoAnterior && pesoAtual && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">
                        <span className="text-blue-700">Ganho:</span>{" "}
                        <span className="font-semibold text-blue-900">
                          {(parseFloat(pesoAtual) - pesoAnterior).toFixed(1)} kg
                        </span>
                        {" | "}
                        <span className="text-blue-700">Variação:</span>{" "}
                        <span className="font-semibold text-blue-900">
                          {((parseFloat(pesoAtual) - pesoAnterior) / pesoAnterior * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              rows={3}
              placeholder="Condições da pesagem, observações gerais..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              <X className="w-3 h-3 mr-1" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Save className="w-3 h-3 mr-1" />
              Registrar Pesagem
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}