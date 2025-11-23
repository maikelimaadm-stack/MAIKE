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
  
  console.log('📊 MORTE - Total de lotes recebidos:', lotesArray.length);
  console.log('📊 MORTE - Categorias encontradas:', categoriasDisponiveis);
  console.log('📊 MORTE - Detalhes por categoria:', lotesPorCategoria);

  const [formData, setFormData] = useState({
    data_ocorrencia: new Date().toISOString().split('T')[0],
    mortes: categoriasDisponiveis.map(cat => ({
      categoria: cat,
      quantidade: "",
      causa_morte: "",
      selecionada: false
    })),
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const mortesValidas = formData.mortes.filter(m => m.selecionada && parseInt(m.quantidade) > 0);
    if (mortesValidas.length === 0) {
      alert("Selecione e configure pelo menos uma morte");
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

          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {formData.mortes.map((morte, index) => {
              const infoCategoria = lotesPorCategoria[morte.categoria];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === morte.categoria?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <div key={index} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-slate-900 mb-1.5">{morte.categoria}</div>
                      <div className="text-xl font-bold text-emerald-600 mb-2">{infoCategoria.totalCabecas} cab</div>
                      <div className="space-y-1.5 text-[10px]">
                        <div className="flex gap-2">
                          <span className="font-medium text-slate-600 whitespace-nowrap">Lotes:</span>
                          <span className="font-semibold text-slate-900 break-words">{infoCategoria.lotes.map(l => l.nome).join(', ')}</span>
                        </div>
                      </div>
                    </div>
                    {iconeUrl && (
                      <img src={iconeUrl} alt={morte.categoria} className="w-12 h-12 object-contain flex-shrink-0" />
                    )}
                  </div>

                  <div className="space-y-3 mt-3 pt-3 border-t">
                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Quantidade *</Label>
                      <Input
                        type="number"
                        min="0"
                        max={infoCategoria.totalCabecas}
                        value={morte.quantidade}
                        onChange={(e) => handleMorteChange(index, 'quantidade', e.target.value)}
                        className="h-9 text-xs"
                        disabled={!morte.selecionada}
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Causa</Label>
                      <Select
                        value={morte.causa_morte}
                        onValueChange={(v) => handleMorteChange(index, 'causa_morte', v)}
                        disabled={!morte.selecionada}
                      >
                        <SelectTrigger className="h-9 text-xs">
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

                    <Button
                      type="button"
                      onClick={() => handleMorteChange(index, 'selecionada', !morte.selecionada)}
                      className={`h-8 text-[10px] w-full ${morte.selecionada ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-600 hover:bg-emerald-700'} text-white`}
                    >
                      {morte.selecionada ? 'Cancelar' : 'Selecionar'}
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
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs gap-1.5">
              <X className="w-3.5 h-3.5" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800 gap-1.5">
              <Save className="w-3.5 h-3.5" />
              Registrar Mortes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}