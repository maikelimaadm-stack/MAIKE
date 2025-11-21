import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Save, Plus } from "lucide-react";

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
  const lotesArray = Array.isArray(lote) ? lote : [lote];
  
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
    mudancas: [],
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

  const adicionarMudanca = (categoriaAtual) => {
    const infoCategoria = lotesPorCategoria[categoriaAtual];
    setFormData({
      ...formData,
      mudancas: [
        ...formData.mudancas,
        {
          categoria_atual: categoriaAtual,
          quantidade: infoCategoria.totalCabecas,
          categoria_nova: ""
        }
      ]
    });
  };

  const removerMudanca = (index) => {
    setFormData({
      ...formData,
      mudancas: formData.mudancas.filter((_, i) => i !== index)
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

  const categoriasJaAdicionadas = formData.mudancas.map(m => m.categoria_atual);
  const categoriasDisponiveis2 = categoriasDisponiveis.filter(c => !categoriasJaAdicionadas.includes(c));

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Mudança de categoria</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
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

          {formData.mudancas.length > 0 && (
            <div className="space-y-3">
              {formData.mudancas.map((mudanca, index) => {
                const infoCategoria = lotesPorCategoria[mudanca.categoria_atual];
                
                return (
                  <div key={index} className="border rounded-lg p-3 bg-slate-50">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-emerald-600 mb-2">
                          {infoCategoria.totalCabecas} cabeças - {mudanca.categoria_atual}
                        </div>
                        <div className="text-[10px] text-slate-600 mb-3">
                          {infoCategoria.lotes.map(l => l.nome).join(', ')}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Quantidade *</Label>
                            <Input
                              type="number"
                              min="0"
                              max={infoCategoria.totalCabecas}
                              value={mudanca.quantidade}
                              onChange={(e) => handleMudancaChange(index, 'quantidade', parseInt(e.target.value) || 0)}
                              className="h-8 text-xs"
                            />
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs">Categoria de manejo *</Label>
                            <Select
                              value={mudanca.categoria_nova}
                              onValueChange={(v) => handleMudancaChange(index, 'categoria_nova', v)}
                            >
                              <SelectTrigger className="h-8 text-xs">
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
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="w-12 h-12 flex items-center justify-center">
                          <div className="w-10 h-10 bg-emerald-500 rounded flex items-center justify-center text-white text-xs font-bold">
                            {mudanca.categoria_atual.substring(0, 2)}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removerMudanca(index)}
                          className="h-6 w-6 text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs mt-2 w-full text-emerald-600 border-emerald-600"
                      disabled
                    >
                      Salvar
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {categoriasDisponiveis2.length > 0 && (
            <div className="border rounded-lg p-3 bg-white">
              <Label className="text-xs mb-2 block">Selecione uma categoria para mudar:</Label>
              <div className="flex flex-wrap gap-2">
                {categoriasDisponiveis2.map(cat => (
                  <Button
                    key={cat}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => adicionarMudanca(cat)}
                    className="h-8 text-xs"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    {cat}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              rows={2}
              placeholder="Motivo da mudança de categoria..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              <X className="w-3 h-3 mr-1" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700">
              <Save className="w-3 h-3 mr-1" />
              Confirmar Mudanças
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}