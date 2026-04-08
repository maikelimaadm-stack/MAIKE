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

export default function FormularioMorte({ lote, onSubmit, onCancel }) {
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
    data_ocorrencia: getTodayLocalDate(),
    mortes: [],
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const mortesValidas = formData.mortes.filter(m => parseInt(m.quantidade) > 0 && m.causa_morte);
    if (mortesValidas.length === 0) {
      alert("Preencha pelo menos uma morte com quantidade e causa");
      return;
    }
    
    mortesValidas.forEach(morte => {
      onSubmit({
        data_ocorrencia: formData.data_ocorrencia,
        categoria: morte.categoria,
        quantidade: parseInt(morte.quantidade),
        causa_morte: morte.causa_morte,
        observacoes: formData.observacoes
      });
    });
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      mortes: [...prev.mortes, {
        categoria: primeiraCategoria,
        quantidade: "",
        causa_morte: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      mortes: prev.mortes.filter((_, i) => i !== index)
    }));
  };

  const handleMorteChange = (index, field, value) => {
    const novasMortes = [...formData.mortes];
    novasMortes[index] = { ...novasMortes[index], [field]: value };
    setFormData({ ...formData, mortes: novasMortes });
  };

  const nomeExibicao = lotesArray.map(l => l.nome).join(' - ');

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Registrar Morte - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-1">
          <FL label="Data da Ocorrência" required>
            <Input type="date" value={formData.data_ocorrencia} onChange={(e) => setFormData({ ...formData, data_ocorrencia: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" required />
          </FL>

          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {formData.mortes.map((morte, index) => {
              const infoCategoria = lotesPorCategoria[morte.categoria];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === morte.categoria?.toUpperCase()
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

                  <FL label="Categoria">
                    <Select
                      value={morte.categoria}
                      onValueChange={(v) => handleMorteChange(index, 'categoria', v)}
                    >
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                        <SelectValue>
                          {infoCategoria?.totalCabecas || 0} cb - {morte.categoria}
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
                        value={morte.quantidade}
                        onChange={(e) => handleMorteChange(index, 'quantidade', e.target.value)}
                        className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                        placeholder="0"
                        required
                      />
                    </FL>

                    <FL label="Causa da Morte" required>
                      <Select
                        value={morte.causa_morte}
                        onValueChange={(v) => handleMorteChange(index, 'causa_morte', v)}
                      >
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                          <SelectValue placeholder="Selecione a causa" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Doença" className="text-xs">Doença</SelectItem>
                          <SelectItem value="Acidente" className="text-xs">Acidente</SelectItem>
                          <SelectItem value="Predador" className="text-xs">Predador</SelectItem>
                          <SelectItem value="Natural" className="text-xs">Natural</SelectItem>
                          <SelectItem value="Desconhecida" className="text-xs">Desconhecida</SelectItem>
                          <SelectItem value="Outra" className="text-xs">Outra</SelectItem>
                        </SelectContent>
                      </Select>
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

          <FL label="Observações Gerais">
            <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" rows={2} />
          </FL>
          <div className="flex justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">Registrar Mortes</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}