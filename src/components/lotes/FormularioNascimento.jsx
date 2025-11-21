import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function FormularioNascimento({ lote, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const categoriasFemeas = [
    "Novilha 13 a 24 meses",
    "Vaca 25 a 36 meses",
    "Vaca + 36 meses"
  ];

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const lotesArray = Array.isArray(lote) ? lote : [lote];
  
  const lotesPorCategoria = lotesArray.reduce((acc, l) => {
    const cat = l.categoria || 'SEM CATEGORIA';
    if (categoriasFemeas.includes(cat)) {
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
    data_nascimento: new Date().toISOString().split('T')[0],
    nascimentos: categoriasDisponiveis.map(cat => ({
      categoria_mae: cat,
      quantidade: 0,
      sexo: "Macho",
      peso_medio: "",
      selecionada: false
    })),
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const nascimentosValidos = formData.nascimentos.filter(n => n.selecionada && n.quantidade > 0);
    if (nascimentosValidos.length === 0) {
      alert("Selecione e configure pelo menos um nascimento");
      return;
    }
    
    nascimentosValidos.forEach(nasc => {
      onSubmit({
        data_nascimento: formData.data_nascimento,
        categoria_mae: nasc.categoria_mae,
        quantidade: nasc.quantidade,
        sexo: nasc.sexo,
        peso_medio: nasc.peso_medio,
        observacoes: formData.observacoes
      });
    });
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
      <CardContent className="p-4">
        {categoriasDisponiveis.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-slate-600">Não há categorias de fêmeas elegíveis para nascimento.</p>
            <Button onClick={onCancel} variant="outline" size="sm" className="mt-4">Fechar</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Data do Nascimento *</Label>
              <Input
                type="date"
                value={formData.data_nascimento}
                onChange={(e) => setFormData({ ...formData, data_nascimento: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto">
              {formData.nascimentos.map((nasc, index) => {
                const infoCategoria = lotesPorCategoria[nasc.categoria_mae];
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === nasc.categoria_mae?.toUpperCase()
                );
                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

                return (
                  <div key={index} className={`border rounded-lg p-2 transition-all ${nasc.selecionada ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'}`}>
                    <div className="flex items-start gap-2 mb-2">
                      <div className="flex-1">
                        <div className="text-[10px] font-semibold text-emerald-600">
                          {infoCategoria.totalCabecas} cabeças - {nasc.categoria_mae.split(' ')[0]}
                        </div>
                        <div className="text-[8px] text-slate-500 truncate">
                          {infoCategoria.lotes[0]?.nome}
                        </div>
                      </div>
                      {iconeUrl ? (
                        <img src={iconeUrl} alt={nasc.categoria_mae} className="w-8 h-8 object-contain" />
                      ) : (
                        <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center text-white text-[10px] font-bold">
                          {nasc.categoria_mae.substring(0, 2)}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div>
                        <Label className="text-[10px] text-slate-600">Qtd nascimentos *</Label>
                        <Input
                          type="number"
                          min="0"
                          value={nasc.quantidade}
                          onChange={(e) => handleNascimentoChange(index, 'quantidade', parseInt(e.target.value) || 0)}
                          className="h-7 text-xs"
                          disabled={!nasc.selecionada}
                        />
                      </div>

                      <div>
                        <Label className="text-[10px] text-slate-600">Sexo</Label>
                        <Select
                          value={nasc.sexo}
                          onValueChange={(v) => handleNascimentoChange(index, 'sexo', v)}
                          disabled={!nasc.selecionada}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                            <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-[10px] text-slate-600">Peso (kg)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={nasc.peso_medio}
                          onChange={(e) => handleNascimentoChange(index, 'peso_medio', e.target.value)}
                          className="h-7 text-xs"
                          disabled={!nasc.selecionada}
                          placeholder="Opcional"
                        />
                      </div>
                    </div>

                    <Button
                      type="button"
                      onClick={() => handleNascimentoChange(index, 'selecionada', !nasc.selecionada)}
                      className={`h-6 text-[10px] mt-2 w-full ${nasc.selecionada ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'} text-white`}
                    >
                      {nasc.selecionada ? 'Cancelar' : 'Selecionar'}
                    </Button>
                  </div>
                );
              })}
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
              <Button type="submit" size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700">
                Registrar Nascimentos
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}