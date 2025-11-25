import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const STATUS_AREA = ["Pousio", "Preparação", "Plantada", "Em Desenvolvimento", "Colheita", "Colhida"];
const CULTURAS = ["Soja", "Milho", "Algodão", "Feijão", "Sorgo", "Milheto", "Girassol", "Pastagem", "Outro"];

export default function FormularioControleArea({ controle, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [formData, setFormData] = useState({
    area_id: controle?.area_id || '',
    safra_id: controle?.safra_id || '',
    cultura: controle?.cultura || '',
    variedade: controle?.variedade || '',
    data_plantio: controle?.data_plantio || '',
    data_colheita_prevista: controle?.data_colheita_prevista || '',
    data_colheita_real: controle?.data_colheita_real || '',
    area_plantada_ha: controle?.area_plantada_ha || '',
    populacao_plantas: controle?.populacao_plantas || '',
    espacamento_linha: controle?.espacamento_linha || '',
    producao_estimada_kg: controle?.producao_estimada_kg || '',
    producao_real_kg: controle?.producao_real_kg || '',
    produtividade_sc_ha: controle?.produtividade_sc_ha || '',
    custo_total: controle?.custo_total || '',
    custo_por_hectare: controle?.custo_por_hectare || '',
    receita_total: controle?.receita_total || '',
    lucro_prejuizo: controle?.lucro_prejuizo || '',
    status: controle?.status || 'Pousio',
    observacoes: controle?.observacoes || '',
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-controle', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: safras = [] } = useQuery({
    queryKey: ['safras-controle', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const mutation = useMutation({
    mutationFn: async (data) => {
      const area = areas.find(a => a.id === data.area_id);
      const safra = safras.find(s => s.id === data.safra_id);

      // Calcular produtividade
      let produtividade = data.produtividade_sc_ha;
      if (data.producao_real_kg && data.area_plantada_ha) {
        produtividade = (parseFloat(data.producao_real_kg) / 60) / parseFloat(data.area_plantada_ha);
      }

      // Calcular lucro
      let lucro = data.lucro_prejuizo;
      if (data.receita_total && data.custo_total) {
        lucro = parseFloat(data.receita_total) - parseFloat(data.custo_total);
      }

      // Calcular custo por hectare
      let custoPorHa = data.custo_por_hectare;
      if (data.custo_total && data.area_plantada_ha) {
        custoPorHa = parseFloat(data.custo_total) / parseFloat(data.area_plantada_ha);
      }

      const payload = {
        ...data,
        empresa_id: empresaSelecionadaId,
        area_nome: area?.nome || '',
        safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : '',
        area_plantada_ha: data.area_plantada_ha ? parseFloat(data.area_plantada_ha) : null,
        populacao_plantas: data.populacao_plantas ? parseInt(data.populacao_plantas) : null,
        espacamento_linha: data.espacamento_linha ? parseFloat(data.espacamento_linha) : null,
        producao_estimada_kg: data.producao_estimada_kg ? parseFloat(data.producao_estimada_kg) : null,
        producao_real_kg: data.producao_real_kg ? parseFloat(data.producao_real_kg) : null,
        produtividade_sc_ha: produtividade ? parseFloat(produtividade).toFixed(2) : null,
        custo_total: data.custo_total ? parseFloat(data.custo_total) : null,
        custo_por_hectare: custoPorHa ? parseFloat(custoPorHa).toFixed(2) : null,
        receita_total: data.receita_total ? parseFloat(data.receita_total) : null,
        lucro_prejuizo: lucro ? parseFloat(lucro).toFixed(2) : null,
      };

      if (controle) {
        return base44.entities.ControleArea.update(controle.id, payload);
      }
      return base44.entities.ControleArea.create(payload);
    },
    onSuccess: () => {
      toast.success(controle ? 'Registro atualizado!' : 'Registro criado!');
      onSave();
    },
    onError: (error) => {
      toast.error('Erro: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.area_id) {
      toast.error('Selecione a área');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Área *</Label>
          <Select value={formData.area_id} onValueChange={(v) => setFormData({ ...formData, area_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione a área" />
            </SelectTrigger>
            <SelectContent>
              {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Safra</Label>
          <Select value={formData.safra_id} onValueChange={(v) => setFormData({ ...formData, safra_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {safras.map(s => <SelectItem key={s.id} value={s.id}>{s.ano_inicio}/{s.ano_fim}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs">Cultura</Label>
          <Select value={formData.cultura} onValueChange={(v) => setFormData({ ...formData, cultura: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {CULTURAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Variedade</Label>
          <Input
            value={formData.variedade}
            onChange={(e) => setFormData({ ...formData, variedade: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_AREA.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs">Área Plantada (ha)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.area_plantada_ha}
            onChange={(e) => setFormData({ ...formData, area_plantada_ha: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Data Plantio</Label>
          <Input
            type="date"
            value={formData.data_plantio}
            onChange={(e) => setFormData({ ...formData, data_plantio: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Colheita Prevista</Label>
          <Input
            type="date"
            value={formData.data_colheita_prevista}
            onChange={(e) => setFormData({ ...formData, data_colheita_prevista: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Colheita Real</Label>
          <Input
            type="date"
            value={formData.data_colheita_real}
            onChange={(e) => setFormData({ ...formData, data_colheita_real: e.target.value })}
            className="h-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs">População (pl/ha)</Label>
          <Input
            type="number"
            value={formData.populacao_plantas}
            onChange={(e) => setFormData({ ...formData, populacao_plantas: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Espaçamento (cm)</Label>
          <Input
            type="number"
            value={formData.espacamento_linha}
            onChange={(e) => setFormData({ ...formData, espacamento_linha: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Prod. Estimada (kg)</Label>
          <Input
            type="number"
            value={formData.producao_estimada_kg}
            onChange={(e) => setFormData({ ...formData, producao_estimada_kg: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Prod. Real (kg)</Label>
          <Input
            type="number"
            value={formData.producao_real_kg}
            onChange={(e) => setFormData({ ...formData, producao_real_kg: e.target.value })}
            className="h-9"
          />
        </div>
      </div>

      <div className="p-3 bg-slate-50 rounded-lg">
        <h4 className="text-xs font-semibold text-slate-700 mb-3">Financeiro</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs">Custo Total (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.custo_total}
              onChange={(e) => setFormData({ ...formData, custo_total: e.target.value })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Receita Total (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.receita_total}
              onChange={(e) => setFormData({ ...formData, receita_total: e.target.value })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Custo/ha</Label>
            <div className="h-9 flex items-center px-3 bg-white rounded-md text-sm border">
              {formData.custo_total && formData.area_plantada_ha 
                ? `R$ ${(parseFloat(formData.custo_total) / parseFloat(formData.area_plantada_ha)).toFixed(2)}`
                : '-'}
            </div>
          </div>
          <div>
            <Label className="text-xs">Lucro/Prejuízo</Label>
            <div className={`h-9 flex items-center px-3 rounded-md text-sm font-medium border ${
              formData.receita_total && formData.custo_total
                ? parseFloat(formData.receita_total) - parseFloat(formData.custo_total) >= 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
                : 'bg-white'
            }`}>
              {formData.receita_total && formData.custo_total
                ? `R$ ${(parseFloat(formData.receita_total) - parseFloat(formData.custo_total)).toLocaleString()}`
                : '-'}
            </div>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs">Observações</Label>
        <Textarea
          value={formData.observacoes}
          onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
          rows={2}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}