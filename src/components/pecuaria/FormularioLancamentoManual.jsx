import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

import { toast } from "sonner";
import ComboboxComNovo from "./ComboboxComNovo";
import { ordenarPorNomeNumerico } from "@/hooks/useSetorAreas";

const TIPOS_MOVIMENTACAO = [
  { value: "Entrada", label: "Entrada", cor: "bg-green-100 text-green-800" },
  { value: "Saída", label: "Saída", cor: "bg-red-100 text-red-800" },
];

const MOTIVOS_ENTRADA = ["Compra", "Nascimento", "Saldo Inicial", "Inventário", "Ajuste Positivo", "Doação Recebida", "Outros"];
const MOTIVOS_SAIDA = ["Venda", "Morte", "Abate", "Transferência entre Setores", "Mudança de Categoria", "Ajuste Negativo", "Doação", "Perda/Roubo", "Outros"];

const FL = ({ label, required, error, children, className = "" }) => (
  <div className={className}>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

const inputCls = "h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent";
const selectTriggerCls = "h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent";

export default function FormularioLancamentoManual({ item, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [invalidFields, setInvalidFields] = useState([]);

  const [formData, setFormData] = useState({
    tipo: item?.tipo || "",
    data_movimentacao: item?.data_movimentacao?.split('T')[0] || new Date().toISOString().split('T')[0],
    quantidade_animais: item?.quantidade_animais || 1,
    categoria_animal: item?.categoria_animal || "",
    categoria_nova: item?.categoria_nova || "",
    marca: item?.marca || "",
    sexo: item?.sexo || "",
    peso_medio: item?.peso_medio || "",
    peso_total: item?.peso_total || "",
    valor_unitario: item?.valor_unitario || "",
    valor_total: item?.valor_total || "",
    setor_id: item?.setor_id || "",
    setor_origem_id: item?.setor_origem_id || "",
    setor_destino_id: item?.setor_destino_id || "",
    area_origem_id: item?.area_origem_id || "",
    area_destino_id: item?.area_destino_id || "",
    fornecedor_origem: item?.fornecedor_origem || "",
    destino_venda: item?.destino_venda || "",
    nota_fiscal: item?.nota_fiscal || "",
    gta: item?.gta || "",
    motivo: item?.motivo || "",
    causa_morte: item?.causa_morte || "",
    transferencia_origem: item?.transferencia_origem || "",
    transferencia_destino: item?.transferencia_destino || "",
    observacoes: item?.observacoes || "",
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-pastagem', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ['categorias-manejo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter((c) => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: setores = [] } = useQuery({
    queryKey: ['setores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return ordenarPorNomeNumerico(all.filter((s) => s.empresa_id === empresaSelecionadaId && s.ativo !== false));
    },
    enabled: !!empresaSelecionadaId,
  });

  const areasOrdenadas = useMemo(() => ordenarPorNomeNumerico(areas), [areas]);
  const areasDoSetor = useMemo(() => areasOrdenadas.filter((area) => area.setor_id === formData.setor_id), [areasOrdenadas, formData.setor_id]);

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-pecuaria-dados', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list();
      return all.filter((m) => m.empresa_id === empresaSelecionadaId && !m.lote_id && !m.lote);
    },
    enabled: !!empresaSelecionadaId,
  });

  const marcasExistentes = [...new Set(movimentacoes.map((m) => m.marca).filter(Boolean))].sort();
  const fornecedoresExistentes = [...new Set(movimentacoes.map((m) => m.fornecedor_origem).filter(Boolean))].sort();
  const compradoresExistentes = [...new Set(movimentacoes.map((m) => m.destino_venda).filter(Boolean))].sort();
  const causasMorteExistentes = [...new Set(movimentacoes.map((m) => m.causa_morte).filter(Boolean))].sort();

  const saldoPorSetor = useMemo(() => {
    const s = {};
    movimentacoes.forEach((mov) => {
      if (!mov.setor_id) return;
      if (!s[mov.setor_id]) s[mov.setor_id] = 0;
      s[mov.setor_id] += (mov.tipo === "Entrada" ? 1 : -1) * (mov.quantidade_animais || 0);
    });
    return s;
  }, [movimentacoes]);

  const saldoPorSetorCategoria = useMemo(() => {
    const s = {};
    movimentacoes.forEach((mov) => {
      if (!mov.setor_id || !mov.categoria_animal) return;
      const k = `${mov.setor_id}|||${mov.categoria_animal}`;
      if (!s[k]) s[k] = { setorId: mov.setor_id, categoria: mov.categoria_animal, saldo: 0 };
      s[k].saldo += (mov.tipo === "Entrada" ? 1 : -1) * (mov.quantidade_animais || 0);
    });
    return s;
  }, [movimentacoes]);

  const saldoPorSetorCategoriaMarca = useMemo(() => {
    const s = {};
    movimentacoes.forEach((mov) => {
      if (!mov.setor_id || !mov.categoria_animal || !mov.marca) return;
      const k = `${mov.setor_id}|||${mov.categoria_animal}|||${mov.marca}`;
      if (!s[k]) s[k] = { setorId: mov.setor_id, categoria: mov.categoria_animal, marca: mov.marca, saldo: 0 };
      s[k].saldo += (mov.tipo === "Entrada" ? 1 : -1) * (mov.quantidade_animais || 0);
    });
    return s;
  }, [movimentacoes]);

  const categoriasNoSetor = useMemo(() => {
    if (!formData.setor_id) return [];
    return Object.values(saldoPorSetorCategoria)
      .filter((i) => i.setorId === formData.setor_id && i.saldo > 0)
      .map((i) => ({ categoria: i.categoria, saldo: i.saldo }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria));
  }, [saldoPorSetorCategoria, formData.setor_id]);

  const marcasNoSetorCategoria = useMemo(() => {
    if (!formData.setor_id || !formData.categoria_animal) return [];
    return Object.values(saldoPorSetorCategoriaMarca)
      .filter((i) => i.setorId === formData.setor_id && i.categoria === formData.categoria_animal && i.saldo > 0)
      .map((i) => ({ marca: i.marca, saldo: i.saldo }))
      .sort((a, b) => a.marca.localeCompare(b.marca));
  }, [saldoPorSetorCategoriaMarca, formData.setor_id, formData.categoria_animal]);

  useEffect(() => {
    if (formData.peso_medio && formData.quantidade_animais) {
      const pesoTotal = parseFloat(formData.peso_medio) * parseInt(formData.quantidade_animais);
      setFormData((prev) => ({ ...prev, peso_total: pesoTotal.toFixed(2) }));
    }
  }, [formData.peso_medio, formData.quantidade_animais]);

  useEffect(() => {
    if (formData.valor_unitario && formData.quantidade_animais) {
      const valorTotal = parseFloat(formData.valor_unitario) * parseInt(formData.quantidade_animais);
      setFormData((prev) => ({ ...prev, valor_total: valorTotal.toFixed(2) }));
    }
  }, [formData.valor_unitario, formData.quantidade_animais]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const allMovs = await base44.entities.MovimentacaoPecuaria.list();
      const maxNum = allMovs.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);
      const areaOrigem = areas.find((a) => a.id === data.area_origem_id);
      const areaDestino = areas.find((a) => a.id === data.area_destino_id);
      const setor = setores.find((s) => s.id === data.setor_id);
      const setorOrigem = setores.find((s) => s.id === data.setor_origem_id);
      const setorDestino = setores.find((s) => s.id === data.setor_destino_id);

      if (data.motivo === "Transferência entre Setores" && data.setor_origem_id && data.setor_destino_id) {
        const idVinculo = `TS-${Date.now()}`;
        const base = { empresa_id: empresaSelecionadaId, data_movimentacao: `${data.data_movimentacao}T12:00:00`, quantidade_animais: parseInt(data.quantidade_animais) || 1, categoria_animal: data.categoria_animal || null, marca: data.marca || null, sexo: data.sexo || null, peso_medio: parseFloat(data.peso_medio) || null, peso_total: parseFloat(data.peso_total) || null, setor_origem_id: data.setor_origem_id, setor_origem_nome: setorOrigem?.nome || null, setor_destino_id: data.setor_destino_id, setor_destino_nome: setorDestino?.nome || null, nota_fiscal: data.nota_fiscal || null, gta: data.gta || null, motivo: "Transferência entre Setores", transferencia_origem: setorOrigem?.nome || null, transferencia_destino: setorDestino?.nome || null, vinculo_transferencia_setor: idVinculo, observacoes: data.observacoes || null };
        const resSaida = await base44.entities.MovimentacaoPecuaria.create({ ...base, numero_movimentacao: String(maxNum + 1), tipo: "Saída", setor_id: data.setor_origem_id, setor_nome: setorOrigem?.nome || null, area_origem_id: data.area_origem_id || null, area_origem_nome: areaOrigem?.nome || null });
        const resEntrada = await base44.entities.MovimentacaoPecuaria.create({ ...base, numero_movimentacao: String(maxNum + 2), tipo: "Entrada", setor_id: data.setor_destino_id, setor_nome: setorDestino?.nome || null, area_destino_id: data.area_destino_id || null, area_destino_nome: areaDestino?.nome || null });
        return { saida: resSaida, entrada: resEntrada };
      }

      if (data.motivo === "Mudança de Categoria" && data.categoria_nova) {
        const idVinculo = `MC-${Date.now()}`;
        const catNova = categoriasManejo.find((c) => c.nome === data.categoria_nova);
        const base = { empresa_id: empresaSelecionadaId, data_movimentacao: `${data.data_movimentacao}T12:00:00`, quantidade_animais: parseInt(data.quantidade_animais) || 1, marca: data.marca || null, peso_medio: parseFloat(data.peso_medio) || null, peso_total: parseFloat(data.peso_total) || null, setor_id: data.setor_id || null, setor_nome: setor?.nome || null, motivo: "Mudança de Categoria", vinculo_mudanca_categoria: idVinculo, observacoes: data.observacoes || null };
        const resSaida = await base44.entities.MovimentacaoPecuaria.create({ ...base, numero_movimentacao: String(maxNum + 1), tipo: "Saída", categoria_animal: data.categoria_animal || null, categoria_nova: data.categoria_nova || null, sexo: data.sexo || null, area_origem_id: data.area_origem_id || null, area_origem_nome: areaOrigem?.nome || null, transferencia_origem: data.categoria_animal || null, transferencia_destino: data.categoria_nova || null });
        const resEntrada = await base44.entities.MovimentacaoPecuaria.create({ ...base, numero_movimentacao: String(maxNum + 2), tipo: "Entrada", categoria_animal: data.categoria_nova || null, sexo: catNova?.sexo || data.sexo || null, area_destino_id: data.area_destino_id || data.area_origem_id || null, area_destino_nome: areaDestino?.nome || areaOrigem?.nome || null, transferencia_origem: data.categoria_animal || null });
        return { saida: resSaida, entrada: resEntrada };
      }

      const payload = {
        empresa_id: empresaSelecionadaId, numero_movimentacao: String(maxNum + 1), tipo: data.tipo, data_movimentacao: `${data.data_movimentacao}T12:00:00`, quantidade_animais: parseInt(data.quantidade_animais) || 1, categoria_animal: data.categoria_animal || null, categoria_nova: data.categoria_nova || null, marca: data.marca || null, sexo: data.sexo || null, peso_medio: parseFloat(data.peso_medio) || null, peso_total: parseFloat(data.peso_total) || null, valor_unitario: parseFloat(data.valor_unitario) || null, valor_total: parseFloat(data.valor_total) || null, setor_id: data.setor_id || null, setor_nome: setor?.nome || null, area_origem_id: data.area_origem_id || null, area_origem_nome: areaOrigem?.nome || null, area_destino_id: data.area_destino_id || null, area_destino_nome: areaDestino?.nome || null, fornecedor_origem: data.fornecedor_origem || null, destino_venda: data.destino_venda || null, nota_fiscal: data.nota_fiscal || null, gta: data.gta || null, motivo: data.motivo || null, causa_morte: data.causa_morte || null, transferencia_origem: data.transferencia_origem || null, transferencia_destino: data.transferencia_destino || null, observacoes: data.observacoes || null,
      };
      if (item && item.id && !item._isDuplicate) return base44.entities.MovimentacaoPecuaria.update(item.id, payload);
      return base44.entities.MovimentacaoPecuaria.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria-dados'] });
      toast.success(item ? 'Movimentação atualizada!' : 'Movimentação registrada!');
      onSave();
    },
    onError: () => toast.error('Erro ao salvar movimentação'),
  });

  const isInvalid = (field) => invalidFields.includes(field);
  const flCls = (field) => isInvalid(field) ? "border-red-500 bg-red-50" : "";

  const handleSubmit = (e) => {
    e.preventDefault();
    const missing = [];
    if (formData.motivo !== "Transferência entre Setores" && !formData.setor_id) missing.push('setor_id');
    if (!formData.tipo) missing.push('tipo');
    if (!formData.motivo) missing.push('motivo');
    if (!formData.data_movimentacao) missing.push('data_movimentacao');
    if (!formData.quantidade_animais || formData.quantidade_animais < 1) missing.push('quantidade_animais');
    if (!formData.categoria_animal) missing.push('categoria_animal');
    if (!formData.marca) missing.push('marca');
    if (formData.motivo === "Mudança de Categoria" && !formData.categoria_nova) missing.push('categoria_nova');
    if (formData.motivo === "Transferência entre Setores" && !formData.setor_origem_id) missing.push('setor_origem_id');
    if (formData.motivo === "Transferência entre Setores" && !formData.setor_destino_id) missing.push('setor_destino_id');

    if (missing.length > 0) {
      setInvalidFields(missing);
      toast.error('PREENCHA OS CAMPOS OBRIGATÓRIOS.');
      return;
    }

    if (formData.tipo === "Saída" || formData.motivo === "Mudança de Categoria") {
      const qtd = parseInt(formData.quantidade_animais) || 0;
      const chave = `${formData.setor_id}|||${formData.categoria_animal}|||${formData.marca}`;
      const saldo = saldoPorSetorCategoriaMarca[chave]?.saldo || 0;
      if (qtd > saldo) {
        const setorNome = setores.find((s) => s.id === formData.setor_id)?.nome || 'selecionado';
        toast.error(`Saldo insuficiente! No setor "${setorNome}", marca "${formData.marca}" categoria "${formData.categoria_animal}" possui apenas ${saldo} cabeça(s).`);
        return;
      }
    }

    setInvalidFields([]);
    createMutation.mutate(formData);
  };

  const clearInvalid = (field) => setInvalidFields((p) => p.filter((f) => f !== field));

  return (
    <Card className="shadow-sm border-slate-300 mt-4">
      <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
        <CardTitle className="text-sm font-semibold text-slate-900">
          {item ? 'Editar Movimentação' : 'Novo Lançamento Manual'}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-1" style={{ maxHeight: 'calc(100vh - 170px)', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent" }}>
        <form onSubmit={handleSubmit} className="space-y-0.5">

          {/* Setor */}
          {formData.motivo !== "Transferência entre Setores" && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
              <FL label="Setor / Fazenda" required error={isInvalid('setor_id')} className="lg:col-span-3">
                <Select value={formData.setor_id} onValueChange={(v) => { setFormData({ ...formData, setor_id: v, categoria_animal: "", marca: "", area_origem_id: "", area_destino_id: "" }); clearInvalid('setor_id'); }}>
                  <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="SELECIONE O SETOR PRIMEIRO" /></SelectTrigger>
                  <SelectContent>
                    {setores.length > 0 ? setores.map((setor) => {
                      const saldo = saldoPorSetor[setor.id] || 0;
                      return (
                        <SelectItem key={setor.id} value={setor.id} className="text-xs uppercase">
                          {setor.sigla ? `${setor.sigla} - ` : ''}{setor.nome} ({setor.tipo}) {saldo} CAB
                        </SelectItem>
                      );
                    }) : <SelectItem value={null} disabled className="text-xs uppercase text-slate-500">CADASTRE SETORES PRIMEIRO</SelectItem>}
                  </SelectContent>
                </Select>
              </FL>
              <div>
                <label className="text-[12px] text-slate-500 pl-1 leading-none">Saldo no Setor</label>
                <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors h-[38px] px-3 flex items-center">
                  <span className="text-sm font-bold text-emerald-700">{formData.setor_id ? `${saldoPorSetor[formData.setor_id] || 0} CAB` : '--'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Tipo, Motivo, Data, Qtd, Peso */}
          <div className="grid grid-cols-1 lg:grid-cols-6 gap-1">
            <FL label="Tipo" required error={isInvalid('tipo')}>
              <Select value={formData.tipo} onValueChange={(v) => { setFormData({ ...formData, tipo: v, motivo: "" }); clearInvalid('tipo'); }}>
                <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                <SelectContent>
                  {TIPOS_MOVIMENTACAO.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs uppercase">{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FL>

            <FL label="Motivo" required error={isInvalid('motivo')}>
              <Select value={formData.motivo} onValueChange={(v) => {
                if (v === "Transferência entre Setores" && formData.setor_id) setFormData({ ...formData, motivo: v, setor_origem_id: formData.setor_id });
                else setFormData({ ...formData, motivo: v });
                clearInvalid('motivo');
              }}>
                <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                <SelectContent>
                  {formData.tipo === "Entrada" ? [...MOTIVOS_ENTRADA, ...(formData.motivo && !MOTIVOS_ENTRADA.includes(formData.motivo) ? [formData.motivo] : [])].map((m) => <SelectItem key={m} value={m} className="text-xs uppercase">{m}</SelectItem>) :
                   formData.tipo === "Saída" ? [...MOTIVOS_SAIDA, ...(formData.motivo && !MOTIVOS_SAIDA.includes(formData.motivo) ? [formData.motivo] : [])].map((m) => <SelectItem key={m} value={m} className="text-xs uppercase">{m}</SelectItem>) :
                   <SelectItem value={null} disabled className="text-xs uppercase">Selecione o tipo primeiro</SelectItem>}
                </SelectContent>
              </Select>
            </FL>

            <FL label="Data" required error={isInvalid('data_movimentacao')}>
              <Input type="date" value={formData.data_movimentacao} onChange={(e) => { setFormData({ ...formData, data_movimentacao: e.target.value }); clearInvalid('data_movimentacao'); }} className={inputCls} />
            </FL>

            <FL label="Qtd Animais" required error={isInvalid('quantidade_animais')}>
              <Input type="number" min="1" value={formData.quantidade_animais} onChange={(e) => { setFormData({ ...formData, quantidade_animais: e.target.value }); clearInvalid('quantidade_animais'); }} className={inputCls} />
            </FL>

            <FL label="Peso Médio (kg)">
              <Input type="number" step="0.1" value={formData.peso_medio} onChange={(e) => setFormData({ ...formData, peso_medio: e.target.value })} className={inputCls} placeholder="0" />
            </FL>

            <FL label="Peso Total">
              <Input type="number" step="0.1" value={formData.peso_total} readOnly className={`${inputCls} bg-slate-50`} />
            </FL>
          </div>

          {/* Categoria, Marca, Sexo, Área (não mudança de categoria) */}
          {formData.motivo !== "Mudança de Categoria" && (
            <div className={`grid grid-cols-1 ${formData.tipo === "Entrada" ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-1`}>
              <FL label="Categoria" required error={isInvalid('categoria_animal')}>
                {formData.tipo === "Saída" ? (
                  <Select value={formData.categoria_animal} onValueChange={(v) => { const cat = categoriasManejo.find((c) => c.nome === v); setFormData({ ...formData, categoria_animal: v, marca: "", sexo: cat?.sexo || "" }); clearInvalid('categoria_animal'); }} disabled={!formData.setor_id && formData.motivo !== "Transferência entre Setores"}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder={formData.setor_id ? "SELECIONE" : "SELECIONE SETOR PRIMEIRO"} /></SelectTrigger>
                    <SelectContent>
                      {categoriasNoSetor.length > 0 ? categoriasNoSetor.map((i) => (
                        <SelectItem key={i.categoria} value={i.categoria} className="text-xs uppercase">{i.categoria} ({i.saldo} cab)</SelectItem>
                      )) : <SelectItem value={null} disabled className="text-xs text-slate-500">{formData.setor_id ? "Nenhuma categoria com saldo" : "Selecione setor primeiro"}</SelectItem>}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={formData.categoria_animal} onValueChange={(v) => { const cat = categoriasManejo.find((c) => c.nome === v); setFormData({ ...formData, categoria_animal: v, sexo: cat?.sexo || formData.sexo }); clearInvalid('categoria_animal'); }} disabled={!formData.setor_id && formData.motivo !== "Transferência entre Setores"}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder={formData.setor_id ? "SELECIONE" : "SELECIONE SETOR PRIMEIRO"} /></SelectTrigger>
                    <SelectContent>
                      {categoriasManejo.length > 0 ? categoriasManejo.map((cat) => <SelectItem key={cat.id} value={cat.nome} className="text-xs uppercase">{cat.nome} {cat.sexo ? `(${cat.sexo})` : ''}</SelectItem>) : <SelectItem value={null} disabled className="text-xs text-slate-500">Cadastre categorias primeiro</SelectItem>}
                    </SelectContent>
                  </Select>
                )}
              </FL>

              {formData.tipo === "Saída" && (
                <FL label="Marca" required error={isInvalid('marca')}>
                  <Select value={formData.marca} onValueChange={(v) => { setFormData({ ...formData, marca: v }); clearInvalid('marca'); }} disabled={!formData.categoria_animal || !formData.setor_id}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder={formData.categoria_animal ? "SELECIONE" : "SELECIONE CATEGORIA PRIMEIRO"} /></SelectTrigger>
                    <SelectContent>
                      {marcasNoSetorCategoria.length > 0 ? marcasNoSetorCategoria.map((i) => <SelectItem key={i.marca} value={i.marca} className="text-xs uppercase">{i.marca} ({i.saldo} cab)</SelectItem>) : <SelectItem value={null} disabled className="text-xs text-slate-500">{formData.categoria_animal ? "Nenhuma marca com saldo" : "Selecione categoria"}</SelectItem>}
                    </SelectContent>
                  </Select>
                </FL>
              )}

              {formData.tipo === "Entrada" && (
                <>
                  <FL label="Marca" required error={isInvalid('marca')}>
                    <ComboboxComNovo value={formData.marca} onChange={(v) => { setFormData({ ...formData, marca: v }); clearInvalid('marca'); }} options={marcasExistentes} placeholder="SELECIONE OU DIGITE..." inputClassName="h-7 text-xs pr-2 uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" hideIcons disabled={!formData.setor_id} />
                  </FL>
                  <FL label="Sexo">
                    <Input value={formData.sexo || ""} readOnly disabled className={`${inputCls} bg-slate-50 cursor-not-allowed`} placeholder="DEFINIDO PELA CATEGORIA" />
                  </FL>
                </>
              )}

              <FL label="Área">
                <Select value={formData.tipo === "Entrada" ? formData.area_destino_id : formData.area_origem_id} onValueChange={(v) => { if (formData.tipo === "Entrada") setFormData({ ...formData, area_destino_id: v }); else setFormData({ ...formData, area_origem_id: v }); }} disabled={!formData.setor_id && formData.motivo !== "Transferência entre Setores"}>
                  <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    {areas.map((area) => <SelectItem key={area.id} value={area.id} className="text-xs uppercase">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
            </div>
          )}

          {/* Mudança de Categoria */}
          {formData.motivo === "Mudança de Categoria" && (
            <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
              <span className="font-semibold text-xs text-slate-700">Mudança de Categoria</span>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                <FL label="Categoria Atual (De)" required className={flCls('categoria_animal')}>
                  <Select value={formData.categoria_animal} onValueChange={(v) => { setFormData({ ...formData, categoria_animal: v, marca: "" }); clearInvalid('categoria_animal'); }} disabled={!formData.setor_id}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder={formData.setor_id ? "DE QUAL CATEGORIA?" : "SELECIONE SETOR PRIMEIRO"} /></SelectTrigger>
                    <SelectContent>
                      {categoriasNoSetor.length > 0 ? categoriasNoSetor.map((i) => <SelectItem key={i.categoria} value={i.categoria} className="text-xs uppercase">{i.categoria} ({i.saldo} cab)</SelectItem>) : <SelectItem value={null} disabled className="text-xs text-slate-500">{formData.setor_id ? "Nenhuma categoria com saldo" : "Selecione setor"}</SelectItem>}
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Marca" required error={isInvalid('marca')}>
                  <Select value={formData.marca} onValueChange={(v) => { setFormData({ ...formData, marca: v }); clearInvalid('marca'); }} disabled={!formData.categoria_animal || !formData.setor_id}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder={formData.categoria_animal ? "SELECIONE" : "SELECIONE CATEGORIA PRIMEIRO"} /></SelectTrigger>
                    <SelectContent>
                      {marcasNoSetorCategoria.length > 0 ? marcasNoSetorCategoria.map((i) => <SelectItem key={i.marca} value={i.marca} className="text-xs uppercase">{i.marca} ({i.saldo} cab)</SelectItem>) : <SelectItem value={null} disabled className="text-xs text-slate-500">{formData.categoria_animal ? "Nenhuma marca com saldo" : "Selecione categoria"}</SelectItem>}
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Área">
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })} disabled={!formData.setor_id}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>
                      {areasDoSetor.map((area) => <SelectItem key={area.id} value={area.id} className="text-xs uppercase">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FL>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
                <FL label="Nova Categoria (Para)" required error={isInvalid('categoria_nova')}>
                  <Select value={formData.categoria_nova} onValueChange={(v) => { setFormData({ ...formData, categoria_nova: v }); clearInvalid('categoria_nova'); }}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="PARA QUAL CATEGORIA?" /></SelectTrigger>
                    <SelectContent>
                      {categoriasManejo.filter((c) => c.nome !== formData.categoria_animal).map((cat) => <SelectItem key={cat.id} value={cat.nome} className="text-xs uppercase">{cat.nome} {cat.sexo ? `(${cat.sexo})` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FL>
              </div>
            </div>
          )}

          {/* Compra/Venda */}
          {(formData.motivo === "Compra" || formData.motivo === "Venda") && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-1">
              <FL label={formData.tipo === "Entrada" ? "Fornecedor" : "Comprador"}>
                <ComboboxComNovo value={formData.tipo === "Entrada" ? formData.fornecedor_origem : formData.destino_venda} onChange={(v) => { if (formData.tipo === "Entrada") setFormData({ ...formData, fornecedor_origem: v }); else setFormData({ ...formData, destino_venda: v }); }} options={formData.tipo === "Entrada" ? fornecedoresExistentes : compradoresExistentes} placeholder="SELECIONE OU DIGITE..." inputClassName="h-7 text-xs pr-2 uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" hideIcons />
              </FL>
              <FL label="Vlr Unit. (R$)">
                <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className={inputCls} placeholder="0,00" />
              </FL>
              <FL label="Vlr Total">
                <Input type="number" value={formData.valor_total} readOnly className={`${inputCls} bg-slate-50`} />
              </FL>
              <FL label="Nota Fiscal">
                <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className={inputCls} placeholder="Nº" />
              </FL>
              <FL label="GTA">
                <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className={inputCls} placeholder="Nº" />
              </FL>
            </div>
          )}

          {/* Abate */}
          {formData.motivo === "Abate" && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-1">
              <FL label="Comprador/Frigorífico">
                <ComboboxComNovo value={formData.destino_venda} onChange={(v) => setFormData({ ...formData, destino_venda: v })} options={compradoresExistentes} placeholder="SELECIONE OU DIGITE..." inputClassName="h-7 text-xs pr-2 uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" hideIcons />
              </FL>
              <FL label="Vlr/@ (R$)">
                <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className={inputCls} />
              </FL>
              <FL label="Vlr Total">
                <Input type="number" value={formData.valor_total} readOnly className={`${inputCls} bg-slate-50`} />
              </FL>
              <FL label="Nota Fiscal">
                <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className={inputCls} placeholder="Nº" />
              </FL>
              <FL label="GTA">
                <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className={inputCls} placeholder="Nº" />
              </FL>
            </div>
          )}

          {/* Transferência entre Setores */}
          {formData.motivo === "Transferência entre Setores" && (
            <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
              <span className="font-semibold text-xs text-slate-700">Transferência entre Setores/Fazendas</span>
              <p className="text-[11px] text-slate-500">Cria saída + entrada automaticamente.</p>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
                <FL label="Setor de Origem" required error={isInvalid('setor_origem_id')}>
                  <Select value={formData.setor_origem_id} onValueChange={(v) => { setFormData({ ...formData, setor_origem_id: v }); clearInvalid('setor_origem_id'); }}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="DE ONDE SAI" /></SelectTrigger>
                    <SelectContent>
                      {setores.map((setor) => {
                        const saldo = saldoPorSetor[setor.id] || 0;
                        return <SelectItem key={setor.id} value={setor.id} className="text-xs uppercase" disabled={saldo <= 0}>{setor.sigla ? `${setor.sigla} - ` : ''}{setor.nome} ({saldo} cab)</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Setor de Destino" required error={isInvalid('setor_destino_id')}>
                  <Select value={formData.setor_destino_id} onValueChange={(v) => { setFormData({ ...formData, setor_destino_id: v }); clearInvalid('setor_destino_id'); }}>
                    <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="PARA ONDE VAI" /></SelectTrigger>
                    <SelectContent>
                      {setores.filter((s) => s.id !== formData.setor_origem_id).map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs uppercase">{setor.sigla ? `${setor.sigla} - ` : ''}{setor.nome} ({setor.tipo})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Nota Fiscal">
                  <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className={inputCls} placeholder="Nº" />
                </FL>
                <FL label="GTA">
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className={inputCls} placeholder="Nº" />
                </FL>
              </div>
            </div>
          )}

          {/* Morte */}
          {formData.motivo === "Morte" && (
            <div className="grid grid-cols-1 gap-2">
              <FL label="Causa da Morte">
                <ComboboxComNovo value={formData.causa_morte} onChange={(v) => setFormData({ ...formData, causa_morte: v })} options={causasMorteExistentes} placeholder="SELECIONE OU DIGITE A CAUSA..." inputClassName="h-7 text-xs pr-2 uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" hideIcons />
              </FL>
            </div>
          )}

          {/* Observações */}
          <FL label="Observações">
            <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent resize-y" style={{ textTransform: "uppercase" }} placeholder="OBSERVAÇÕES ADICIONAIS..." rows={2} />
          </FL>

          {/* Botões */}
          <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Salvando...' : item ? 'Atualizar' : 'Salvar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}