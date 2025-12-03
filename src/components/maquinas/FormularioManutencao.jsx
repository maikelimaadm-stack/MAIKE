import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const TIPOS = ["Preventiva", "Corretiva", "Preditiva"];
const CATEGORIAS = ["Troca de Óleo", "Filtros", "Pneus", "Freios", "Motor", "Transmissão", "Hidráulico", "Elétrico", "Funilaria", "Revisão Geral", "Outro"];

export default function FormularioManutencao({ maquina, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [formData, setFormData] = useState({
    data_manutencao: new Date().toISOString().split('T')[0],
    tipo_manutencao: 'Corretiva',
    categoria: '',
    descricao: '',
    horimetro: maquina.horimetro_atual || '',
    hodometro: maquina.hodometro_atual || '',
    fornecedor_id: '',
    valor_pecas: '',
    valor_mao_obra: '',
    proxima_manutencao_horimetro: '',
    proxima_manutencao_data: '',
    numero_os: '',
    numero_nf: '',
    status: 'Concluída',
    observacoes: '',
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const valorTotal = (parseFloat(formData.valor_pecas) || 0) + (parseFloat(formData.valor_mao_obra) || 0);

  const mutation = useMutation({
    mutationFn: async (data) => {
      const fornecedor = fornecedores.find(f => f.id === data.fornecedor_id);
      const payload = {
        empresa_id: empresaSelecionadaId,
        maquina_id: maquina.id,
        maquina_nome: maquina.nome,
        ...data,
        fornecedor_nome: fornecedor?.nome || '',
        valor_pecas: parseFloat(data.valor_pecas) || 0,
        valor_mao_obra: parseFloat(data.valor_mao_obra) || 0,
        valor_total: valorTotal,
        horimetro: data.horimetro ? parseFloat(data.horimetro) : null,
        hodometro: data.hodometro ? parseFloat(data.hodometro) : null,
        proxima_manutencao_horimetro: data.proxima_manutencao_horimetro ? parseFloat(data.proxima_manutencao_horimetro) : null,
      };

      await base44.entities.ManutencaoMaquina.create(payload);

      // Atualizar status da máquina se em manutenção
      if (data.status === 'Em Andamento' || data.status === 'Agendada') {
        await base44.entities.Maquina.update(maquina.id, { status: 'Em Manutenção' });
      }

      // Atualizar horímetro/hodômetro
      const updates = {};
      if (data.horimetro && parseFloat(data.horimetro) > (maquina.horimetro_atual || 0)) {
        updates.horimetro_atual = parseFloat(data.horimetro);
      }
      if (data.hodometro && parseFloat(data.hodometro) > (maquina.hodometro_atual || 0)) {
        updates.hodometro_atual = parseFloat(data.hodometro);
      }
      if (Object.keys(updates).length > 0) {
        await base44.entities.Maquina.update(maquina.id, updates);
      }
    },
    onSuccess: () => {
      toast.success('Manutenção registrada!');
      onSave();
    },
    onError: (error) => {
      toast.error('Erro: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.tipo_manutencao || !formData.categoria) {
      toast.error('Preencha tipo e categoria');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Data *</Label>
          <Input
            type="date"
            value={formData.data_manutencao}
            onChange={(e) => setFormData({ ...formData, data_manutencao: e.target.value })}
            className="h-8 text-xs"
            required
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo *</Label>
          <Select value={formData.tipo_manutencao} onValueChange={(v) => setFormData({ ...formData, tipo_manutencao: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Categoria *</Label>
          <Select value={formData.categoria} onValueChange={(v) => setFormData({ ...formData, categoria: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIAS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Agendada" className="text-xs">Agendada</SelectItem>
              <SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem>
              <SelectItem value="Concluída" className="text-xs">Concluída</SelectItem>
              <SelectItem value="Cancelada" className="text-xs">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Descrição</Label>
        <Textarea
          value={formData.descricao}
          onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
          rows={2}
          placeholder="Descreva o serviço realizado..."
          className="text-xs"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Valor Peças (R$)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.valor_pecas}
            onChange={(e) => setFormData({ ...formData, valor_pecas: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Mão de Obra (R$)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.valor_mao_obra}
            onChange={(e) => setFormData({ ...formData, valor_mao_obra: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Total</Label>
          <Input
            value={`R$ ${valorTotal.toFixed(2)}`}
            readOnly
            className="h-8 text-xs font-semibold bg-slate-50"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Horímetro</Label>
          <Input
            type="number"
            value={formData.horimetro}
            onChange={(e) => setFormData({ ...formData, horimetro: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fornecedor/Oficina</Label>
          <Select value={formData.fornecedor_id} onValueChange={(v) => setFormData({ ...formData, fornecedor_id: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {fornecedores.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Próxima Manutenção (Horímetro)</Label>
          <Input
            type="number"
            value={formData.proxima_manutencao_horimetro}
            onChange={(e) => setFormData({ ...formData, proxima_manutencao_horimetro: e.target.value })}
            className="h-8 text-xs"
            placeholder="Ex: 500"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Próxima Manutenção (Data)</Label>
          <Input
            type="date"
            value={formData.proxima_manutencao_data}
            onChange={(e) => setFormData({ ...formData, proxima_manutencao_data: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
          {mutation.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}