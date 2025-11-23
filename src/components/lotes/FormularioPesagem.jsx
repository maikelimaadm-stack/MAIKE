import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Save } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function FormularioPesagem({ lote, onSubmit, onCancel }) {
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
      acc[cat] = { categoria: cat, lotes: [], totalCabecas: 0, pesoAnterior: l.peso_medio_kg || 0 };
    }
    acc[cat].lotes.push(l);
    acc[cat].totalCabecas += l.quantidade_cabecas || 0;
    return acc;
  }, {});

  const categoriasDisponiveis = Object.keys(lotesPorCategoria).sort();
  
  console.log('⚖️ PESAGEM - Total de lotes recebidos:', lotesArray.length);
  console.log('⚖️ PESAGEM - Categorias encontradas:', categoriasDisponiveis);
  console.log('⚖️ PESAGEM - Detalhes por categoria:', lotesPorCategoria);

  const [modoPesagem, setModoPesagem] = useState("categorias"); // "categorias" ou "todos"
  const [pesoGeral, setPesoGeral] = useState("");

  const [formData, setFormData] = useState({
    data_pesagem: new Date().toISOString().split('T')[0],
    pesagens: categoriasDisponiveis.map(cat => ({
      categoria: cat,
      peso: lotesPorCategoria[cat].pesoAnterior,
      selecionada: false
    })),
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (modoPesagem === "todos") {
      if (!pesoGeral || parseFloat(pesoGeral) <= 0) {
        alert("Informe o peso para todos os animais");
        return;
      }
      
      onSubmit({
        data_pesagem: formData.data_pesagem,
        categorias_selecionadas: categoriasDisponiveis,
        pesos_por_categoria: categoriasDisponiveis.reduce((acc, cat) => ({ ...acc, [cat]: parseFloat(pesoGeral) }), {}),
        observacoes: formData.observacoes
      });
    } else {
      const pesagensValidas = formData.pesagens.filter(p => p.selecionada && p.peso > 0);
      if (pesagensValidas.length === 0) {
        alert("Selecione e configure pelo menos uma pesagem");
        return;
      }
      
      onSubmit({
        data_pesagem: formData.data_pesagem,
        categorias_selecionadas: pesagensValidas.map(p => p.categoria),
        pesos_por_categoria: pesagensValidas.reduce((acc, p) => ({ ...acc, [p.categoria]: p.peso }), {}),
        observacoes: formData.observacoes
      });
    }
  };

  const handlePesagemChange = (index, field, value) => {
    const novasPesagens = [...formData.pesagens];
    novasPesagens[index] = { ...novasPesagens[index], [field]: value };
    setFormData({ ...formData, pesagens: novasPesagens });
  };

  const nomeExibicao = lotesArray.map(l => l.nome).join(' - ');

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Registrar Pesagem - {nomeExibicao}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div className="space-y-2 border-b pb-3">
            <Label className="text-xs font-semibold">Modo de Pesagem</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => setModoPesagem("categorias")}
                className={`flex-1 h-9 text-xs ${modoPesagem === "categorias" ? 'bg-slate-700 hover:bg-slate-800 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Pesar por Categoria
              </Button>
              <Button
                type="button"
                onClick={() => setModoPesagem("todos")}
                className={`flex-1 h-9 text-xs ${modoPesagem === "todos" ? 'bg-slate-700 hover:bg-slate-800 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Pesar Todos (Mesmo Peso)
              </Button>
            </div>
          </div>

          {modoPesagem === "todos" ? (
            <div className="space-y-2 bg-slate-50 border border-slate-300 rounded-lg p-4">
              <Label className="text-xs font-semibold">Peso para Todos os Animais</Label>
              <Input
                type="number"
                step="0.1"
                value={pesoGeral}
                onChange={(e) => setPesoGeral(e.target.value)}
                className="h-10 text-sm font-semibold"
                placeholder="Peso em kg"
              />
              <div className="text-[10px] text-slate-600 mt-2">
                Este peso será aplicado a todas as {categoriasDisponiveis.length} categoria(s) selecionada(s)
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[40vh] overflow-y-auto">
            {formData.pesagens.map((pesagem, index) => {
              const infoCategoria = lotesPorCategoria[pesagem.categoria];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === pesagem.categoria?.toUpperCase()
              );
              const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;
              const ganho = pesagem.peso - infoCategoria.pesoAnterior;

              return (
                <div key={index} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-slate-900 mb-1.5">{pesagem.categoria}</div>
                      <div className="text-xl font-bold text-slate-900 mb-2">{infoCategoria.totalCabecas} cab</div>
                      <div className="space-y-1.5 text-[10px]">
                        <div className="flex gap-2">
                          <span className="font-medium text-slate-600 whitespace-nowrap">Lotes:</span>
                          <span className="font-semibold text-slate-900 break-words">{infoCategoria.lotes.map(l => l.nome).join(', ')}</span>
                        </div>
                      </div>
                    </div>
                    {iconeUrl && (
                      <img src={iconeUrl} alt={pesagem.categoria} className="w-12 h-12 object-contain flex-shrink-0" />
                    )}
                  </div>

                  <div className="space-y-3 mt-3 pt-3 border-t">
                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Peso anterior</Label>
                      <Input
                        value={infoCategoria.pesoAnterior}
                        disabled
                        className="h-9 text-xs bg-slate-100"
                      />
                    </div>

                    <div>
                      <Label className="text-[10px] font-medium text-slate-600 mb-1.5 block">Peso atual (kg) *</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={pesagem.peso}
                        onChange={(e) => handlePesagemChange(index, 'peso', parseFloat(e.target.value) || 0)}
                        className="h-9 text-xs"
                        disabled={!pesagem.selecionada}
                        placeholder="0"
                      />
                    </div>

                    {pesagem.selecionada && ganho !== 0 && (
                      <div className="text-[10px] text-slate-600">
                        Ganho: <span className={ganho > 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                          {ganho > 0 ? '+' : ''}{ganho.toFixed(1)} kg
                        </span>
                      </div>
                    )}

                    <Button
                      type="button"
                      onClick={() => handlePesagemChange(index, 'selecionada', !pesagem.selecionada)}
                      className={`h-8 text-[10px] w-full ${pesagem.selecionada ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-600 hover:bg-slate-700'} text-white`}
                    >
                      {pesagem.selecionada ? 'Cancelar' : 'Selecionar'}
                    </Button>
                  </div>
                </div>
              );
            })}
            </div>
          )}

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
              Registrar Pesagens
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}