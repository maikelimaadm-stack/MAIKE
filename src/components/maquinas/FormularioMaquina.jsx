import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const TIPOS = ["Trator", "Colheitadeira", "Plantadeira", "Pulverizador", "Caminhão", "Pickup", "Motocicleta", "Implemento", "Outro"];
const COMBUSTIVEIS = ["Diesel", "Gasolina", "Etanol", "Flex", "Elétrico", "Não Aplicável"];

export default function FormularioMaquina({ maquina, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [formData, setFormData] = useState({
    codigo: maquina?.codigo || '',
    nome: maquina?.nome || '',
    tipo: maquina?.tipo || '',
    marca: maquina?.marca || '',
    modelo: maquina?.modelo || '',
    ano_fabricacao: maquina?.ano_fabricacao || '',
    placa: maquina?.placa || '',
    chassi: maquina?.chassi || '',
    renavam: maquina?.renavam || '',
    potencia_cv: maquina?.potencia_cv || '',
    horimetro_atual: maquina?.horimetro_atual || '',
    hodometro_atual: maquina?.hodometro_atual || '',
    data_aquisicao: maquina?.data_aquisicao || '',
    valor_aquisicao: maquina?.valor_aquisicao || '',
    valor_atual: maquina?.valor_atual || '',
    consumo_medio: maquina?.consumo_medio || '',
    tipo_combustivel: maquina?.tipo_combustivel || '',
    capacidade_tanque: maquina?.capacidade_tanque || '',
    status: maquina?.status || 'Ativo',
    localizacao_atual: maquina?.localizacao_atual || '',
    observacoes: maquina?.observacoes || '',
  });

  const mutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
        empresa_id: empresaSelecionadaId,
        ano_fabricacao: data.ano_fabricacao ? parseInt(data.ano_fabricacao) : null,
        potencia_cv: data.potencia_cv ? parseFloat(data.potencia_cv) : null,
        horimetro_atual: data.horimetro_atual ? parseFloat(data.horimetro_atual) : null,
        hodometro_atual: data.hodometro_atual ? parseFloat(data.hodometro_atual) : null,
        valor_aquisicao: data.valor_aquisicao ? parseFloat(data.valor_aquisicao) : null,
        valor_atual: data.valor_atual ? parseFloat(data.valor_atual) : null,
        consumo_medio: data.consumo_medio ? parseFloat(data.consumo_medio) : null,
        capacidade_tanque: data.capacidade_tanque ? parseFloat(data.capacidade_tanque) : null,
      };

      if (maquina) {
        return base44.entities.Maquina.update(maquina.id, payload);
      }
      return base44.entities.Maquina.create(payload);
    },
    onSuccess: () => {
      toast.success(maquina ? 'Máquina atualizada!' : 'Máquina cadastrada!');
      onSave();
    },
    onError: (error) => {
      toast.error('Erro: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome || !formData.tipo) {
      toast.error('Preencha nome e tipo');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs">Código</Label>
          <Input
            value={formData.codigo}
            onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
            className="h-9"
            placeholder="EX: TRT001"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Nome *</Label>
          <Input
            value={formData.nome}
            onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
            className="h-9"
            placeholder="Nome da máquina"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs">Tipo *</Label>
          <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Marca</Label>
          <Input
            value={formData.marca}
            onChange={(e) => setFormData({ ...formData, marca: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Modelo</Label>
          <Input
            value={formData.modelo}
            onChange={(e) => setFormData({ ...formData, modelo: e.target.value })}
            className="h-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs">Ano Fabricação</Label>
          <Input
            type="number"
            value={formData.ano_fabricacao}
            onChange={(e) => setFormData({ ...formData, ano_fabricacao: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Placa</Label>
          <Input
            value={formData.placa}
            onChange={(e) => setFormData({ ...formData, placa: e.target.value.toUpperCase() })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Potência (CV)</Label>
          <Input
            type="number"
            value={formData.potencia_cv}
            onChange={(e) => setFormData({ ...formData, potencia_cv: e.target.value })}
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
              <SelectItem value="Ativo">Ativo</SelectItem>
              <SelectItem value="Em Manutenção">Em Manutenção</SelectItem>
              <SelectItem value="Inativo">Inativo</SelectItem>
              <SelectItem value="Vendido">Vendido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs">Horímetro Atual</Label>
          <Input
            type="number"
            value={formData.horimetro_atual}
            onChange={(e) => setFormData({ ...formData, horimetro_atual: e.target.value })}
            className="h-9"
            placeholder="Horas"
          />
        </div>
        <div>
          <Label className="text-xs">Hodômetro Atual</Label>
          <Input
            type="number"
            value={formData.hodometro_atual}
            onChange={(e) => setFormData({ ...formData, hodometro_atual: e.target.value })}
            className="h-9"
            placeholder="Km"
          />
        </div>
        <div>
          <Label className="text-xs">Combustível</Label>
          <Select value={formData.tipo_combustivel} onValueChange={(v) => setFormData({ ...formData, tipo_combustivel: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {COMBUSTIVEIS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Capacidade Tanque (L)</Label>
          <Input
            type="number"
            value={formData.capacidade_tanque}
            onChange={(e) => setFormData({ ...formData, capacidade_tanque: e.target.value })}
            className="h-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs">Data Aquisição</Label>
          <Input
            type="date"
            value={formData.data_aquisicao}
            onChange={(e) => setFormData({ ...formData, data_aquisicao: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Valor Aquisição (R$)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.valor_aquisicao}
            onChange={(e) => setFormData({ ...formData, valor_aquisicao: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Valor Atual (R$)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.valor_atual}
            onChange={(e) => setFormData({ ...formData, valor_atual: e.target.value })}
            className="h-9"
          />
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