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
    data_ocorrencia: new Date().toISOString().split('T')[0],
    mortes: categoriasDisponiveis.map(cat => ({
      categoria: cat,
      quantidade: 0,
      causa_morte: "",
      selecionada: false
    })),
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const mortesValidas = formData.mortes.filter(m => m.selecionada && m.quantidade > 0);
    if (mortesValidas.length === 0) {
      alert("Selecione e configure pelo menos uma morte");
      return;
    }
    
    mortesValidas.forEach(morte => {
      onSubmit({
        data_ocorrencia: formData.data_ocorrencia,
        categoria: morte.categoria,
        quantidade: morte.quantidade,
        causa_morte: morte.causa_morte,
        observacoes: formData.observacoes
      });
    });
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
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Data da Ocorrência *</Label>
            <Input
              type="date"
              value={formData.data_ocorrencia}
              onChange={(e) => setFormData({ ...formData, data_ocorrencia: e.target.value })}
              className="h-8 text-xs"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto">
            {formData.mortes.map((morte, index) => {
              const infoCategoria = lotesPorCategoria[morte.categoria];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === morte.categoria?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <div key={index} className={`border rounded-lg p-2 transition-all ${morte.selecionada ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1">
                      <div className="text-[10px] font-semibold text-emerald-600">
                        {infoCategoria.totalCabecas} cabeças - {morte.categoria.split(' ')[0]}
                      </div>
                      <div className="text-[8px] text-slate-500 truncate">
                        {infoCategoria.lotes[0]?.nome}
                      </div>
                    </div>
                    {iconeUrl ? (
                      <img src={iconeUrl} alt={morte.categoria} className="w-8 h-8 object-contain" />
                    ) : (
                      <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center text-white text-[10px] font-bold">
                        {morte.categoria.substring(0, 2)}
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
                        value={morte.quantidade}
                        onChange={(e) => handleMorteChange(index, 'quantidade', parseInt(e.target.value) || 0)}
                        className="h-7 text-xs"
                        disabled={!morte.selecionada}
                      />
                    </div>

                    <div>
                      <Label className="text-[10px] text-slate-600">Causa</Label>
                      <Select
                        value={morte.causa_morte}
                        onValueChange={(v) => handleMorteChange(index, 'causa_morte', v)}
                        disabled={!morte.selecionada}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Causa" />
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
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={() => handleMorteChange(index, 'selecionada', !morte.selecionada)}
                    className={`h-6 text-[10px] mt-2 w-full ${morte.selecionada ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'} text-white`}
                  >
                    {morte.selecionada ? 'Cancelar' : 'Selecionar'}
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
            <Button type="submit" size="sm" className="h-8 text-xs bg-red-600 hover:bg-red-700">
              Registrar Mortes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}