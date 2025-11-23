import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Save } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function FormularioAbate({ lote, onSubmit, onCancel }) {
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
  
  console.log('🥩 ABATE - Total de lotes recebidos:', lotesArray.length);
  console.log('🥩 ABATE - Categorias encontradas:', categoriasDisponiveis);
  console.log('🥩 ABATE - Detalhes por categoria:', lotesPorCategoria);

  const [formData, setFormData] = useState({
    data_abate: new Date().toISOString().split('T')[0],
    abates: categoriasDisponiveis.map(cat => ({
      categoria: cat,
      quantidade: "",
      peso_vivo_total: "",
      peso_carcaca_total: "",
      destino: "",
      selecionada: false
    })),
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const abatesValidos = formData.abates.filter(a => a.selecionada && parseInt(a.quantidade) > 0);
    if (abatesValidos.length === 0) {
      alert("Selecione e configure pelo menos um abate");
      return;
    }
    
    abatesValidos.forEach(abate => {
      onSubmit({
        data_abate: formData.data_abate,
        categoria: abate.categoria,
        quantidade: parseInt(abate.quantidade),
        peso_vivo_total: abate.peso_vivo_total,
        peso_carcaca_total: abate.peso_carcaca_total,
        destino: abate.destino,
        observacoes: formData.observacoes
      });
    });
  };

  const handleAbateChange = (index, field, value) => {
    const novosAbates = [...formData.abates];
    novosAbates[index] = { ...novosAbates[index], [field]: value };
    setFormData({ ...formData, abates: novosAbates });
  };

  const nomeExibicao = lotesArray.map(l => l.nome).join(' - ');

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Abate para Consumo - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Data do Abate *</Label>
            <Input
              type="date"
              value={formData.data_abate}
              onChange={(e) => setFormData({ ...formData, data_abate: e.target.value })}
              className="h-8 text-xs"
              required
            />
          </div>

          <div className="space-y-3 max-h-[40vh] overflow-y-auto">
            {formData.abates.map((abate, index) => {
              const infoCategoria = lotesPorCategoria[abate.categoria];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === abate.categoria?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

              return (
                <div key={index} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-slate-900 mb-1.5">{abate.categoria}</div>
                      <div className="text-xl font-bold text-slate-900 mb-2">{infoCategoria.totalCabecas} cab</div>
                      <div className="space-y-1.5 text-[10px]">
                        <div className="flex gap-2">
                          <span className="font-medium text-slate-600 whitespace-nowrap">Lotes:</span>
                          <span className="font-semibold text-slate-900 break-words">{infoCategoria.lotes.map(l => l.nome).join(', ')}</span>
                        </div>
                      </div>
                    </div>
                    {iconeUrl && (
                      <img src={iconeUrl} alt={abate.categoria} className="w-12 h-12 object-contain flex-shrink-0" />
                    )}
                  </div>

                  <div className="space-y-3 mt-3 pt-3 border-t">
                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Quantidade *</Label>
                      <Input
                        type="number"
                        min="0"
                        max={infoCategoria.totalCabecas}
                        value={abate.quantidade}
                        onChange={(e) => handleAbateChange(index, 'quantidade', e.target.value)}
                        className="h-9 text-xs"
                        disabled={!abate.selecionada}
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Peso vivo (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={abate.peso_vivo_total}
                        onChange={(e) => handleAbateChange(index, 'peso_vivo_total', e.target.value)}
                        className="h-9 text-xs"
                        disabled={!abate.selecionada}
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Peso carcaça (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={abate.peso_carcaca_total}
                        onChange={(e) => handleAbateChange(index, 'peso_carcaca_total', e.target.value)}
                        className="h-9 text-xs"
                        disabled={!abate.selecionada}
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Destino</Label>
                      <Input
                        value={abate.destino}
                        onChange={(e) => handleAbateChange(index, 'destino', e.target.value)}
                        className="h-9 text-xs"
                        disabled={!abate.selecionada}
                        placeholder="Destino"
                      />
                    </div>

                    <Button
                      type="button"
                      onClick={() => handleAbateChange(index, 'selecionada', !abate.selecionada)}
                      className={`h-8 text-[10px] w-full ${abate.selecionada ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-600 hover:bg-slate-700'} text-white`}
                    >
                      {abate.selecionada ? 'Cancelar' : 'Selecionar'}
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
              Registrar Abates
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}