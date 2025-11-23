import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function FormularioPontoSuplementacao({ ponto, coordenadas, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  
  const [formData, setFormData] = useState(ponto || {
    nome_ponto: "",
    tipo: "Sal Mineral",
    produto_padrao: "",
    capacidade_cocho_kg: "",
    area_vinculada_id: "",
    consumo_ideal_por_cabeca_kg: "",
    limite_minimo_consumo: "",
    limite_maximo_consumo: "",
    frequencia_esperada_dias: 7,
    alerta_sem_lancamento_dias: 10,
    status: "Ativo",
    observacoes: ""
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const areaSelecionada = areas.find(a => a.id === formData.area_vinculada_id);
    
    const dadosCompletos = {
      ...formData,
      empresa_id: empresaSelecionadaId,
      area_vinculada_nome: areaSelecionada?.nome || "",
      coordenadas: coordenadas || ponto?.coordenadas,
      capacidade_cocho_kg: formData.capacidade_cocho_kg ? parseFloat(formData.capacidade_cocho_kg) : null,
      consumo_ideal_por_cabeca_kg: formData.consumo_ideal_por_cabeca_kg ? parseFloat(formData.consumo_ideal_por_cabeca_kg) : null,
      limite_minimo_consumo: formData.limite_minimo_consumo ? parseFloat(formData.limite_minimo_consumo) : null,
      limite_maximo_consumo: formData.limite_maximo_consumo ? parseFloat(formData.limite_maximo_consumo) : null,
      frequencia_esperada_dias: parseInt(formData.frequencia_esperada_dias) || 7,
      alerta_sem_lancamento_dias: parseInt(formData.alerta_sem_lancamento_dias) || 10
    };
    
    onSubmit(dadosCompletos);
  };

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">
          {ponto ? 'Editar' : 'Novo'} Ponto de Suplementação
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Nome do Ponto *</Label>
            <Input
              value={formData.nome_ponto}
              onChange={(e) => setFormData({ ...formData, nome_ponto: e.target.value })}
              className="h-9 text-xs"
              placeholder="Ex: Cocho Pasto 01"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo de Suplemento *</Label>
              <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sal Mineral" className="text-xs">Sal Mineral</SelectItem>
                  <SelectItem value="Proteinado" className="text-xs">Proteinado</SelectItem>
                  <SelectItem value="Ração" className="text-xs">Ração</SelectItem>
                  <SelectItem value="Núcleo" className="text-xs">Núcleo</SelectItem>
                  <SelectItem value="Outro" className="text-xs">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Ativo" className="text-xs">Ativo</SelectItem>
                  <SelectItem value="Inativo" className="text-xs">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Área Vinculada *</Label>
            <Select value={formData.area_vinculada_id} onValueChange={(v) => setFormData({ ...formData, area_vinculada_id: v })}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Selecione a área" />
              </SelectTrigger>
              <SelectContent>
                {areas.map(area => (
                  <SelectItem key={area.id} value={area.id} className="text-xs">
                    {area.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Produto Padrão</Label>
            <Input
              value={formData.produto_padrao}
              onChange={(e) => setFormData({ ...formData, produto_padrao: e.target.value })}
              className="h-9 text-xs"
              placeholder="Ex: Sal Proteinado 18%"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Capacidade do Cocho (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.capacidade_cocho_kg}
                onChange={(e) => setFormData({ ...formData, capacidade_cocho_kg: e.target.value })}
                className="h-9 text-xs"
                placeholder="0"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Consumo Ideal (kg/cab/dia)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.consumo_ideal_por_cabeca_kg}
                onChange={(e) => setFormData({ ...formData, consumo_ideal_por_cabeca_kg: e.target.value })}
                className="h-9 text-xs"
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Limite Mínimo (kg/cab)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.limite_minimo_consumo}
                onChange={(e) => setFormData({ ...formData, limite_minimo_consumo: e.target.value })}
                className="h-9 text-xs"
                placeholder="0"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Limite Máximo (kg/cab)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.limite_maximo_consumo}
                onChange={(e) => setFormData({ ...formData, limite_maximo_consumo: e.target.value })}
                className="h-9 text-xs"
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Frequência Esperada (dias)</Label>
              <Input
                type="number"
                value={formData.frequencia_esperada_dias}
                onChange={(e) => setFormData({ ...formData, frequencia_esperada_dias: e.target.value })}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Alerta sem Lançamento (dias)</Label>
              <Input
                type="number"
                value={formData.alerta_sem_lancamento_dias}
                onChange={(e) => setFormData({ ...formData, alerta_sem_lancamento_dias: e.target.value })}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
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
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              {ponto ? 'Atualizar' : 'Criar'} Ponto
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}