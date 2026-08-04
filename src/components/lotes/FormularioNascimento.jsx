import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDaEmpresa } from "@/services/mapaService";
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

export default function FormularioNascimento({ lote, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
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
    const sexo = l.sexo || 'Indefinido';
    if (sexo === 'Fêmea' || cat.toLowerCase().includes('vaca') || cat.toLowerCase().includes('bezerra') || cat.toLowerCase().includes('novilha')) {
      if (!acc[cat]) {
        acc[cat] = { categoria: cat, lotes: [], totalCabecas: 0 };
      }
      acc[cat].lotes.push(l);
      acc[cat].totalCabecas += l.quantidade_cabecas || 0;
    }
    return acc;
  }, {});

  const categoriasDisponiveis = Object.keys(lotesPorCategoria).sort();

  const [formData, setFormData] = useState({
    data_nascimento: getTodayLocalDate(),
    nascimentos: [],
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const nascimentosValidos = formData.nascimentos.filter(n => parseInt(n.quantidade) > 0 && n.sexo);
    if (nascimentosValidos.length === 0) {
      alert("Preencha pelo menos um nascimento com quantidade e sexo");
      return;
    }
    
    nascimentosValidos.forEach(nascimento => {
      onSubmit({
        data_nascimento: formData.data_nascimento,
        categoria_mae: nascimento.categoria_mae,
        quantidade: parseInt(nascimento.quantidade),
        sexo: nascimento.sexo,
        peso_medio: nascimento.peso_medio ? parseFloat(nascimento.peso_medio) : null,
        observacoes: formData.observacoes
      });
    });
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      nascimentos: [...prev.nascimentos, {
        categoria_mae: primeiraCategoria,
        quantidade: "",
        sexo: "",
        peso_medio: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      nascimentos: prev.nascimentos.filter((_, i) => i !== index)
    }));
  };

  const handleNascimentoChange = (index, field, value) => {
    const novosNascimentos = [...formData.nascimentos];
    novosNascimentos[index] = { ...novosNascimentos[index], [field]: value };
    setFormData({ ...formData, nascimentos: novosNascimentos });
  };

  const nomeExibicao = lotesArray.map(l => l.nome).join(' - ');

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Registrar Nascimento - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-1">
          <FL label="Data do Nascimento" required>
            <Input type="date" value={formData.data_nascimento} onChange={(e) => setFormData({ ...formData, data_nascimento: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" required />
          </FL>

          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {formData.nascimentos.map((nascimento, index) => {
              const infoCategoria = lotesPorCategoria[nascimento.categoria_mae];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === nascimento.categoria_mae?.toUpperCase()
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

                  <FL label="Categoria Mãe">
                    <Select
                      value={nascimento.categoria_mae}
                      onValueChange={(v) => handleNascimentoChange(index, 'categoria_mae', v)}
                    >
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                        <SelectValue>
                          {infoCategoria?.totalCabecas || 0} cb - {nascimento.categoria_mae}
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
                        value={nascimento.quantidade}
                        onChange={(e) => handleNascimentoChange(index, 'quantidade', e.target.value)}
                        className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                        placeholder="0"
                        required
                      />
                    </FL>
                    <FL label="Sexo" required>
                      <Select
                        value={nascimento.sexo}
                        onValueChange={(v) => handleNascimentoChange(index, 'sexo', v)}
                      >
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                          <SelectValue placeholder="Selecione o sexo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                          <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                        </SelectContent>
                      </Select>
                    </FL>

                    <FL label="Peso Médio (kg)">
                      <Input
                        type="number"
                        step="0.1"
                        value={nascimento.peso_medio}
                        onChange={(e) => handleNascimentoChange(index, 'peso_medio', e.target.value)}
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

          <FL label="Observações Gerais">
            <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" rows={2} />
          </FL>
          <div className="flex justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">Registrar Nascimentos</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}