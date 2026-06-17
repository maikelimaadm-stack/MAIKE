import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { buildByIdMap } from "@/lib/reportNameResolvers";
import FotosTarefaGaleria from "@/components/tarefas/FotosTarefaGaleria";
import TarefaFichaIndividual from "@/components/tarefas/TarefaFichaIndividual";
import { LayoutList, BookOpen } from "lucide-react";

const STATUS = ["Pendente", "Em Andamento", "Concluída", "Cancelada"];
const PRIORIDADES = ["Baixa", "Média", "Alta"];
const CORES = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#9333ea", "#64748b"];

export default function RelatorioGestaoTarefas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [filtros, setFiltros] = useState({
    status: "todos",
    prioridade: "todas",
    responsavel: "",
    dataInicio: "",
    dataFim: "",
    busca: ""
  });
  const [modoVisualizacao, setModoVisualizacao] = useState("tabela"); // "tabela" | "ficha"
  const [fichaIndice, setFichaIndice] = useState(0);

  const { data: tarefas = [] } = useQuery({
    queryKey: ['gestao-tarefas-rel', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list();
      return all.filter(t => t.empresa_id === empresaSelecionadaId);
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

  const tiposById = useMemo(() => buildByIdMap(tiposTarefa), [tiposTarefa]);

  const normalizadas = useMemo(() => {
    return tarefas.map(t => ({
      ...t,
      tipo: tiposById.get(t.tipo_tarefa_id)?.nome_tipo || t.tipo || t.tipo_tarefa_nome || 'Outro',
    }));
  }, [tarefas, tiposById]);

  const filtradas = useMemo(() => {
    return normalizadas.filter(t => {
      if (filtros.status !== 'todos' && t.status !== filtros.status) return false;
      if (filtros.prioridade !== 'todas' && t.prioridade !== filtros.prioridade) return false;
      if (filtros.responsavel && !(t.responsavel || '').toLowerCase().includes(filtros.responsavel.toLowerCase())) return false;
      const dp = t.data_prevista ? new Date(t.data_prevista) : null;
      if (filtros.dataInicio && dp && dp < new Date(filtros.dataInicio)) return false;
      if (filtros.dataFim && dp && dp > new Date(filtros.dataFim)) return false;
      if (filtros.busca) {
        const b = filtros.busca.toLowerCase();
        const texto = `${t.titulo} ${t.descricao} ${t.tipo} ${t.area_nome} ${t.lote_nome} ${t.responsavel} ${t.grupo_atividade_nome}`.toLowerCase();
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

  const handleFiltroChange = (campo, valor) => {
    setFiltros(prev => ({ ...prev, [campo]: valor }));
    setFichaIndice(0);
  };

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 space-y-4" translate="no">

      {/* Cabeçalho com toggle de modo */}
      <Card>
        <CardHeader className="py-3 bg-slate-50 border-b">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-semibold">Relatório de Gestão de Tarefas</CardTitle>
            <div className="flex items-center border rounded-md overflow-hidden">
              <Button
                variant={modoVisualizacao === "tabela" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs rounded-none"
                onClick={() => setModoVisualizacao("tabela")}
              >
                <LayoutList className="w-3.5 h-3.5 mr-1" /> Tabela
              </Button>
              <Button
                variant={modoVisualizacao === "ficha" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs rounded-none"
                onClick={() => { setModoVisualizacao("ficha"); setFichaIndice(0); }}
              >
                <BookOpen className="w-3.5 h-3.5 mr-1" /> Ficha Individual
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filtros.status} onValueChange={(v) => handleFiltroChange('status', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {STATUS.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Prioridade</Label>
              <Select value={filtros.prioridade} onValueChange={(v) => handleFiltroChange('prioridade', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                  {PRIORIDADES.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Responsável</Label>
              <Input className="h-8 text-xs" value={filtros.responsavel} onChange={(e) => handleFiltroChange('responsavel', e.target.value)} placeholder="Nome" />
            </div>
            <div>
              <Label className="text-xs">Data Início</Label>
              <Input type="date" className="h-8 text-xs" value={filtros.dataInicio} onChange={(e) => handleFiltroChange('dataInicio', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" className="h-8 text-xs" value={filtros.dataFim} onChange={(e) => handleFiltroChange('dataFim', e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" size="sm" className="h-8 text-xs w-full" onClick={() => { setFiltros({ status: 'todos', prioridade: 'todas', responsavel: '', dataInicio: '', dataFim: '', busca: '' }); setFichaIndice(0); }}>
                Limpar
              </Button>
            </div>
            <div className="md:col-span-6">
              <Label className="text-xs">Busca</Label>
              <Input className="h-8 text-xs" value={filtros.busca} onChange={(e) => handleFiltroChange('busca', e.target.value)} placeholder="Título, tipo, área, lote, grupo, responsável..." />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modo Ficha Individual */}
      {modoVisualizacao === "ficha" ? (
        filtradas.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-slate-500 text-sm">Nenhuma tarefa encontrada com os filtros aplicados.</CardContent>
          </Card>
        ) : (
          <TarefaFichaIndividual
            tarefas={filtradas}
            indice={fichaIndice}
            onAnterior={() => setFichaIndice(i => Math.max(0, i - 1))}
            onProximo={() => setFichaIndice(i => Math.min(filtradas.length - 1, i + 1))}
          />
        )
      ) : (
        <>
          {/* Gráficos */}
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

          {/* Tabela */}
          <Card>
            <CardHeader className="py-3 bg-slate-50 border-b">
              <CardTitle className="text-sm font-semibold">Lista de Tarefas ({filtradas.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-bold py-1 border border-black">Título</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Grupo</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Prioridade</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Status</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Prevista</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Conclusão</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Responsável</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Setor</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Área</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Lote</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Fotos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((t) => {
                    const fotos = [...(t.fotos || []), ...(t.anexos_urls || [])];
                    return (
                      <TableRow key={t.id} className="hover:bg-gray-50">
                        <TableCell className="text-xs py-1 border border-gray-300">{t.titulo || '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.grupo_atividade_nome || '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.tipo}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.prioridade || '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.status || '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.data_prevista ? new Date(t.data_prevista).toLocaleDateString('pt-BR') : '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.data_conclusao ? new Date(t.data_conclusao).toLocaleDateString('pt-BR') : '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.responsavel || '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.setor_nome || '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.area_nome || '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{t.lote_nome || '—'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 min-w-[120px]">
                          {fotos.length > 0 ? (
                            <FotosTarefaGaleria tarefa={t} compact />
                          ) : <span className="text-slate-400">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}