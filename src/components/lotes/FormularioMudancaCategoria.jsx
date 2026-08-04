import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDaEmpresa } from "@/services/mapaService";
import { listarCategoriasManejoDaEmpresa } from "@/services/categoriaManejoService";
import { getTodayLocalDate } from "../utils/pecuariaUtils";

const FL = ({ label, required, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
      {children}
    </div>
  </div>
);

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

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ['categorias-manejo-mudanca', empresaSelecionadaId],
    queryFn: async () => {
      const categorias = await listarCategoriasManejoDaEmpresa(empresaSelecionadaId);
      return categorias.filter((c) => c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });
  const [showHistorico, setShowHistorico] = useState(false);
  
  const lotesArray = Array.isArray(lote) ? lote : [lote];
  
  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const icones = await listarIconesDaEmpresa(empresaSelecionadaId);
      return icones.filter((i) => i.ativo !== false);
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
    data_mudanca: getTodayLocalDate(),
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
    // Se mudou a nova categoria, buscar o sexo da categoria de manejo correspondente
    if (field === 'categoria_nova') {
      const catManejo = categoriasManejo.find(c => c.categoria_oficial === value);
      if (catManejo?.sexo) {
        novasMudancas[index].sexo_novo = catManejo.sexo;
        novasMudancas[index].categoria_manejo_id_novo = catManejo.id;
        novasMudancas[index].categoria_manejo_nome_novo = catManejo.nome;
      }
    }
    setFormData({ ...formData, mudancas: novasMudancas });
  };

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Mudança de categoria</CardTitle>
      </CardHeader>
      <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-1">
          <FL label="Data da Mudança" required>
            <Input type="date" value={formData.data_mudanca} onChange={(e) => setFormData({ ...formData, data_mudanca: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" required />
          </FL>

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
                  <div className="flex items-center justify-between mb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removerCategoria(index)}
                      className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50 ml-auto"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <FL label="Categoria Atual">
                    <Select
                      value={mudanca.categoria_atual}
                      onValueChange={(v) => handleMudancaChange(index, 'categoria_atual', v)}
                    >
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                        <SelectValue>
                          {infoCategoria?.totalCabecas || 0} cb - {mudanca.categoria_atual}
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
                  </FL>

                  <div className="space-y-1">
                    <FL label="Quantidade" required>
                      <Input
                        type="number"
                        min="0"
                        max={infoCategoria.totalCabecas}
                        value={mudanca.quantidade}
                        onChange={(e) => handleMudancaChange(index, 'quantidade', e.target.value)}
                        className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                        placeholder="0"
                        required
                      />
                    </FL>
                    <FL label="Nova Categoria" required>
                      <Select
                        value={mudanca.categoria_nova}
                        onValueChange={(v) => handleMudancaChange(index, 'categoria_nova', v)}
                      >
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                          <SelectValue placeholder="Selecione a nova categoria" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS.filter(c => c !== mudanca.categoria_atual).map(cat => (
                            <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FL>

                    {mudanca.sexo_novo && (
                      <div className="text-xs text-slate-500">
                        Sexo da nova categoria: <span className="font-semibold text-slate-700">{mudanca.sexo_novo}</span>
                      </div>
                    )}

                    <FL label="Peso Médio (kg)">
                      <Input
                        type="number"
                        step="0.1"
                        value={mudanca.peso_medio || ""}
                        onChange={(e) => handleMudancaChange(index, 'peso_medio', e.target.value)}
                        className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                        placeholder="0"
                      />
                    </FL>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              onClick={adicionarCategoria}
              variant="outline"
              className="w-full h-7 text-xs border-dashed border-2 border-slate-300 hover:border-slate-400"
            >
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

          <div className="flex justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">Confirmar Mudanças</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}