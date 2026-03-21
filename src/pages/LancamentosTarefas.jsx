import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { MoreVertical, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { normalizeTaskPriority } from "@/components/mapa/FormularioTarefaMapa";

const PRIORIDADE_CORES = { Baixa: "bg-slate-100 text-slate-700", Média: "bg-blue-100 text-blue-700", Alta: "bg-amber-100 text-amber-700" };
const STATUS_CORES = { Pendente: "bg-yellow-100 text-yellow-700", "Em Andamento": "bg-blue-100 text-blue-700", Concluída: "bg-emerald-100 text-emerald-700", Cancelada: "bg-slate-100 text-slate-500" };

export default function LancamentosTarefas() {
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("todos");
  const [fPrioridade, setFPrioridade] = useState("todas");
  const [fGrupo, setFGrupo] = useState("todos");
  const [deleteTask, setDeleteTask] = useState(null);

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ["gestao-tarefas-unificada", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list("-updated_date");
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: iconesPrioridade = [] } = useQuery({
    queryKey: ["icones-prioridade-gestao-tarefas"],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((icone) => icone.ativo !== false && icone.tipo_entidade === "Prioridade Tarefa");
    },
    initialData: [],
  });

  const grupos = useMemo(() => [...new Set(tarefas.map((item) => item.grupo_atividade_nome).filter(Boolean))].sort(), [tarefas]);

  const getIconePrioridade = (prioridade) => {
    const normalize = (value) => (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const prioridadeNormalizada = normalize(normalizeTaskPriority(prioridade));
    return iconesPrioridade.find((icone) => normalize(icone.categoria) === prioridadeNormalizada);
  };

  const filtered = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return tarefas.filter((tarefa) => {
      if (fStatus !== "todos" && tarefa.status !== fStatus) return false;
      if (fPrioridade !== "todas" && normalizeTaskPriority(tarefa.prioridade) !== fPrioridade) return false;
      if (fGrupo !== "todos" && tarefa.grupo_atividade_nome !== fGrupo) return false;
      if (!termo) return true;
      return [tarefa.titulo, tarefa.tipo_tarefa_nome, tarefa.grupo_atividade_nome, tarefa.area_nome, tarefa.responsavel].some((value) => (value || "").toLowerCase().includes(termo));
    });
  }, [tarefas, search, fStatus, fPrioridade, fGrupo]);

  const deleteMutation = useMutation({
    mutationFn: async (tarefa) => base44.entities.LancamentoTarefa.delete(tarefa.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
    },
  });

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Gestão de Tarefas</h1>
          <p className="text-xs text-slate-600">Base única integrada com o mapa</p>
        </div>
        <Link to={createPageUrl("LancamentoTarefaForm")}>
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"><Plus className="w-3.5 h-3.5" />Lançar Tarefa</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Buscar</Label>
              <div className="relative"><Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs pl-8" placeholder="Título, grupo, área..." /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={fStatus} onValueChange={setFStatus}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos" className="text-xs">Todos</SelectItem><SelectItem value="Pendente" className="text-xs">Pendente</SelectItem><SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem><SelectItem value="Concluída" className="text-xs">Concluída</SelectItem><SelectItem value="Cancelada" className="text-xs">Cancelada</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prioridade</Label>
              <Select value={fPrioridade} onValueChange={setFPrioridade}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas" className="text-xs">Todas</SelectItem><SelectItem value="Baixa" className="text-xs">Baixa</SelectItem><SelectItem value="Média" className="text-xs">Média</SelectItem><SelectItem value="Alta" className="text-xs">Alta</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Grupo</Label>
              <Select value={fGrupo} onValueChange={setFGrupo}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos" className="text-xs">Todos</SelectItem>{grupos.map((grupo) => <SelectItem key={grupo} value={grupo} className="text-xs">{grupo}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="flex items-end"><Button variant="outline" size="sm" className="h-8 text-xs w-full" onClick={() => { setSearch(""); setFStatus("todos"); setFPrioridade("todas"); setFGrupo("todos"); }}>Limpar Filtros</Button></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-bold py-1 border border-black">Tarefa</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Status</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Prioridade</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Grupo</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Área</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Responsável</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Prazo</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={9} className="text-xs py-1 border border-gray-300 text-center">Carregando...</TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={9} className="text-xs py-1 border border-gray-300 text-center">Nenhuma tarefa encontrada</TableCell></TableRow> : filtered.map((tarefa) => {
                const prioridade = normalizeTaskPriority(tarefa.prioridade);
                return <TableRow key={tarefa.id} className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300 font-medium">{tarefa.titulo}</TableCell><TableCell className="text-xs py-1 border border-gray-300"><Badge className={`text-[10px] ${STATUS_CORES[tarefa.status] || STATUS_CORES.Pendente}`}>{tarefa.status}</Badge></TableCell><TableCell className="text-xs py-1 border border-gray-300"><div className="flex items-center gap-2">{getIconePrioridade(prioridade)?.icone_url && <img src={getIconePrioridade(prioridade).icone_url} alt={prioridade} className="w-4 h-4 object-contain" />}<Badge className={`text-[10px] ${PRIORIDADE_CORES[prioridade]}`}>{prioridade}</Badge></div></TableCell><TableCell className="text-xs py-1 border border-gray-300">{tarefa.grupo_atividade_nome || "-"}</TableCell><TableCell className="text-xs py-1 border border-gray-300">{tarefa.tipo_tarefa_nome || tarefa.tipo || "-"}</TableCell><TableCell className="text-xs py-1 border border-gray-300">{tarefa.area_nome || "-"}</TableCell><TableCell className="text-xs py-1 border border-gray-300">{tarefa.responsavel || "-"}</TableCell><TableCell className="text-xs py-1 border border-gray-300">{tarefa.data_prevista || "-"}</TableCell><TableCell className="text-xs py-1 border border-gray-300 text-center"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild className="text-xs"><Link to={createPageUrl(`LancamentoTarefaForm?id=${tarefa.id}`)}>Editar</Link></DropdownMenuItem><DropdownMenuItem className="text-xs text-red-600" onClick={() => setDeleteTask(tarefa)}>Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>;
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}