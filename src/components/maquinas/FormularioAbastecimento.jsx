import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

const LOCAIS = ["Fazenda", "Posto Externo", "Caminhão Comboio"];

export default function FormularioAbastecimento({ maquina, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const combustiveisVinculados = useMemo(() => maquina.produtos_combustiveis_vinculados || [], [maquina]);
  const produtoPrincipal = combustiveisVinculados.find((item) => item.principal);
  const [formData, setFormData] = useState({
    data_abastecimento: new Date().toISOString().split('T')[0],
    produto_id: produtoPrincipal?.produto_id || '',
    produto_nome: produtoPrincipal?.produto_nome || '',
    quantidade_litros: '',
    valor_litro: '',
    medicao: maquina.tipo_medicao !== 'Nenhum' ? (maquina.medicao_atual || '') : '',
    tanque_cheio: true,
    local_abastecimento: 'Fazenda',
    operador: '',
    numero_cupom: '',
    observacoes: '',
  });

  const valorTotal = (parseFloat(formData.quantidade_litros) || 0) * (parseFloat(formData.valor_litro) || 0);

  const mutation = useMutation({
    mutationFn: async (data) => {
      const produtoSelecionado = combustiveisVinculados.find((item) => item.produto_id === data.produto_id);
      if (!produtoSelecionado) {
        throw new Error('O produto selecionado não está vinculado ao ativo');
      }

      const payload = {
        empresa_id: empresaSelecionadaId,
        maquina_id: maquina.id,
        maquina_nome: maquina.nome,
        produto_id: data.produto_id,
        produto_nome: produtoSelecionado.produto_nome,
        tipo_combustivel: produtoSelecionado.produto_nome,
        quantidade_litros: parseFloat(data.quantidade_litros),
        valor_litro: parseFloat(data.valor_litro) || 0,
        valor_total: valorTotal,
        medicao: data.medicao ? parseFloat(data.medicao) : null,
        data_abastecimento: data.data_abastecimento,
        tanque_cheio: data.tanque_cheio,
        local_abastecimento: data.local_abastecimento,
        operador: data.operador,
        numero_cupom: data.numero_cupom,
        observacoes: data.observacoes,
      };

      await base44.entities.AbastecimentoMaquina.create(payload);

      if (maquina.tipo_medicao !== 'Nenhum' && data.medicao && parseFloat(data.medicao) > (maquina.medicao_atual || 0)) {
        await base44.entities.Maquina.update(maquina.id, { medicao_atual: parseFloat(data.medicao) });
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
    if (!formData.produto_id) {
      toast.error('Selecione o combustível vinculado');
      return;
    }
    if (!formData.quantidade_litros) {
      toast.error('Informe a quantidade');
      return;
    }
    if (maquina.tipo_medicao !== 'Nenhum' && !formData.medicao) {
      toast.error('Informe a medição atual');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Data *</Label>
          <Input type="date" value={formData.data_abastecimento} onChange={(e) => setFormData({ ...formData, data_abastecimento: e.target.value })} className="h-8 text-xs" required />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Combustível Vinculado *</Label>
          <Select value={formData.produto_id} onValueChange={(v) => {
            const produto = combustiveisVinculados.find((item) => item.produto_id === v);
            setFormData({ ...formData, produto_id: v, produto_nome: produto?.produto_nome || '' });
          }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {combustiveisVinculados.map((c) => <SelectItem key={c.produto_id} value={c.produto_id} className="text-xs">{c.produto_nome}{c.principal ? ' (Principal)' : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Quantidade (L) *</Label>
          <Input type="number" step="0.01" value={formData.quantidade_litros} onChange={(e) => setFormData({ ...formData, quantidade_litros: e.target.value })} className="h-8 text-xs" required />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Valor/Litro (R$)</Label>
          <Input type="number" step="0.01" value={formData.valor_litro} onChange={(e) => setFormData({ ...formData, valor_litro: e.target.value })} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Valor Total</Label>
          <Input value={`R$ ${valorTotal.toFixed(2)}`} readOnly className="h-8 text-xs font-semibold bg-slate-50" />
        </div>
      </div>

      {maquina.tipo_medicao !== 'Nenhum' && (
        <div className="space-y-1">
          <Label className="text-xs">{maquina.tipo_medicao}</Label>
          <Input type="number" value={formData.medicao} onChange={(e) => setFormData({ ...formData, medicao: e.target.value })} className="h-8 text-xs" placeholder={`Atual: ${maquina.medicao_atual || 0}`} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Local</Label>
          <Select value={formData.local_abastecimento} onValueChange={(v) => setFormData({ ...formData, local_abastecimento: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{LOCAIS.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Operador</Label>
          <Input value={formData.operador} onChange={(e) => setFormData({ ...formData, operador: e.target.value })} className="h-8 text-xs" />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox id="tanque_cheio" checked={formData.tanque_cheio} onCheckedChange={(checked) => setFormData({ ...formData, tanque_cheio: checked })} />
        <label htmlFor="tanque_cheio" className="text-xs cursor-pointer">Tanque cheio</label>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Observações</Label>
        <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="text-xs" rows={2} />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
        <Button type="submit" disabled={mutation.isPending} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">{mutation.isPending ? 'Salvando...' : 'Salvar'}</Button>
      </div>
    </form>
  );
}