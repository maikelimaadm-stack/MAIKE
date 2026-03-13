import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ManejoTecnicoForm from "@/components/manejo/ManejoTecnicoForm";
import AlertasManejoLote from "@/components/manejo/AlertasManejoLote";
import LinhaDoTempoLote from "@/components/manejo/LinhaDoTempoLote";
import { MANEJO_TIPO_LABELS } from "@/components/manejo/manejoOptions";

export default function ManejosTecnicosRebanho() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const loteInicialId = urlParams.get('loteId') || 'all';

  const [filtros, setFiltros] = useState({
    lote_id: loteInicialId,
    tipo_evento: 'all',
    categoria: 'all',
    data_inicio: '',
    data_fim: ''
  });

  const { data: usuario } = useQuery({
    queryKey: ['me-manejos'],
    queryFn: () => base44.auth.me()
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-manejos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && item.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: manejos = [] } = useQuery({
    queryKey: ['manejos-tecnicos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ManejoTecnicoRebanho.list('-data_evento');
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-timeline', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoMapa.list('-data_movimentacao');
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: suplementacoes = [] } = useQuery({
    queryKey: ['suplementacoes-timeline', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoLote.list('-data_lancamento');
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const loteSelecionado = useMemo(
    () => lotes.find((item) => item.id === filtros.lote_id),
    [lotes, filtros.lote_id]
  );

  const registrosFiltrados = useMemo(() => {
    return manejos.filter((item) => {
      if (filtros.lote_id !== 'all' && item.lote_id !== filtros.lote_id) return false;
      if (filtros.tipo_evento !== 'all' && item.tipo_evento !== filtros.tipo_evento) return false;
      if (filtros.categoria !== 'all' && item.categoria !== filtros.categoria) return false;
      if (filtros.data_inicio && item.data_evento < filtros.data_inicio) return false;
      if (filtros.data_fim && item.data_evento > filtros.data_fim) return false;
      return true;
    });
  }, [manejos, filtros]);

  const alertas = useMemo(() => {
    if (!loteSelecionado) return [];

    const pesagensTecnicas = manejos.filter((item) => item.lote_id === loteSelecionado.id && item.tipo_evento === 'PESAGEM');
    const pesagensMapa = movimentacoes.filter((item) => item.tipo === 'Pesagem' && (item.lote_id === loteSelecionado.id || item.lote === loteSelecionado.nome));
    const sanitarios = manejos.filter((item) => item.lote_id === loteSelecionado.id && item.tipo_evento === 'SANITARIO');

    const datasPesagem = [...pesagensTecnicas.map((item) => item.data_evento), ...pesagensMapa.map((item) => item.data_movimentacao?.split('T')[0])].filter(Boolean).sort().reverse();
    const ultimaPesagem = datasPesagem[0];

    const datasSanitario = sanitarios.map((item) => item.data_evento).filter(Boolean).sort().reverse();
    const ultimoSanitario = datasSanitario[0];

    const alertasLote = [];
    const hoje = new Date();

    if (ultimaPesagem) {
      const dias = Math.floor((hoje - new Date(ultimaPesagem)) / 86400000);
      if (dias > 60) alertasLote.push({ titulo: 'Pesagem em atraso', descricao: `O lote está sem pesagem há ${dias} dias.` });
    } else {
      alertasLote.push({ titulo: 'Sem pesagem', descricao: 'Não existe pesagem registrada para este lote.' });
    }

    if (ultimoSanitario) {
      const dias = Math.floor((hoje - new Date(ultimoSanitario)) / 86400000);
      if (dias > 90) alertasLote.push({ titulo: 'Sanidade em atraso', descricao: `O lote está sem manejo sanitário há ${dias} dias.` });
    } else {
      alertasLote.push({ titulo: 'Sem manejo sanitário', descricao: 'Não existe manejo sanitário recente para este lote.' });
    }

    const gmdBaixo = pesagensTecnicas.find((item) => item.gmd_calculado !== null && item.gmd_calculado !== undefined && item.gmd_calculado < 0.5);
    if (gmdBaixo) {
      alertasLote.push({ titulo: 'GMD baixo', descricao: `Foi encontrado GMD de ${Number(gmdBaixo.gmd_calculado).toFixed(2)} kg/dia para este lote.` });
    }

    return alertasLote;
  }, [loteSelecionado, manejos, movimentacoes]);

  const linhaDoTempo = useMemo(() => {
    if (!loteSelecionado) return [];

    const eventosManejo = manejos
      .filter((item) => item.lote_id === loteSelecionado.id)
      .map((item) => ({
        key: `manejo-${item.id}`,
        dataRaw: item.data_evento,
        data: new Date(item.data_evento).toLocaleDateString('pt-BR'),
        tipo: item.subtipo_manejo,
        origem: 'Manejo Técnico',
        titulo: `${MANEJO_TIPO_LABELS[item.tipo_evento] || item.tipo_evento} - ${item.subtipo_manejo}`,
        descricao: item.observacoes
      }));

    const eventosMapa = movimentacoes
      .filter((item) => item.lote_id === loteSelecionado.id || item.lote === loteSelecionado.nome)
      .map((item) => ({
        key: `mapa-${item.id}`,
        dataRaw: item.data_movimentacao,
        data: new Date(item.data_movimentacao).toLocaleDateString('pt-BR'),
        tipo: item.tipo,
        origem: 'Histórico do Sistema',
        titulo: item.motivo || item.tipo,
        descricao: item.observacoes
      }));

    const eventosSuplementacao = suplementacoes
      .filter((item) => item.lote_id === loteSelecionado.id)
      .map((item) => ({
        key: `supl-${item.id}`,
        dataRaw: item.data_lancamento,
        data: new Date(item.data_lancamento).toLocaleDateString('pt-BR'),
        tipo: 'Suplementação',
        origem: 'Suplementação',
        titulo: item.produto || 'Suplementação',
        descricao: `${(item.consumo_total_lote_periodo_kg || 0).toFixed(1)} kg no período`
      }));

    return [...eventosMapa, ...eventosManejo, ...eventosSuplementacao]
      .sort((a, b) => new Date(b.dataRaw) - new Date(a.dataRaw));
  }, [loteSelecionado, manejos, movimentacoes, suplementacoes]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Manejos Técnicos do Rebanho</h1>
        <p className="text-sm text-slate-600">Controle sanitário, nutricional, reprodutivo, pesagem e avaliação por lote.</p>
      </div>

      <Card>
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold text-slate-700">Filtros do Módulo</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Lote</Label>
              <Select value={filtros.lote_id} onValueChange={(value) => setFiltros({ ...filtros, lote_id: value })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {lotes.map((lote) => <SelectItem key={lote.id} value={lote.id}>{lote.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={filtros.tipo_evento} onValueChange={(value) => setFiltros({ ...filtros, tipo_evento: value })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.keys(MANEJO_TIPO_LABELS).map((tipo) => <SelectItem key={tipo} value={tipo}>{MANEJO_TIPO_LABELS[tipo]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={filtros.categoria} onValueChange={(value) => setFiltros({ ...filtros, categoria: value })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {[...new Set(lotes.map((item) => item.categoria).filter(Boolean))].map((categoria) => <SelectItem key={categoria} value={categoria}>{categoria}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Inicial</Label>
              <Input type="date" className="h-8 text-xs" value={filtros.data_inicio} onChange={(e) => setFiltros({ ...filtros, data_inicio: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Final</Label>
              <Input type="date" className="h-8 text-xs" value={filtros.data_fim} onChange={(e) => setFiltros({ ...filtros, data_fim: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <ManejoTecnicoForm
            lotes={lotes}
            loteInicialId={filtros.lote_id !== 'all' ? filtros.lote_id : ''}
            responsavelPadrao={usuario?.email || ''}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['manejos-tecnicos'] });
              queryClient.invalidateQueries({ queryKey: ['lotes-manejos'] });
            }}
          />
        </div>
        <div>
          <AlertasManejoLote alertas={alertas} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <LinhaDoTempoLote eventos={linhaDoTempo} />

        <Card>
          <CardHeader className="bg-slate-50 border-b py-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Registros Técnicos</CardTitle>
          </CardHeader>
          <CardContent className="p-4 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Subtipo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Lote</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Qtd.</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Área</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registrosFiltrados.map((item) => (
                  <TableRow key={item.id} className="hover:bg-gray-50">
                    <TableCell className="text-xs py-1 border border-gray-300">{new Date(item.data_evento).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{MANEJO_TIPO_LABELS[item.tipo_evento] || item.tipo_evento}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{item.subtipo_manejo}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{item.nome_lote}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{item.quantidade_animais}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{item.nome_area}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{item.responsavel || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}