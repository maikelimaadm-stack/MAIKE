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

  const [formData, setFormData] = useState({
    data_abate: getTodayLocalDate(),
    abates: [],
    observacoes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const abatesValidos = formData.abates.filter(a => parseInt(a.quantidade) > 0);
    if (abatesValidos.length === 0) {
      alert("Preencha pelo menos um abate com quantidade");
      return;
    }
    
    abatesValidos.forEach(abate => {
      onSubmit({
        data_abate: formData.data_abate,
        categoria: abate.categoria,
        quantidade: parseInt(abate.quantidade),
        peso_vivo_total: abate.peso_vivo_total ? parseFloat(abate.peso_vivo_total) : null,
        peso_carcaca_total: abate.peso_carcaca_total ? parseFloat(abate.peso_carcaca_total) : null,
        destino: abate.destino,
        destino_nome: abate.destino_nome,
        observacoes: formData.observacoes
      });
    });
  };

  const adicionarCategoria = () => {
    const primeiraCategoria = categoriasDisponiveis[0];
    setFormData(prev => ({
      ...prev,
      abates: [...prev.abates, {
        categoria: primeiraCategoria,
        quantidade: "",
        peso_vivo_total: "",
        peso_carcaca_total: "",
        destino: ""
      }]
    }));
  };

  const removerCategoria = (index) => {
    setFormData(prev => ({
      ...prev,
      abates: prev.abates.filter((_, i) => i !== index)
    }));
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
      <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-1">
          <FL label="Data do Abate" required>
            <Input type="date" value={formData.data_abate} onChange={(e) => setFormData({ ...formData, data_abate: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" required />
          </FL>

          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {formData.abates.map((abate, index) => {
              const infoCategoria = lotesPorCategoria[abate.categoria];
              const configIcone = iconesConfig.find(ic => 
                ic.tipo_entidade === 'Lote' && 
                ic.categoria?.toUpperCase() === abate.categoria?.toUpperCase()
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
                      value={abate.categoria}
                      onValueChange={(v) => handleAbateChange(index, 'categoria', v)}
                    >
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                        <SelectValue>
                          {infoCategoria?.totalCabecas || 0} cb - {abate.categoria}
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
                        value={abate.quantidade}
                        onChange={(e) => handleAbateChange(index, 'quantidade', e.target.value)}
                        className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                        placeholder="0"
                        required
                      />
                    </FL>
                    <FL label="Peso Vivo Total (kg)">
                      <Input
                        type="number"
                        step="0.1"
                        value={abate.peso_vivo_total}
                        onChange={(e) => handleAbateChange(index, 'peso_vivo_total', e.target.value)}
                        className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                        placeholder="0"
                      />
                    </FL>
                    <FL label="Peso Carcaça Total (kg)">
                      <Input
                        type="number"
                        step="0.1"
                        value={abate.peso_carcaca_total}
                        onChange={(e) => handleAbateChange(index, 'peso_carcaca_total', e.target.value)}
                        className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                        placeholder="0"
                      />
                    </FL>

                    <FL label="Destino">
                      <Select
                        value={abate.destino}
                        onValueChange={(v) => handleAbateChange(index, 'destino', v)}
                      >
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                          <SelectValue placeholder="Selecione o destino" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Frigorífico" className="text-xs">Frigorífico</SelectItem>
                          <SelectItem value="Açougue" className="text-xs">Açougue</SelectItem>
                          <SelectItem value="Consumo Próprio" className="text-xs">Consumo Próprio</SelectItem>
                          <SelectItem value="Venda Direta" className="text-xs">Venda Direta</SelectItem>
                          <SelectItem value="Outro" className="text-xs">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </FL>

                    {(abate.destino === "Frigorífico" || abate.destino === "Açougue" || abate.destino === "Venda Direta" || abate.destino === "Outro") && (
                      <FL label={abate.destino === "Frigorífico" ? "Nome do Frigorífico" : "Nome do Cliente"} required>
                        <Input
                          value={abate.destino_nome || ""}
                          onChange={(e) => handleAbateChange(index, 'destino_nome', e.target.value.toUpperCase())}
                          className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                          style={{ textTransform: 'uppercase' }}
                          placeholder={abate.destino === "Frigorífico" ? "NOME DO FRIGORÍFICO" : "NOME DO CLIENTE"}
                          required
                        />
                      </FL>
                    )}
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
            <Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">Registrar Abates</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}