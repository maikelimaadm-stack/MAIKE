import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { MANEJO_TIPOS, MANEJO_TIPO_LABELS } from "./manejoOptions";

export default function ManejoTecnicoForm({ lotes, loteInicialId, responsavelPadrao, onSaved }) {
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    data_evento: new Date().toISOString().split('T')[0],
    tipo_evento: "SANITARIO",
    subtipo_manejo: MANEJO_TIPOS.SANITARIO[0],
    lote_id: loteInicialId || "",
    quantidade_animais: "",
    responsavel: responsavelPadrao || "",
    observacoes: "",
    produto_utilizado: "",
    dose: "",
    via_aplicacao: "",
    duracao_tratamento: "",
    lote_tratado: "",
    quantidade_tratada: "",
    peso_medio_atual: "",
    produto: "",
    quantidade_fornecida: "",
    unidade: "kg",
    frequencia: "",
    matriz: "",
    reprodutor: "",
    resultado_diagnostico: "",
    escala_avaliacao: "",
    resultado: ""
  });

  useEffect(() => {
    if (loteInicialId) {
      setForm((prev) => ({ ...prev, lote_id: loteInicialId }));
    }
  }, [loteInicialId]);

  useEffect(() => {
    if (responsavelPadrao) {
      setForm((prev) => ({ ...prev, responsavel: prev.responsavel || responsavelPadrao }));
    }
  }, [responsavelPadrao]);

  const loteSelecionado = useMemo(
    () => lotes.find((lote) => lote.id === form.lote_id),
    [lotes, form.lote_id]
  );

  useEffect(() => {
    if (loteSelecionado && !form.quantidade_animais) {
      setForm((prev) => ({ ...prev, quantidade_animais: String(loteSelecionado.quantidade_cabecas || "") }));
    }
  }, [loteSelecionado, form.quantidade_animais]);

  const subtipos = MANEJO_TIPOS[form.tipo_evento] || [];

  const handleTipoChange = (tipo) => {
    setForm((prev) => ({
      ...prev,
      tipo_evento: tipo,
      subtipo_manejo: MANEJO_TIPOS[tipo][0]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (salvando || !loteSelecionado) return;

    setSalvando(true);

    const payload = {
      empresa_id: loteSelecionado.empresa_id,
      data_evento: form.data_evento,
      tipo_evento: form.tipo_evento,
      subtipo_manejo: form.subtipo_manejo,
      lote_id: loteSelecionado.id,
      nome_lote: loteSelecionado.nome,
      categoria: loteSelecionado.categoria,
      sexo: loteSelecionado.sexo,
      quantidade_animais: parseFloat(form.quantidade_animais || loteSelecionado.quantidade_cabecas || 0),
      area_id: loteSelecionado.area_atual_id,
      nome_area: loteSelecionado.area_atual_nome,
      responsavel: form.responsavel,
      observacoes: form.observacoes,
      produto_utilizado: form.produto_utilizado || null,
      dose: form.dose || null,
      via_aplicacao: form.via_aplicacao || null,
      duracao_tratamento: form.duracao_tratamento || null,
      lote_tratado: form.lote_tratado || null,
      quantidade_tratada: form.quantidade_tratada ? parseFloat(form.quantidade_tratada) : null,
      produto: form.produto || null,
      quantidade_fornecida: form.quantidade_fornecida ? parseFloat(form.quantidade_fornecida) : null,
      unidade: form.unidade || null,
      frequencia: form.frequencia || null,
      matriz: form.matriz || null,
      reprodutor: form.reprodutor || null,
      resultado_diagnostico: form.resultado_diagnostico || null,
      escala_avaliacao: form.escala_avaliacao || null,
      resultado: form.resultado || null
    };

    if (form.tipo_evento === "PESAGEM") {
      const [manejos, movimentacoes] = await Promise.all([
        base44.entities.ManejoTecnicoRebanho.list('-data_evento'),
        base44.entities.MovimentacaoMapa.list('-data_movimentacao')
      ]);

      const dataAtual = new Date(form.data_evento).getTime();
      const pesagensManejo = manejos
        .filter((item) => item.lote_id === loteSelecionado.id && item.tipo_evento === "PESAGEM")
        .map((item) => ({ data: item.data_evento, peso: item.peso_medio_atual }));
      const pesagensMapa = movimentacoes
        .filter((item) => item.tipo === 'Pesagem' && (item.lote_id === loteSelecionado.id || item.lote === loteSelecionado.nome))
        .map((item) => ({ data: item.data_movimentacao, peso: item.peso_medio }));
      const pesagensAnteriores = [...pesagensManejo, ...pesagensMapa]
        .filter((item) => item.peso !== null && item.peso !== undefined)
        .filter((item) => new Date(item.data).getTime() < dataAtual)
        .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

      const anterior = pesagensAnteriores[0];
      const pesoAtual = parseFloat(form.peso_medio_atual || 0);
      const pesoAnterior = anterior ? parseFloat(anterior.peso || 0) : null;
      const ganhoPeso = pesoAnterior !== null ? pesoAtual - pesoAnterior : null;
      const dias = anterior ? Math.max(1, Math.round((dataAtual - new Date(anterior.data).getTime()) / 86400000)) : null;

      payload.peso_medio_anterior = pesoAnterior;
      payload.peso_medio_atual = pesoAtual;
      payload.ganho_peso = ganhoPeso;
      payload.gmd_calculado = ganhoPeso !== null && dias ? ganhoPeso / dias : null;

      await base44.entities.Lote.update(loteSelecionado.id, {
        peso_medio_kg: pesoAtual
      });
    }

    await base44.entities.ManejoTecnicoRebanho.create(payload);
    setSalvando(false);
    setForm((prev) => ({
      ...prev,
      observacoes: "",
      produto_utilizado: "",
      dose: "",
      via_aplicacao: "",
      duracao_tratamento: "",
      lote_tratado: "",
      quantidade_tratada: "",
      peso_medio_atual: "",
      produto: "",
      quantidade_fornecida: "",
      frequencia: "",
      matriz: "",
      reprodutor: "",
      resultado_diagnostico: "",
      escala_avaliacao: "",
      resultado: ""
    }));
    onSaved();
  };

  return (
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold text-slate-700">Registrar Manejo Técnico</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Data do Evento</Label>
              <Input type="date" className="h-8 text-xs" value={form.data_evento} onChange={(e) => setForm({ ...form, data_evento: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Lote</Label>
              <Select value={form.lote_id} onValueChange={(value) => setForm({ ...form, lote_id: value, quantidade_animais: "" })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {lotes.map((lote) => <SelectItem key={lote.id} value={lote.id}>{lote.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo do Evento</Label>
              <Select value={form.tipo_evento} onValueChange={handleTipoChange}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(MANEJO_TIPO_LABELS).map((tipo) => <SelectItem key={tipo} value={tipo}>{MANEJO_TIPO_LABELS[tipo]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subtipo</Label>
              <Select value={form.subtipo_manejo} onValueChange={(value) => setForm({ ...form, subtipo_manejo: value })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {subtipos.map((subtipo) => <SelectItem key={subtipo} value={subtipo}>{subtipo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quantidade de Animais</Label>
              <Input className="h-8 text-xs" type="number" value={form.quantidade_animais} onChange={(e) => setForm({ ...form, quantidade_animais: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Responsável</Label>
              <Input className="h-8 text-xs" value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} />
            </div>
          </div>

          {form.tipo_evento === "SANITARIO" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1"><Label className="text-xs">Produto Utilizado</Label><Input className="h-8 text-xs" value={form.produto_utilizado} onChange={(e) => setForm({ ...form, produto_utilizado: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Dose</Label><Input className="h-8 text-xs" value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Via de Aplicação</Label><Input className="h-8 text-xs" value={form.via_aplicacao} onChange={(e) => setForm({ ...form, via_aplicacao: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Duração do Tratamento</Label><Input className="h-8 text-xs" value={form.duracao_tratamento} onChange={(e) => setForm({ ...form, duracao_tratamento: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Lote Tratado</Label><Input className="h-8 text-xs" value={form.lote_tratado} onChange={(e) => setForm({ ...form, lote_tratado: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Quantidade Tratada</Label><Input className="h-8 text-xs" type="number" value={form.quantidade_tratada} onChange={(e) => setForm({ ...form, quantidade_tratada: e.target.value })} /></div>
            </div>
          )}

          {form.tipo_evento === "PESAGEM" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1"><Label className="text-xs">Peso Médio Atual</Label><Input className="h-8 text-xs" type="number" step="0.1" value={form.peso_medio_atual} onChange={(e) => setForm({ ...form, peso_medio_atual: e.target.value })} /></div>
            </div>
          )}

          {form.tipo_evento === "NUTRICIONAL" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1"><Label className="text-xs">Produto</Label><Input className="h-8 text-xs" value={form.produto} onChange={(e) => setForm({ ...form, produto: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Quantidade Fornecida</Label><Input className="h-8 text-xs" type="number" step="0.1" value={form.quantidade_fornecida} onChange={(e) => setForm({ ...form, quantidade_fornecida: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Unidade</Label><Input className="h-8 text-xs" value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Frequência</Label><Input className="h-8 text-xs" value={form.frequencia} onChange={(e) => setForm({ ...form, frequencia: e.target.value })} /></div>
            </div>
          )}

          {form.tipo_evento === "REPRODUCAO" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1"><Label className="text-xs">Matriz</Label><Input className="h-8 text-xs" value={form.matriz} onChange={(e) => setForm({ ...form, matriz: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Reprodutor</Label><Input className="h-8 text-xs" value={form.reprodutor} onChange={(e) => setForm({ ...form, reprodutor: e.target.value })} /></div>
              <div className="space-y-1 lg:col-span-2"><Label className="text-xs">Resultado do Diagnóstico</Label><Input className="h-8 text-xs" value={form.resultado_diagnostico} onChange={(e) => setForm({ ...form, resultado_diagnostico: e.target.value })} /></div>
            </div>
          )}

          {form.tipo_evento === "AVALIACAO" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1"><Label className="text-xs">Escala de Avaliação</Label><Input className="h-8 text-xs" value={form.escala_avaliacao} onChange={(e) => setForm({ ...form, escala_avaliacao: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Resultado</Label><Input className="h-8 text-xs" value={form.resultado} onChange={(e) => setForm({ ...form, resultado: e.target.value })} /></div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea className="text-xs" rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={salvando || !form.lote_id}>
              {salvando ? 'Salvando...' : 'Salvar Manejo'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}