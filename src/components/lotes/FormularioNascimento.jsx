import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Save } from "lucide-react";
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
      quantidade: "",
      sexo: "Macho",
      peso_medio: "",
      selecionada: false
    })),
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const nascimentosValidos = formData.nascimentos.filter(n => n.selecionada && parseInt(n.quantidade) > 0);
    if (nascimentosValidos.length === 0) {
      alert("Selecione e configure pelo menos um nascimento");
      return;
    }
    
    nascimentosValidos.forEach(nasc => {
      onSubmit({
        data_nascimento: formData.data_nascimento,
        categoria_mae: nasc.categoria_mae,
        quantidade: parseInt(nasc.quantidade),
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

            <div className="space-y-3 max-h-[40vh] overflow-y-auto">
              {formData.nascimentos.map((nasc, index) => {
                const infoCategoria = lotesPorCategoria[nasc.categoria_mae];
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === nasc.categoria_mae?.toUpperCase()
                );
                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

                return (
                  <div key={index} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-slate-900 mb-1.5">{nasc.categoria_mae}</div>
                        <div className="text-xl font-bold text-slate-900 mb-2">{infoCategoria.totalCabecas} cab</div>
                        <div className="space-y-1.5 text-[10px]">
                          <div className="flex gap-2">
                            <span className="font-medium text-slate-600 whitespace-nowrap">Lotes:</span>
                            <span className="font-semibold text-slate-900 break-words">{infoCategoria.lotes.map(l => l.nome).join(', ')}</span>
                          </div>
                        </div>
                      </div>
                      {iconeUrl && (
                        <img src={iconeUrl} alt={nasc.categoria_mae} className="w-12 h-12 object-contain flex-shrink-0" />
                      )}
                    </div>

                    <div className="space-y-3 mt-3 pt-3 border-t">
                      <div>
                        <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Qtd nascimentos *</Label>
                        <Input
                          type="number"
                          min="0"
                          value={nasc.quantidade}
                          onChange={(e) => handleNascimentoChange(index, 'quantidade', e.target.value)}
                          className="h-9 text-xs"
                          disabled={!nasc.selecionada}
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Sexo</Label>
                        <Select
                          value={nasc.sexo}
                          onValueChange={(v) => handleNascimentoChange(index, 'sexo', v)}
                          disabled={!nasc.selecionada}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                            <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Peso (kg)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={nasc.peso_medio}
                          onChange={(e) => handleNascimentoChange(index, 'peso_medio', e.target.value)}
                          className="h-9 text-xs"
                          disabled={!nasc.selecionada}
                          placeholder="Opcional"
                        />
                      </div>

                      <Button
                        type="button"
                        onClick={() => handleNascimentoChange(index, 'selecionada', !nasc.selecionada)}
                        className={`h-8 text-[10px] w-full ${nasc.selecionada ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-600 hover:bg-slate-700'} text-white`}
                      >
                        {nasc.selecionada ? 'Cancelar' : 'Selecionar'}
                      </Button>
                    </div>
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
              <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                Registrar Nascimentos
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}