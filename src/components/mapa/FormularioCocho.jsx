import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import useSetorAreas from "@/hooks/useSetorAreas";

const TIPOS_SUPLEMENTO = ["Sal Mineral", "Proteinado", "Ração", "Núcleo", "Outro"];

export default function FormularioCocho({ coordenadas, item, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const [formData, setFormData] = useState({
    nome_ponto: "",
    tipo: "Sal Mineral",
    produto_padrao: "",
    capacidade_cocho_kg: "",
    setor_id: "",
    area_vinculada_id: "",
    consumo_ideal_por_cabeca_kg: "",
    limite_minimo_consumo: "",
    limite_maximo_consumo: "",
    frequencia_esperada_dias_minimo: "",
    frequencia_esperada_dias_maximo: "7",
    frequencia_esperada_dias: "7",
    alerta_sem_lancamento_dias: "10",
    observacoes: ""
  });

  useEffect(() => {
    if (item) {
      setFormData({
        nome_ponto: item.nome_ponto || "",
        tipo: item.tipo || "Sal Mineral",
        produto_padrao: item.produto_padrao || "",
        capacidade_cocho_kg: item.capacidade_cocho_kg || "",
        area_vinculada_id: item.area_vinculada_id || "",
        consumo_ideal_por_cabeca_kg: item.consumo_ideal_por_cabeca_kg || "",
        limite_minimo_consumo: item.limite_minimo_consumo || "",
        limite_maximo_consumo: item.limite_maximo_consumo || "",
        frequencia_esperada_dias_minimo: item.frequencia_esperada_dias_minimo || "",
        frequencia_esperada_dias_maximo: item.frequencia_esperada_dias_maximo || item.frequencia_esperada_dias || "7",
        frequencia_esperada_dias: item.frequencia_esperada_dias || "7",
        alerta_sem_lancamento_dias: item.alerta_sem_lancamento_dias || "10",
        observacoes: item.observacoes || ""
      });
    }
  }, [item, areas]);

  const areasDoSetor = formData.setor_id ? getAreasBySetor(formData.setor_id) : [];

  useEffect(() => {
    const areaSelecionada = areas.find((area) => area.id === formData.area_vinculada_id);
    if (areaSelecionada && formData.setor_id !== areaSelecionada.setor_id) {
      setFormData((prev) => ({ ...prev, setor_id: areaSelecionada.setor_id || "" }));
    }
  }, [areas, formData.area_vinculada_id, formData.setor_id]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const allPontos = await base44.entities.PontoSuplementacao.list();
      const pontosEmpresa = allPontos.filter(p => p.empresa_id === empresaSelecionadaId);
      const ultimoNumero = pontosEmpresa.length > 0
        ? Math.max(...pontosEmpresa.map(p => parseInt(p.numero_ponto) || 0))
        : 0;
      const novoNumero = String(ultimoNumero + 1).padStart(4, '0');

      return await base44.entities.PontoSuplementacao.create({
        ...data,
        numero_ponto: `COCHO-${novoNumero}`
      });
    },
    onSuccess: () => {
      toast.success('Cocho cadastrado!');
      onSave();
    },
    onError: () => {
      toast.error('Erro ao cadastrar cocho');
    }
  });

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.PontoSuplementacao.update(item.id, data),
    onSuccess: () => {
      toast.success('Cocho atualizado!');
      onSave();
    },
    onError: () => {
      toast.error('Erro ao atualizar cocho');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome_ponto || !formData.setor_id || !formData.area_vinculada_id) {
      toast.error('Preencha nome, setor e área vinculada');
      return;
    }

    const areaVinculada = areas.find(a => a.id === formData.area_vinculada_id);

    const data = {
    empresa_id: empresaSelecionadaId,
    setor_id: formData.setor_id,
    setor_nome: areaVinculada?.setor_nome || setores.find((item) => item.id === formData.setor_id)?.nome || '',
    nome_ponto: formData.nome_ponto,
    tipo: formData.tipo,
    produto_padrao: formData.produto_padrao || null,
    capacidade_cocho_kg: formData.capacidade_cocho_kg ? parseFloat(formData.capacidade_cocho_kg) : null,
    area_vinculada_id: formData.area_vinculada_id,
    area_vinculada_nome: areaVinculada?.nome || '',
    consumo_ideal_por_cabeca_kg: formData.consumo_ideal_por_cabeca_kg ? parseFloat(formData.consumo_ideal_por_cabeca_kg) : null,
    limite_minimo_consumo: formData.limite_minimo_consumo ? parseFloat(formData.limite_minimo_consumo) : null,
    limite_maximo_consumo: formData.limite_maximo_consumo ? parseFloat(formData.limite_maximo_consumo) : null,
    frequencia_esperada_dias_minimo: formData.frequencia_esperada_dias_minimo ? parseInt(formData.frequencia_esperada_dias_minimo) : null,
    frequencia_esperada_dias_maximo: formData.frequencia_esperada_dias_maximo ? parseInt(formData.frequencia_esperada_dias_maximo) : 7,
    frequencia_esperada_dias: formData.frequencia_esperada_dias_maximo ? parseInt(formData.frequencia_esperada_dias_maximo) : 7,
    alerta_sem_lancamento_dias: formData.alerta_sem_lancamento_dias ? parseInt(formData.alerta_sem_lancamento_dias) : 10,
    coordenadas,
    status: 'Ativo',
    observacoes: formData.observacoes || null
    };

    if (item) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <div className="space-y-1">
        <Label className="text-xs">Nome do Cocho *</Label>
        <Input
          value={formData.nome_ponto}
          onChange={(e) => setFormData({ ...formData, nome_ponto: e.target.value })}
          placeholder="Ex: Cocho Pasto 1"
          className="h-9 text-xs"
          required
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Tipo de Suplemento *</Label>
        <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_SUPLEMENTO.map(tipo => (
              <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Setor *</Label>
        <Select value={formData.setor_id || '__none__'} onValueChange={(v) => setFormData({ ...formData, setor_id: v === '__none__' ? '' : v, area_vinculada_id: '' })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Selecione o setor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
            {setores.map(setor => (
              <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Área Vinculada *</Label>
        <Select value={formData.area_vinculada_id || '__none__'} onValueChange={(v) => setFormData({ ...formData, area_vinculada_id: v === '__none__' ? '' : v })} disabled={!formData.setor_id}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder={formData.setor_id ? 'Selecione a área' : 'Selecione o setor primeiro'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
            {areasDoSetor.map(area => (
              <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Produto Padrão</Label>
        <Input
          value={formData.produto_padrao}
          onChange={(e) => setFormData({ ...formData, produto_padrao: e.target.value })}
          placeholder="Ex: Sal Mineral Completo"
          className="h-9 text-xs"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Capacidade do Cocho (kg)</Label>
        <Input
          type="number"
          step="0.01"
          value={formData.capacidade_cocho_kg}
          onChange={(e) => setFormData({ ...formData, capacidade_cocho_kg: e.target.value })}
          className="h-9 text-xs"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Consumo Ideal por Cabeça (kg/dia)</Label>
        <Input
          type="number"
          step="0.01"
          value={formData.consumo_ideal_por_cabeca_kg}
          onChange={(e) => setFormData({ ...formData, consumo_ideal_por_cabeca_kg: e.target.value })}
          className="h-9 text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Limite Mínimo (kg)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.limite_minimo_consumo}
            onChange={(e) => setFormData({ ...formData, limite_minimo_consumo: e.target.value })}
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Limite Máximo (kg)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.limite_maximo_consumo}
            onChange={(e) => setFormData({ ...formData, limite_maximo_consumo: e.target.value })}
            className="h-9 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Frequência mínima (dias)</Label>
          <Input
            type="number"
            value={formData.frequencia_esperada_dias_minimo}
            onChange={(e) => setFormData({ ...formData, frequencia_esperada_dias_minimo: e.target.value })}
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Frequência máxima (dias)</Label>
          <Input
            type="number"
            value={formData.frequencia_esperada_dias_maximo}
            onChange={(e) => setFormData({ ...formData, frequencia_esperada_dias_maximo: e.target.value })}
            className="h-9 text-xs"
          />
        </div>
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

      <div className="space-y-1">
        <Label className="text-xs">Observações</Label>
        <Textarea
          value={formData.observacoes}
          onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
          className="text-xs"
          rows={2}
        />
      </div>

      <div className="flex gap-2 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
          {item ? 'Atualizar' : 'Cadastrar'}
        </Button>
      </div>
    </form>
  );
}