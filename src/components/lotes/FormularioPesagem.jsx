import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Save, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function FormularioPesagem({ lote, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [saving, setSaving] = useState(false);
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

  const [modoPesagem, setModoPesagem] = useState("categorias");
  const [pesoGeral, setPesoGeral] = useState("");
  const [pesosIndividuais, setPesosIndividuais] = useState({});

  // Se há múltiplos lotes na mesma categoria com pesos diferentes, habilitar modo individual
  const temLotesComPesosDiferentes = Object.values(lotesPorCategoria).some(cat => {
    if (cat.lotes.length <= 1) return false;
    const pesos = cat.lotes.map(l => l.peso_medio_kg || 0);
    return new Set(pesos).size > 1;
  });

  const [formData, setFormData] = useState({
    data_pesagem: new Date().toISOString().split('T')[0],
    pesagens: [],
    observacoes: ""
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    
    if (modoPesagem === "todos") {
      if (!pesoGeral || parseFloat(pesoGeral) <= 0) {
        alert("Informe o peso para todos os animais");
        return;
      }

      setSaving(true);
      try {
        await onSubmit({
          data_pesagem: formData.data_pesagem,
          categorias_selecionadas: categoriasDisponiveis,
          pesos_por_categoria: categoriasDisponiveis.reduce((acc, cat) => {
            acc[cat] = parseFloat(pesoGeral);
            return acc;
          }, {}),
          observacoes: formData.observacoes
        });
      } finally {
        setSaving(false);
      }
    } else if (modoPesagem === "individual") {
      // Modo individual: peso por lote
      const lotesComPeso = Object.entries(pesosIndividuais).filter(([, peso]) => peso && parseFloat(peso) > 0);
      if (lotesComPeso.length === 0) {
        alert("Preencha o peso de pelo menos um lote");
        return;
      }
      const categoriasAfetadas = [...new Set(lotesArray.filter(l => pesosIndividuais[l.id]).map(l => l.categoria))];
      setSaving(true);
      try {
        await onSubmit({
          data_pesagem: formData.data_pesagem,
          categorias_selecionadas: categoriasAfetadas,
          pesos_por_categoria: categoriasAfetadas.reduce((acc, cat) => {
            // Usa o primeiro peso da categoria como fallback
            const primeiroLote = lotesArray.find(l => l.categoria === cat && pesosIndividuais[l.id]);
            acc[cat] = primeiroLote ? parseFloat(pesosIndividuais[primeiroLote.id]) : 0;
            return acc;
          }, {}),
          pesos_por_lote: Object.fromEntries(lotesComPeso),
          observacoes: formData.observacoes
        });
      } finally {
        setSaving(false);
      }
    } else {
      const pesagensValidas = formData.pesagens.filter(p => p.peso && parseFloat(p.peso) > 0);
      if (pesagensValidas.length === 0) {
        alert("Preencha o peso de pelo menos uma categoria");
        return;
      }

      setSaving(true);
      try {
        await onSubmit({
          data_pesagem: formData.data_pesagem,
          categorias_selecionadas: pesagensValidas.map(p => p.categoria),
          pesos_por_categoria: pesagensValidas.reduce((acc, p) => {
            acc[p.categoria] = parseFloat(p.peso);
            return acc;
          }, {}),
          observacoes: formData.observacoes
        });
      } finally {
        setSaving(false);
      }
    }
  };



  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      pesagens: [...prev.pesagens, {
        categoria: primeiraCategoria,
        peso: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      pesagens: prev.pesagens.filter((_, i) => i !== index)
    }));
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
      <CardContent className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Data da Pesagem *</Label>
            <Input
              type="date"
              value={formData.data_pesagem}
              onChange={(e) => setFormData({ ...formData, data_pesagem: e.target.value })}
              className="h-9 text-xs"
              required
            />
          </div>

          <div className="space-y-2 border-b pb-3">
            <Label className="text-xs font-semibold">Modo de Pesagem</Label>
            <div className="flex gap-2 flex-wrap">
              <Button
                type="button"
                onClick={() => setModoPesagem("categorias")}
                variant={modoPesagem === "categorias" ? "default" : "outline"}
                className={`flex-1 h-8 text-xs ${modoPesagem === "categorias" ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              >
                Por Categoria
              </Button>
              <Button
                type="button"
                onClick={() => setModoPesagem("individual")}
                variant={modoPesagem === "individual" ? "default" : "outline"}
                className={`flex-1 h-8 text-xs ${modoPesagem === "individual" ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              >
                Por Lote
              </Button>
              <Button
                type="button"
                onClick={() => setModoPesagem("todos")}
                variant={modoPesagem === "todos" ? "default" : "outline"}
                className={`flex-1 h-8 text-xs ${modoPesagem === "todos" ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              >
                Todos (Mesmo Peso)
              </Button>
            </div>
          </div>

          {modoPesagem === "individual" ? (
            <div className="space-y-2 max-h-[45vh] overflow-y-auto">
              {lotesArray.map((loteItem) => {
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === loteItem.categoria?.toUpperCase()
                );
                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;
                return (
                  <div key={loteItem.id} className="border border-slate-200 rounded-lg p-3 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      {iconeUrl && <img src={iconeUrl} alt="" className="w-6 h-6 object-contain" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{loteItem.nome}</div>
                        <div className="text-[10px] text-slate-500">{loteItem.categoria} • {loteItem.quantidade_cabecas || 0} cab • Peso atual: {loteItem.peso_medio_kg || 0} kg</div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600">Novo Peso (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={pesosIndividuais[loteItem.id] || ''}
                        onChange={(e) => setPesosIndividuais(prev => ({ ...prev, [loteItem.id]: e.target.value }))}
                        placeholder={String(loteItem.peso_medio_kg || 0)}
                        className="h-10 text-xs"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : modoPesagem === "todos" ? (
            <div className="space-y-2 bg-slate-50 border border-slate-300 rounded-lg p-4">
              <Label className="text-xs font-semibold">Peso para Todos os Animais (kg) *</Label>
              <Input
                type="number"
                step="0.1"
                value={pesoGeral}
                onChange={(e) => setPesoGeral(e.target.value)}
                className="h-10 text-sm font-semibold"
                placeholder="0"
              />
              <div className="text-[10px] text-slate-600 mt-2">
                Este peso será aplicado a todas as {categoriasDisponiveis.length} categoria(s)
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[45vh] overflow-y-auto">
              {formData.pesagens.map((pesagem, index) => {
                const infoCategoria = lotesPorCategoria[pesagem.categoria];
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === pesagem.categoria?.toUpperCase()
                );
                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

                return (
                  <div key={index} className="border border-slate-200 rounded-lg p-3 bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-semibold">Categoria</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removerCategoria(index)}
                        className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <Select
                      value={pesagem.categoria}
                      onValueChange={(v) => handlePesagemChange(index, 'categoria', v)}
                    >
                      <SelectTrigger className="h-10 text-xs mb-3">
                        <SelectValue>
                          {infoCategoria?.totalCabecas || 0} cb - {pesagem.categoria}
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

                    <div>
                      <Label className="text-xs text-slate-600">Peso Atual (kg) *</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={pesagem.peso}
                        onChange={(e) => handlePesagemChange(index, 'peso', e.target.value)}
                        placeholder="0"
                        className="h-10 text-xs"
                        required
                      />
                    </div>
                  </div>
                );
              })}

              <Button
                type="button"
                onClick={adicionarCategoria}
                variant="outline"
                className="w-full h-8 text-xs border-dashed border-2 border-slate-300 hover:border-slate-400"
              >
                Adicionar Categoria
              </Button>
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
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs" disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={saving}>
              {saving ? 'Salvando...' : 'Registrar Pesagens'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}