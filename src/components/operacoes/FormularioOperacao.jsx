import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const TIPOS_OPERACAO = ["Gradagem", "Aração", "Plantio", "Pulverização", "Adubação", "Colheita", "Roçagem", "Calagem", "Dessecação", "Subsolagem", "Outro"];

export default function FormularioOperacao({ operacao, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [formData, setFormData] = useState({
    tipo_operacao: operacao?.tipo_operacao || '',
    area_id: operacao?.area_id || '',
    maquina_id: operacao?.maquina_id || '',
    implemento_id: operacao?.implemento_id || '',
    data_inicio: operacao?.data_inicio || new Date().toISOString().split('T')[0],
    data_fim: operacao?.data_fim || '',
    hectares_trabalhados: operacao?.hectares_trabalhados || '',
    horas_trabalhadas: operacao?.horas_trabalhadas || '',
    horimetro_inicio: operacao?.horimetro_inicio || '',
    horimetro_fim: operacao?.horimetro_fim || '',
    combustivel_consumido: operacao?.combustivel_consumido || '',
    produto_aplicado: operacao?.produto_aplicado || '',
    quantidade_produto: operacao?.quantidade_produto || '',
    unidade_produto: operacao?.unidade_produto || '',
    dose_por_hectare: operacao?.dose_por_hectare || '',
    operador: operacao?.operador || '',
    safra_id: operacao?.safra_id || '',
    custo_total: operacao?.custo_total || '',
    status: operacao?.status || 'Concluída',
    observacoes: operacao?.observacoes || '',
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-operacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ['maquinas-operacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: safras = [] } = useQuery({
    queryKey: ['safras-operacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const implementos = maquinas.filter(m => m.tipo === 'Implemento');

  const mutation = useMutation({
    mutationFn: async (data) => {
      const area = areas.find(a => a.id === data.area_id);
      const maquina = maquinas.find(m => m.id === data.maquina_id);
      const implemento = maquinas.find(m => m.id === data.implemento_id);
      const safra = safras.find(s => s.id === data.safra_id);

      const payload = {
        ...data,
        empresa_id: empresaSelecionadaId,
        area_nome: area?.nome || '',
        maquina_nome: maquina?.nome || '',
        implemento_nome: implemento?.nome || '',
        safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : '',
        hectares_trabalhados: data.hectares_trabalhados ? parseFloat(data.hectares_trabalhados) : null,
        horas_trabalhadas: data.horas_trabalhadas ? parseFloat(data.horas_trabalhadas) : null,
        horimetro_inicio: data.horimetro_inicio ? parseFloat(data.horimetro_inicio) : null,
        horimetro_fim: data.horimetro_fim ? parseFloat(data.horimetro_fim) : null,
        combustivel_consumido: data.combustivel_consumido ? parseFloat(data.combustivel_consumido) : null,
        quantidade_produto: data.quantidade_produto ? parseFloat(data.quantidade_produto) : null,
        dose_por_hectare: data.dose_por_hectare ? parseFloat(data.dose_por_hectare) : null,
        custo_total: data.custo_total ? parseFloat(data.custo_total) : null,
      };

      if (operacao) {
        return base44.entities.OperacaoAgricola.update(operacao.id, payload);
      }
      return base44.entities.OperacaoAgricola.create(payload);
    },
    onSuccess: () => {
      toast.success(operacao ? 'Operação atualizada!' : 'Operação registrada!');
      onSave();
    },
    onError: (error) => {
      toast.error('Erro: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.tipo_operacao || !formData.area_id) {
      toast.error('Preencha tipo e área');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Tipo de Operação *</Label>
          <Select value={formData.tipo_operacao} onValueChange={(v) => setFormData({ ...formData, tipo_operacao: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_OPERACAO.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Planejada">Planejada</SelectItem>
              <SelectItem value="Em Andamento">Em Andamento</SelectItem>
              <SelectItem value="Concluída">Concluída</SelectItem>
              <SelectItem value="Cancelada">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Máquina</Label>
          <Select value={formData.maquina_id} onValueChange={(v) => setFormData({ ...formData, maquina_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {maquinas.filter(m => m.tipo !== 'Implemento').map(m => (
                <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Implemento</Label>
          <Select value={formData.implemento_id} onValueChange={(v) => setFormData({ ...formData, implemento_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {implementos.map(i => <SelectItem key={i.id} value={i.id}>{i.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs">Data Início *</Label>
          <Input
            type="date"
            value={formData.data_inicio}
            onChange={(e) => setFormData({ ...formData, data_inicio: e.target.value })}
            className="h-9"
            required
          />
        </div>
        <div>
          <Label className="text-xs">Data Fim</Label>
          <Input
            type="date"
            value={formData.data_fim}
            onChange={(e) => setFormData({ ...formData, data_fim: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Hectares</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.hectares_trabalhados}
            onChange={(e) => setFormData({ ...formData, hectares_trabalhados: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Horas</Label>
          <Input
            type="number"
            step="0.1"
            value={formData.horas_trabalhadas}
            onChange={(e) => setFormData({ ...formData, horas_trabalhadas: e.target.value })}
            className="h-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs">Horímetro Início</Label>
          <Input
            type="number"
            value={formData.horimetro_inicio}
            onChange={(e) => setFormData({ ...formData, horimetro_inicio: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Horímetro Fim</Label>
          <Input
            type="number"
            value={formData.horimetro_fim}
            onChange={(e) => setFormData({ ...formData, horimetro_fim: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Combustível (L)</Label>
          <Input
            type="number"
            step="0.1"
            value={formData.combustivel_consumido}
            onChange={(e) => setFormData({ ...formData, combustivel_consumido: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Operador</Label>
          <Input
            value={formData.operador}
            onChange={(e) => setFormData({ ...formData, operador: e.target.value })}
            className="h-9"
          />
        </div>
      </div>

      {(formData.tipo_operacao === 'Pulverização' || formData.tipo_operacao === 'Adubação' || formData.tipo_operacao === 'Calagem') && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-slate-50 rounded-lg">
          <div>
            <Label className="text-xs">Produto Aplicado</Label>
            <Input
              value={formData.produto_aplicado}
              onChange={(e) => setFormData({ ...formData, produto_aplicado: e.target.value })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Quantidade</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.quantidade_produto}
              onChange={(e) => setFormData({ ...formData, quantidade_produto: e.target.value })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Unidade</Label>
            <Input
              value={formData.unidade_produto}
              onChange={(e) => setFormData({ ...formData, unidade_produto: e.target.value })}
              className="h-9"
              placeholder="kg, L, etc"
            />
          </div>
          <div>
            <Label className="text-xs">Dose/ha</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.dose_por_hectare}
              onChange={(e) => setFormData({ ...formData, dose_por_hectare: e.target.value })}
              className="h-9"
            />
          </div>
        </div>
      )}

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