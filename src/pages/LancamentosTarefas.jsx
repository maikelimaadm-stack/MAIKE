import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, Settings, MoreVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function LancamentosTarefas() {
  const [search, setSearch] = useState("");
  const [periodoIni, setPeriodoIni] = useState("");
  const [periodoFim, setPeriodoFim] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fGrupo, setFGrupo] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fArea, setFArea] = useState("");
  const [fResp, setFResp] = useState("");
  const [fUrgencia, setFUrgencia] = useState("");
  const [fNivel, setFNivel] = useState("");

  const [colunas, setColunas] = useState({
    status: true, urgencia: true, grupo: true, tipo: true, area: true, responsavel: true, dataIni: true, dataFim: true, atrasada: true, acoes: true,
  });

  const [selecionados, setSelecionados] = useState([]);

  const { data: grupos = [] } = useQuery({ queryKey: ["grupos-atividades"], queryFn: () => base44.entities.GrupoAtividade.list(), initialData: [] });
  const { data: tipos = [] } = useQuery({ queryKey: ["tipos-tarefa"], queryFn: () => base44.entities.TipoTarefa.list(), initialData: [] });
  const { data: areas = [] } = useQuery({ queryKey: ["areas-pasto"], queryFn: () => base44.entities.AreaPastagem.list(), initialData: [] });
  const { data: pessoas = [] } = useQuery({ queryKey: ["contatos"], queryFn: () => base44.entities.Fornecedor.list(), initialData: [] });
  const { data: lancs = [], isLoading, refetch } = useQuery({ queryKey: ["lancamentos-tarefa"], queryFn: () => base44.entities.LancamentoTarefa.list("-updated_date"), initialData: [] });

  const filtered = useMemo(() => {
    return lancs.filter(l =>
      (!search || (l.nome_tipo_tarefa||'').toLowerCase().includes(search.toLowerCase()) || (l.grupo_atividade_nome||'').toLowerCase().includes(search.toLowerCase()) || (l.responsavel_nome||'').toLowerCase().includes(search.toLowerCase())) &&
      (!periodoIni || (l.data_inicial && l.data_inicial >= periodoIni)) &&
      (!periodoFim || (l.data_final && l.data_final <= periodoFim)) &&
      (!fStatus || l.status_tarefa === fStatus) &&
      (!fGrupo || l.grupo_atividade_id === fGrupo) &&
      (!fTipo || l.tipo_tarefa_id === fTipo) &&
      (!fArea || l.area_pasto_id === fArea) &&
      (!fResp || l.responsavel_id === fResp) &&
      (!fUrgencia || l.urgencia === fUrgencia) &&
      (!fNivel || l.nivel_urgencia === fNivel)
    );
  }, [lancs, search, periodoIni, periodoFim, fStatus, fGrupo, fTipo, fArea, fResp, fUrgencia, fNivel]);

  const allIds = filtered.map(l => l.id);
  const todosMarcados = selecionados.length > 0 && selecionados.length === allIds.length;
  const alternarTodos = (checked) => setSelecionados(checked ? allIds : []);
  const alternarUm = (id, checked) => setSelecionados(prev => checked ? [...prev, id] : prev.filter(x => x !== id));

  const excluir = async (id) => { if (!confirm('Excluir lançamento?')) return; await base44.entities.LancamentoTarefa.delete(id); await refetch(); };
  const duplicar = async (l) => { const copy = { ...l }; delete copy.id; delete copy.created_date; delete copy.updated_date; delete copy.created_by; copy.status_tarefa = "Planejada"; await base44.entities.LancamentoTarefa.create(copy); await refetch(); };

  const limparFiltros = () => { setSearch(""); setPeriodoIni(""); setPeriodoFim(""); setFStatus(""); setFGrupo(""); setFTipo(""); setFArea(""); setFResp(""); setFUrgencia(""); setFNivel(""); };

  return (
    <div className="p-4 space-y-3">
      <div className="mb-2">
        <Card>
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Lançamentos de Tarefas</div>
              <div className="text-xs text-slate-500">Gestão e controle de tarefas</div>
            </div>
            <div className="flex items-center gap-2">
              <Link to={createPageUrl("LancamentoTarefaForm")}>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Lançar Tarefa
                </Button>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <Settings className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuCheckboxItem checked={colunas.status} onCheckedChange={(v)=>setColunas(c=>({...c,status:!!v}))}>Status</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.urgencia} onCheckedChange={(v)=>setColunas(c=>({...c,urgencia:!!v}))}>Urgência/Nível</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.grupo} onCheckedChange={(v)=>setColunas(c=>({...c,grupo:!!v}))}>Grupo</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.tipo} onCheckedChange={(v)=>setColunas(c=>({...c,tipo:!!v}))}>Tipo</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.area} onCheckedChange={(v)=>setColunas(c=>({...c,area:!!v}))}>Área</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.responsavel} onCheckedChange={(v)=>setColunas(c=>({...c,responsavel:!!v}))}>Responsável</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.dataIni} onCheckedChange={(v)=>setColunas(c=>({...c,dataIni:!!v}))}>Data inicial</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.dataFim} onCheckedChange={(v)=>setColunas(c=>({...c,dataFim:!!v}))}>Data final</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.atrasada} onCheckedChange={(v)=>setColunas(c=>({...c,atrasada:!!v}))}>Atrasada?</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={colunas.acoes} onCheckedChange={(v)=>setColunas(c=>({...c,acoes:!!v}))}>Ações</DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar (tipo, grupo, responsável)" className="h-8 text-xs pl-8" />
          </div>
          <div>
            <label className="text-xs">Período início</label>
            <Input type="date" value={periodoIni} onChange={(e)=>setPeriodoIni(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-xs">Período fim</label>
            <Input type="date" value={periodoFim} onChange={(e)=>setPeriodoFim(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-xs">Status</label>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {["Planejada","Em andamento","Concluída","Cancelada","Atrasada"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs">Grupo</label>
            <Select value={fGrupo} onValueChange={setFGrupo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.nome_grupo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs">Tipo</label>
            <Select value={fTipo} onValueChange={setFTipo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {tipos.map(t => <SelectItem key={t.id} value={t.id}>{t.nome_tipo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs">Área/Pasto</label>
            <Select value={fArea} onValueChange={setFArea}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas</SelectItem>
                {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs">Responsável</label>
            <Select value={fResp} onValueChange={setFResp}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {pessoas.filter(p => (p.tipos||[]).includes("Funcionario")).map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs">Urgência</label>
            <Select value={fUrgencia} onValueChange={setFUrgencia}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas</SelectItem>
                {["Não urgente","Urgente"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs">Nível</label>
            <Select value={fNivel} onValueChange={setFNivel}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {["Baixo","Médio","Alto","Crítico"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 md:col-span-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={limparFiltros}>Limpar Filtros</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black w-8">
                    <Checkbox checked={todosMarcados} onCheckedChange={(v)=>alternarTodos(!!v)} />
                  </TableHead>
                  {colunas.status && <TableHead className="text-xs font-bold py-1 border border-black">Status</TableHead>}
                  {colunas.urgencia && <TableHead className="text-xs font-bold py-1 border border-black">Urgência/Nível</TableHead>}
                  {colunas.grupo && <TableHead className="text-xs font-bold py-1 border border-black">Grupo</TableHead>}
                  {colunas.tipo && <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>}
                  {colunas.area && <TableHead className="text-xs font-bold py-1 border border-black">Área</TableHead>}
                  {colunas.responsavel && <TableHead className="text-xs font-bold py-1 border border-black">Responsável</TableHead>}
                  {colunas.dataIni && <TableHead className="text-xs font-bold py-1 border border-black">Data inicial</TableHead>}
                  {colunas.dataFim && <TableHead className="text-xs font-bold py-1 border border-black">Data final</TableHead>}
                  {colunas.atrasada && <TableHead className="text-xs font-bold py-1 border border-black">Atrasada?</TableHead>}
                  {colunas.acoes && <TableHead className="text-xs font-bold py-1 border border-black w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={100} className="text-xs py-1 border border-gray-300 text-center">Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={100} className="text-xs py-1 border border-gray-300 text-center">Nenhum registro</TableCell></TableRow>
                ) : (
                  filtered.map(l => (
                    <TableRow key={l.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300 w-8">
                        <Checkbox checked={selecionados.includes(l.id)} onCheckedChange={(v)=>alternarUm(l.id, !!v)} />
                      </TableCell>
                      {colunas.status && <TableCell className="text-xs py-1 border border-gray-300">{l.status_tarefa}</TableCell>}
                      {colunas.urgencia && <TableCell className="text-xs py-1 border border-gray-300">{l.urgencia} / {l.nivel_urgencia}</TableCell>}
                      {colunas.grupo && <TableCell className="text-xs py-1 border border-gray-300">{l.grupo_atividade_nome}</TableCell>}
                      {colunas.tipo && <TableCell className="text-xs py-1 border border-gray-300">{l.nome_tipo_tarefa}</TableCell>}
                      {colunas.area && <TableCell className="text-xs py-1 border border-gray-300">{l.area_pasto_nome || '-'}</TableCell>}
                      {colunas.responsavel && <TableCell className="text-xs py-1 border border-gray-300">{l.responsavel_nome}</TableCell>}
                      {colunas.dataIni && <TableCell className="text-xs py-1 border border-gray-300">{l.data_inicial}</TableCell>}
                      {colunas.dataFim && <TableCell className="text-xs py-1 border border-gray-300">{l.data_final}</TableCell>}
                      {colunas.atrasada && <TableCell className="text-xs py-1 border border-gray-300">{l.atrasada ? 'Sim' : 'Não'}</TableCell>}
                      {colunas.acoes && (
                        <TableCell className="text-xs py-1 border border-gray-300 w-10">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="h-8 text-xs px-2">
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link to={createPageUrl(`LancamentoTarefaForm?id=${l.id}`)}>Editar</Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={()=>duplicar(l)}>Duplicar</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-red-600" onClick={()=>excluir(l.id)}>Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}