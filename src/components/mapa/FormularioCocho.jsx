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

const TIPOS_SUPLEMENTO = ["Sal Mineral", "Proteinado", "Ração", "Núcleo", "Outro"];

export default function FormularioCocho({ coordenadas, item, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const { data: depositos = [] } = useQuery({
    queryKey: ["depositos-supl", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.categoria_ponto === "DEPOSITO" && p.status !== "Inativo");
    },
    enabled: !!empresaSelecionadaId,
  });

  const [formData, setFormData] = useState({
    nome_ponto: "",
    tipo: "Sal Mineral",
    produto_padrao: "",
    capacidade_cocho_kg: "",
    setor_id: "",
    area_vinculada_id: "",
    deposito_origem_id: "",
    consumo_ideal_por_cabeca_kg: "",
    limite_minimo_consumo: "",
    limite_maximo_consumo: "",
    dias_alerta_reposicao: "3",
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
        deposito_origem_id: item.deposito_origem_id || "",
        consumo_ideal_por_cabeca_kg: item.consumo_ideal_por_cabeca_kg || "",
        limite_minimo_consumo: item.limite_minimo_consumo || "",
        limite_maximo_consumo: item.limite_maximo_consumo || "",
        dias_alerta_reposicao: item.dias_alerta_reposicao || "3",
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
    const depositoSelecionado = depositos.find(d => d.id === formData.deposito_origem_id);

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
    deposito_origem_id: formData.deposito_origem_id || null,
    deposito_origem_nome: depositoSelecionado?.nome_ponto || null,
    local_estoque_id: depositoSelecionado?.local_estoque_id || null,
    local_estoque_nome: depositoSelecionado?.local_estoque_nome || null,
    consumo_ideal_por_cabeca_kg: formData.consumo_ideal_por_cabeca_kg ? parseFloat(formData.consumo_ideal_por_cabeca_kg) : null,
    limite_minimo_consumo: formData.limite_minimo_consumo ? parseFloat(formData.limite_minimo_consumo) : null,
    limite_maximo_consumo: formData.limite_maximo_consumo ? parseFloat(formData.limite_maximo_consumo) : null,
    dias_alerta_reposicao: formData.dias_alerta_reposicao ? parseInt(formData.dias_alerta_reposicao) : 3,
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
    <form onSubmit={handleSubmit} className="space-y-0.5 mt-2">
      <FL label="Nome do Cocho" required>
        <Input value={formData.nome_ponto} onChange={(e) => setFormData({ ...formData, nome_ponto: e.target.value })} placeholder="Ex: Cocho Pasto 1" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" required />
      </FL>
      <FL label="Tipo de Suplemento" required>
        <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
          <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
          <SelectContent>{TIPOS_SUPLEMENTO.map(tipo => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent>
        </Select>
      </FL>
      <FL label="Setor" required>
        <Select value={formData.setor_id || '__none__'} onValueChange={(v) => setFormData({ ...formData, setor_id: v === '__none__' ? '' : v, area_vinculada_id: '' })}>
          <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
          <SelectContent><SelectItem value="__none__" className="text-xs">Selecione</SelectItem>{setores.map(setor => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}</SelectContent>
        </Select>
      </FL>
      <FL label="Área Vinculada" required>
        <Select value={formData.area_vinculada_id || '__none__'} onValueChange={(v) => setFormData({ ...formData, area_vinculada_id: v === '__none__' ? '' : v })} disabled={!formData.setor_id}>
          <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder={formData.setor_id ? 'Selecione a área' : 'Selecione o setor primeiro'} /></SelectTrigger>
          <SelectContent><SelectItem value="__none__" className="text-xs">Selecione</SelectItem>{areasDoSetor.map(area => <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>)}</SelectContent>
        </Select>
      </FL>
      <FL label="Depósito Vinculado">
        <Select value={formData.deposito_origem_id || '__none__'} onValueChange={(v) => setFormData({ ...formData, deposito_origem_id: v === '__none__' ? '' : v })}>
          <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o depósito" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">Nenhum</SelectItem>
            {depositos.map(dep => <SelectItem key={dep.id} value={dep.id} className="text-xs">{dep.nome_ponto}</SelectItem>)}
          </SelectContent>
        </Select>
      </FL>
      <FL label="Produto Padrão"><Input value={formData.produto_padrao} onChange={(e) => setFormData({ ...formData, produto_padrao: e.target.value })} placeholder="Ex: Sal Mineral Completo" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
      <FL label="Capacidade do Cocho (kg)"><Input type="number" step="0.01" value={formData.capacidade_cocho_kg} onChange={(e) => setFormData({ ...formData, capacidade_cocho_kg: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
      <FL label="Consumo Ideal por Cabeça (kg/dia)"><Input type="number" step="0.01" value={formData.consumo_ideal_por_cabeca_kg} onChange={(e) => setFormData({ ...formData, consumo_ideal_por_cabeca_kg: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
      <div className="grid grid-cols-2 gap-1">
        <FL label="Limite Mínimo (kg)"><Input type="number" step="0.01" value={formData.limite_minimo_consumo} onChange={(e) => setFormData({ ...formData, limite_minimo_consumo: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
        <FL label="Limite Máximo (kg)"><Input type="number" step="0.01" value={formData.limite_maximo_consumo} onChange={(e) => setFormData({ ...formData, limite_maximo_consumo: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
      </div>
      <FL label="Dias de Alerta para Reposição"><Input type="number" value={formData.dias_alerta_reposicao} onChange={(e) => setFormData({ ...formData, dias_alerta_reposicao: e.target.value })} placeholder="3" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
      <FL label="Alerta sem Lançamento (dias)"><Input type="number" value={formData.alerta_sem_lancamento_dias} onChange={(e) => setFormData({ ...formData, alerta_sem_lancamento_dias: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
      <FL label="Observações"><Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" rows={2} /></FL>
      <div className="flex gap-1 pt-1 border-t">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
        <Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">{item ? 'Atualizar' : 'Cadastrar'}</Button>
      </div>
    </form>
  );
}