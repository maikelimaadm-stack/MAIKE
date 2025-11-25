import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

const COMBUSTIVEIS = ["Diesel", "Diesel S10", "Gasolina", "Etanol", "Arla 32"];
const LOCAIS = ["Fazenda", "Posto Externo", "Caminhão Comboio"];

export default function FormularioAbastecimento({ maquina, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [formData, setFormData] = useState({
    data_abastecimento: new Date().toISOString().split('T')[0],
    tipo_combustivel: maquina.tipo_combustivel || 'Diesel',
    quantidade_litros: '',
    valor_litro: '',
    horimetro: maquina.horimetro_atual || '',
    hodometro: maquina.hodometro_atual || '',
    tanque_cheio: true,
    local_abastecimento: 'Fazenda',
    operador: '',
    numero_cupom: '',
    observacoes: '',
  });

  const valorTotal = (parseFloat(formData.quantidade_litros) || 0) * (parseFloat(formData.valor_litro) || 0);

  const mutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        empresa_id: empresaSelecionadaId,
        maquina_id: maquina.id,
        maquina_nome: maquina.nome,
        ...data,
        quantidade_litros: parseFloat(data.quantidade_litros),
        valor_litro: parseFloat(data.valor_litro) || 0,
        valor_total: valorTotal,
        horimetro: data.horimetro ? parseFloat(data.horimetro) : null,
        hodometro: data.hodometro ? parseFloat(data.hodometro) : null,
      };

      await base44.entities.AbastecimentoMaquina.create(payload);

      // Atualizar horímetro/hodômetro da máquina
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
      toast.success('Abastecimento registrado!');
      onSave();
    },
    onError: (error) => {
      toast.error('Erro: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.quantidade_litros) {
      toast.error('Informe a quantidade');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Data *</Label>
          <Input
            type="date"
            value={formData.data_abastecimento}
            onChange={(e) => setFormData({ ...formData, data_abastecimento: e.target.value })}
            className="h-9"
            required
          />
        </div>
        <div>
          <Label className="text-xs">Combustível *</Label>
          <Select value={formData.tipo_combustivel} onValueChange={(v) => setFormData({ ...formData, tipo_combustivel: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMBUSTIVEIS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label className="text-xs">Quantidade (L) *</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.quantidade_litros}
            onChange={(e) => setFormData({ ...formData, quantidade_litros: e.target.value })}
            className="h-9"
            required
          />
        </div>
        <div>
          <Label className="text-xs">Valor/Litro (R$)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.valor_litro}
            onChange={(e) => setFormData({ ...formData, valor_litro: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Valor Total</Label>
          <div className="h-9 flex items-center px-3 bg-slate-100 rounded-md text-sm font-medium">
            R$ {valorTotal.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Horímetro</Label>
          <Input
            type="number"
            value={formData.horimetro}
            onChange={(e) => setFormData({ ...formData, horimetro: e.target.value })}
            className="h-9"
            placeholder={`Atual: ${maquina.horimetro_atual || 0}h`}
          />
        </div>
        <div>
          <Label className="text-xs">Hodômetro (km)</Label>
          <Input
            type="number"
            value={formData.hodometro}
            onChange={(e) => setFormData({ ...formData, hodometro: e.target.value })}
            className="h-9"
            placeholder={`Atual: ${maquina.hodometro_atual || 0} km`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Local</Label>
          <Select value={formData.local_abastecimento} onValueChange={(v) => setFormData({ ...formData, local_abastecimento: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCAIS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
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

      <div className="flex items-center space-x-2">
        <Checkbox
          id="tanque_cheio"
          checked={formData.tanque_cheio}
          onCheckedChange={(checked) => setFormData({ ...formData, tanque_cheio: checked })}
        />
        <label htmlFor="tanque_cheio" className="text-sm cursor-pointer">
          Tanque cheio
        </label>
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