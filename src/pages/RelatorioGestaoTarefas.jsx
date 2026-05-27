import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { buildByIdMap } from "@/lib/reportNameResolvers";

const STATUS = ["Pendente", "Em Andamento", "Concluída", "Cancelada"]; 
const PRIORIDADES = ["Baixa", "Normal", "Alta", "Urgente"];
const CORES = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#9333ea", "#64748b"]; 

export default function RelatorioGestaoTarefas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [filtros, setFiltros] = useState({
    status: "todos",
    prioridade: "todas",
    origem: "todas",
    responsavel: "",
    dataInicio: "",
    dataFim: "",
    busca: ""
  });

  const { data: tarefas = [] } = useQuery({
    queryKey: ['gestao-tarefas-rel', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list();
      return all.filter(t => t.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-relatorio-gestao-tarefas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-relatorio-gestao-tarefas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: tiposTarefa = [] } = useQuery({
    queryKey: ['tipos-relatorio-gestao-tarefas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.TipoTarefa.list();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const tarefasManuais = [];
  const areasById = useMemo(() => buildByIdMap(areas), [areas]);
  const lotesById = useMemo(() => buildByIdMap(lotes), [lotes]);
  const tiposById = useMemo(() => buildByIdMap(tiposTarefa), [tiposTarefa]);

  const normalizadas = useMemo(() => {
    return tarefas.map(t => ({
      id: t.id,
      origem: 'Mapa',
      titulo: t.titulo || t.descricao || 'Tarefa',
      descricao: t.descricao || '',
      tipo: tiposById.get(t.tipo_tarefa_id)?.nome_tipo || t.tipo || t.tipo_tarefa_nome || 'Outro',
      prioridade: t.prioridade || 'Média',
      status: t.status || 'Pendente',
      data_prevista: t.data_prevista || null,
      data_conclusao: t.data_conclusao || null,
      responsavel: t.responsavel || '',
      area: areasById.get(t.area_id)?.nome || t.area_nome || '',
      lote: lotesById.get(t.lote_id)?.nome || t.lote_nome || ''
    }));
  }, [tarefas, areasById, lotesById, tiposById]);

  const filtradas = useMemo(() => {
    return normalizadas.filter(t => {
      if (filtros.status !== 'todos' && t.status !== filtros.status) return false;
      if (filtros.prioridade !== 'todas' && t.prioridade !== filtros.prioridade) return false;
      if (filtros.origem !== 'todas' && t.origem !== filtros.origem) return false;
      if (filtros.responsavel && !(t.responsavel || '').toLowerCase().includes(filtros.responsavel.toLowerCase())) return false;

      const dp = t.data_prevista ? new Date(t.data_prevista) : null;
      if (filtros.dataInicio && dp && dp < new Date(filtros.dataInicio)) return false;
      if (filtros.dataFim && dp && dp > new Date(filtros.dataFim)) return false;

      if (filtros.busca) {
        const b = filtros.busca.toLowerCase();
        const texto = `${t.titulo} ${t.descricao} ${t.tipo} ${t.area} ${t.lote}`.toLowerCase();
        if (!texto.includes(b)) return false;
      }
      return true;
    });
  }, [normalizadas, filtros]);

  const porStatus = useMemo(() => {
    const mapa = new Map();
    filtradas.forEach(t => mapa.set(t.status, (mapa.get(t.status) || 0) + 1));
    return Array.from(mapa.entries()).map(([name, value]) => ({ name, value }));
  }, [filtradas]);

  const porResponsavel = useMemo(() => {
    const mapa = new Map();
    filtradas.forEach(t => mapa.set(t.responsavel || '—', (mapa.get(t.responsavel || '—') || 0) + 1));
    return Array.from(mapa.entries()).map(([name, value]) => ({ name, value }));
  }, [filtradas]);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4" translate="no">
      <Card>
        <CardHeader className="py-3 bg-slate-50 border-b">
          <CardTitle className="text-sm font-semibold">Relatório de Gestão de Tarefas</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filtros.status} onValueChange={(v) => setFiltros({ ...filtros, status: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {STATUS.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Prioridade</Label>
              <Select value={filtros.prioridade} onValueChange={(v) => setFiltros({ ...filtros, prioridade: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                  {PRIORIDADES.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Origem</Label>
              <Select value={filtros.origem} onValueChange={(v) => setFiltros({ ...filtros, origem: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                  <SelectItem value="Mapa" className="text-xs">Mapa</SelectItem>
                  <SelectItem value="Manual" className="text-xs">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Responsável</Label>
              <Input className="h-8 text-xs" value={filtros.responsavel} onChange={(e) => setFiltros({ ...filtros, responsavel: e.target.value })} placeholder="Nome" />
            </div>
            <div>
              <Label className="text-xs">Data Início</Label>
              <Input type="date" className="h-8 text-xs" value={filtros.dataInicio} onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" className="h-8 text-xs" value={filtros.dataFim} onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value })} />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Busca</Label>
              <Input className="h-8 text-xs" value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} placeholder="Título, tipo, área, lote..." />
            </div>
            <div className="flex items-end gap-2 md:col-span-3">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFiltros({ status: 'todos', prioridade: 'todas', origem: 'todas', responsavel: '', dataInicio: '', dataFim: '', busca: '' })}>Limpar Filtros</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="py-3 bg-slate-50 border-b">
            <CardTitle className="text-sm font-semibold">Distribuição por Status</CardTitle>
          </CardHeader>
          <CardContent className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <RechartsTooltip />
                <Pie data={porStatus} dataKey="value" nameKey="name" innerRadius={40} outerRadius={60}>
                  {porStatus.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="py-3 bg-slate-50 border-b">
            <CardTitle className="text-sm font-semibold">Tarefas por Responsável</CardTitle>
          </CardHeader>
          <CardContent className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porResponsavel}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis allowDecimals={false} />
                <RechartsTooltip />
                <Legend />
                <Bar dataKey="value" name="Tarefas" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="py-3 bg-slate-50 border-b">
          <CardTitle className="text-sm font-semibold">Lista de Tarefas ({filtradas.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-bold py-1 border border-black">Origem</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Título</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Prioridade</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Status</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Prevista</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Conclusão</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Responsável</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Área</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Lote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.map((t) => (
                <TableRow key={t.id} className="hover:bg-gray-50">
                  <TableCell className="text-xs py-1 border border-gray-300">{t.origem}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.titulo}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.tipo}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.prioridade}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.status}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.data_prevista ? new Date(t.data_prevista).toLocaleDateString('pt-BR') : '—'}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.data_conclusao ? new Date(t.data_conclusao).toLocaleDateString('pt-BR') : '—'}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.responsavel || '—'}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.area || '—'}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{t.lote || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}