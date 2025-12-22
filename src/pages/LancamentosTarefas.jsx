import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Plus, Save, X, Pencil, Trash2, RefreshCw, Search, Filter, CheckSquare, AlertTriangle, Copy, Columns } from "lucide-react";
import { toast } from "sonner";

export default function LancamentosTarefas() {
  const queryClient = useQueryClient();
  // Filtros
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
  const [somenteAtrasadas, setSomenteAtrasadas] = useState(false);

  const [colunas, setColunas] = useState({
    status: true,
    urgencia: true,
    grupo: true,
    tipo: true,
    area: true,
    areaHa: true,
    capUa: true,
    responsavel: true,
    dataIni: true,
    dataFim: true,
    atrasada: true,
    acoes: true,
  });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const emptyForm = {
    tipo_tarefa_id: "",
    grupo_atividade_id: "",
    data_inicial: "",
    data_final: "",
    area_pasto_id: "",
    responsavel_id: "",
    urgencia: "Não urgente",
    nivel_urgencia: "Baixo",
    prazo_definido: true,
    descricao_instrucoes: "",
    localizacao_adicional: "",
    status_tarefa: "Planejada",
    observacoes: "",
    usa_maquina: false,
    usa_produto: false,
    usa_implemento: false,
    fotos: []
  };
  const [form, setForm] = useState(emptyForm);
  const [itensMaquina, setItensMaquina] = useState([]);
  const [itensProduto, setItensProduto] = useState([]);
  const [itensImplemento, setItensImplemento] = useState([]);
const [uploadingFotos, setUploadingFotos] = useState(false);

  const { data: grupos = [] } = useQuery({ queryKey: ["grupos-atividades"], queryFn: () => base44.entities.GrupoAtividade.list(), initialData: [] });
  const { data: tipos = [] } = useQuery({ queryKey: ["tipos-tarefa"], queryFn: () => base44.entities.TipoTarefa.list(), initialData: [] });
  const { data: areas = [] } = useQuery({ queryKey: ["areas-pasto"], queryFn: () => base44.entities.AreaPastagem.list(), initialData: [] });
  const { data: pessoas = [] } = useQuery({ queryKey: ["contatos"], queryFn: () => base44.entities.Fornecedor.list(), initialData: [] });
  const { data: maquinas = [] } = useQuery({ queryKey: ["maquinas"], queryFn: () => base44.entities.Maquina?.list?.() ?? Promise.resolve([]), initialData: [] });
  const { data: produtos = [] } = useQuery({ queryKey: ["produtos"], queryFn: () => base44.entities.Produto.list(), initialData: [] });
  const { data: implementos = [] } = useQuery({ queryKey: ["implementos"], queryFn: () => base44.entities.Implemento.list(), initialData: [] });
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
      (!fNivel || l.nivel_urgencia === fNivel) &&
      (!somenteAtrasadas || !!l.atrasada)
    );
  }, [lancs, search, periodoIni, periodoFim, fStatus, fGrupo, fTipo, fArea, fResp, fUrgencia, fNivel, somenteAtrasadas]);

  const createMutation = useMutation({
    mutationFn: async (payload) => base44.entities.LancamentoTarefa.create(payload),
    onSuccess: async (created) => {
      // filhos
      await Promise.all([
        ...(itensMaquina.length ? base44.entities.ItemMaquinaUtilizada.bulkCreate(itensMaquina.map(i => ({ ...i, lancamento_tarefa_id: created.id }))) : []),
        ...(itensProduto.length ? base44.entities.ItemProdutoUtilizado.bulkCreate(itensProduto.map(i => ({ ...i, lancamento_tarefa_id: created.id }))) : []),
        ...(itensImplemento.length ? base44.entities.ItemImplementoUtilizado.bulkCreate(itensImplemento.map(i => ({ ...i, lancamento_tarefa_id: created.id }))) : [])
      ]);
      toast.success("Lançado!");
      queryClient.invalidateQueries({ queryKey: ["lancamentos-tarefa"] });
      setShowForm(false); setEditing(null); setForm(emptyForm); setItensMaquina([]); setItensProduto([]); setItensImplemento([]);
    }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.LancamentoTarefa.update(id, data),
    onSuccess: () => { toast.success("Atualizado!"); queryClient.invalidateQueries({ queryKey: ["lancamentos-tarefa"] }); setShowForm(false); setEditing(null); setForm(emptyForm); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.LancamentoTarefa.delete(id),
    onSuccess: () => { toast.success("Excluído!"); queryClient.invalidateQueries({ queryKey: ["lancamentos-tarefa"] }); }
  });

  const onSubmit = () => {
    if (!form.tipo_tarefa_id) { toast.error("Selecione o tipo de tarefa"); return; }
    if (!form.data_inicial || !form.data_final) { toast.error("Informe as datas"); return; }
    if (form.data_final < form.data_inicial) { toast.error("Data final não pode ser menor que a inicial"); return; }
    if (!form.responsavel_id) { toast.error("Selecione o responsável"); return; }
    const tipo = tipos.find(t => t.id === form.tipo_tarefa_id);
    if (tipo?.exige_area && !form.area_pasto_id) { toast.error("Este tipo exige área/pasto"); return; }

    const grupo = grupos.find(g => g.id === tipo?.grupo_atividade_id);
    const area = areas.find(a => a.id === form.area_pasto_id);
    const resp = pessoas.find(p => p.id === form.responsavel_id && (p.tipos||[]).includes("Funcionario"));
    if (!resp) { toast.error("Responsável deve ser Funcionário"); return; }

    const payload = {
      ...form,
      nome_tipo_tarefa: tipo?.nome_tipo || "",
      grupo_atividade_id: tipo?.grupo_atividade_id || "",
      grupo_atividade_nome: grupo?.nome_grupo || "",
      area_pasto_nome: area?.nome || "",
      responsavel_nome: resp?.nome || "",
      atrasada: false
    };

    if (editing) updateMutation.mutate({ id: editing.id, data: payload }); else createMutation.mutate(payload);
  };

  const duplicar = async (l) => {
    const copy = { ...l };
    delete copy.id; delete copy.created_date; delete copy.updated_date; delete copy.created_by;
    copy.status_tarefa = "Planejada";
    const { data } = await base44.entities.LancamentoTarefa.create(copy);
    toast.success("Duplicado");
    refetch();
  };

  const limparFiltros = () => {
    setSearch(""); setPeriodoIni(""); setPeriodoFim(""); setFStatus(""); setFGrupo(""); setFTipo(""); setFArea(""); setFResp(""); setFUrgencia(""); setFNivel(""); setSomenteAtrasadas(false);
  };

  return (
    <div className="p-4 space-y-3">
      {/* Filtros */}
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
          <div className="flex items-end gap-2">
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" className="scale-90" checked={somenteAtrasadas} onChange={(e)=>setSomenteAtrasadas(e.target.checked)} />
              Somente atrasadas
                           </label>
          </div>
          <div className="flex items-end gap-2 md:col-span-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={limparFiltros}>
              <Filter className="w-3.5 h-3.5 mr-1"/>Limpar
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1"/>Atualizar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <Columns className="w-3.5 h-3.5 mr-1" /> Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuCheckboxItem checked={colunas.status} onCheckedChange={(v)=>setColunas(c=>({...c,status:!!v}))}>Status</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.urgencia} onCheckedChange={(v)=>setColunas(c=>({...c,urgencia:!!v}))}>Urgência/Nível</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.grupo} onCheckedChange={(v)=>setColunas(c=>({...c,grupo:!!v}))}>Grupo</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.tipo} onCheckedChange={(v)=>setColunas(c=>({...c,tipo:!!v}))}>Tipo</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.area} onCheckedChange={(v)=>setColunas(c=>({...c,area:!!v}))}>Área</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.areaHa} onCheckedChange={(v)=>setColunas(c=>({...c,areaHa:!!v}))}>Área (ha)</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.capUa} onCheckedChange={(v)=>setColunas(c=>({...c,capUa:!!v}))}>Cap. (UA)</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.responsavel} onCheckedChange={(v)=>setColunas(c=>({...c,responsavel:!!v}))}>Responsável</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.dataIni} onCheckedChange={(v)=>setColunas(c=>({...c,dataIni:!!v}))}>Data inicial</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.dataFim} onCheckedChange={(v)=>setColunas(c=>({...c,dataFim:!!v}))}>Data final</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.atrasada} onCheckedChange={(v)=>setColunas(c=>({...c,atrasada:!!v}))}>Atrasada?</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.acoes} onCheckedChange={(v)=>setColunas(c=>({...c,acoes:!!v}))}>Ações</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={()=>{ setShowForm(true); setEditing(null); setForm(emptyForm); setItensMaquina([]); setItensProduto([]); setItensImplemento([]); }}>
              <Plus className="w-3.5 h-3.5 mr-1"/>Novo Lançamento
            </Button>
          </div>
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardContent className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs">Tipo de Tarefa *</label>
              <Select value={form.tipo_tarefa_id} onValueChange={(v)=>setForm(f=>({...f,tipo_tarefa_id:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>
                  {tipos.map(t => <SelectItem key={t.id} value={t.id}>{t.nome_tipo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs">Grupo de Atividades</label>
              <Input value={grupos.find(g => g.id === (tipos.find(t=>t.id===form.tipo_tarefa_id)?.grupo_atividade_id))?.nome_grupo || ""} disabled className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs">Área/Pasto {(() => { const tt = tipos.find(t=>t.id===form.tipo_tarefa_id); return tt?.exige_area ? '*' : ''; })()}</label>
              <Select value={form.area_pasto_id} onValueChange={(v)=>setForm(f=>({...f,area_pasto_id:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>
                  {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs">Data inicial *</label>
              <Input type="date" value={form.data_inicial} onChange={(e)=>setForm(f=>({...f,data_inicial:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs">Data final *</label>
              <Input type="date" value={form.data_final} onChange={(e)=>setForm(f=>({...f,data_final:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs">Responsável (Funcionário) *</label>
              <Select value={form.responsavel_id} onValueChange={(v)=>setForm(f=>({...f,responsavel_id:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>
                  {pessoas.filter(p => (p.tipos||[]).includes("Funcionario")).map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs">Urgência *</label>
              <Select value={form.urgencia} onValueChange={(v)=>setForm(f=>({...f,urgencia:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {["Não urgente","Urgente"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs">Nível de urgência *</label>
              <Select value={form.nivel_urgencia} onValueChange={(v)=>setForm(f=>({...f,nivel_urgencia:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {["Baixo","Médio","Alto","Crítico"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 lg:col-span-2">
              <label className="text-xs">Descrição/Instruções</label>
              <Input value={form.descricao_instrucoes} onChange={(e)=>setForm(f=>({...f,descricao_instrucoes:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <label className="text-xs">Localização adicional</label>
              <Input value={form.localizacao_adicional} onChange={(e)=>setForm(f=>({...f,localizacao_adicional:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs">Status</label>
              <Select value={form.status_tarefa} onValueChange={(v)=>setForm(f=>({...f,status_tarefa:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {["Planejada","Em andamento","Concluída","Cancelada","Atrasada"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 lg:col-span-2">
              <label className="text-xs">Observações</label>
              <Input value={form.observacoes} onChange={(e)=>setForm(f=>({...f,observacoes:e.target.value}))} className="h-8 text-xs" />
            </div>

            <div className="space-y-1 lg:col-span-2">
              <label className="text-xs">Fotos</label>
              <input
                type="file"
                accept="image/*"
                multiple
                className="h-8 text-xs"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (!files.length) return;
                  setUploadingFotos(true);
                  try {
                    const urls = [];
                    for (const file of files) {
                      const { file_url } = await base44.integrations.Core.UploadFile({ file });
                      urls.push(file_url);
                    }
                    setForm(f => ({ ...f, fotos: [ ...(f.fotos || []), ...urls ] }));
                  } finally {
                    setUploadingFotos(false);
                    e.target.value = '';
                  }
                }}
              />
              {uploadingFotos && (
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Enviando...
                </div>
              )}
              {form.fotos && form.fotos.length > 0 && (
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-2">
                  {form.fotos.map((url, idx) => (
                    <div key={idx} className="relative">
                      <img src={url} alt={`foto-${idx}`} className="h-16 w-full object-cover rounded border" />
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-6 text-[10px] absolute top-1 right-1"
                        onClick={() => setForm(f => ({ ...f, fotos: (f.fotos || []).filter((_, i) => i !== idx) }))}
                      >
                        Remover
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Seções condicionais */}
            <div className="lg:col-span-2 border-t pt-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <label className="text-xs flex items-center gap-1"><input type="checkbox" className="scale-90" checked={form.usa_maquina} onChange={(e)=>setForm(f=>({...f,usa_maquina:e.target.checked}))}/> Usa máquina?</label>
                <label className="text-xs flex items-center gap-1"><input type="checkbox" className="scale-90" checked={form.usa_produto} onChange={(e)=>setForm(f=>({...f,usa_produto:e.target.checked}))}/> Usa produto?</label>
                <label className="text-xs flex items-center gap-1"><input type="checkbox" className="scale-90" checked={form.usa_implemento} onChange={(e)=>setForm(f=>({...f,usa_implemento:e.target.checked}))}/> Usa implemento?</label>
              </div>

              {form.usa_maquina && (
                <div className="mt-2 p-2 rounded border">
                  <div className="text-sm font-semibold mb-2">Máquinas utilizadas</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <Select onValueChange={(v)=>setItensMaquina(arr=>[...arr,{ maquina_id:v, operador_id:"", horas_trabalhadas:0, observacao:"", maquina_nome: (maquinas.find(m=>m.id===v)?.nome)||"" }])}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar máquina"/></SelectTrigger>
                      <SelectContent>
                        {maquinas.map(m => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {itensMaquina.length>0 && (
                    <div className="mt-2">
                      {itensMaquina.map((i,idx)=> (
                        <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center mb-2">
                          <Input value={i.maquina_nome} disabled className="h-8 text-xs" />
                          <Select value={i.operador_id} onValueChange={(v)=>setItensMaquina(list=>list.map((x,k)=>k===idx?{...x,operador_id:v, operador_nome:(pessoas.find(p=>p.id===v)?.nome)||''}:x))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Operador (opcional)"/></SelectTrigger>
                            <SelectContent>
                              {pessoas.filter(p => (p.tipos||[]).includes('Funcionario')).map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Input type="number" placeholder="Horas" className="h-8 text-xs" value={i.horas_trabalhadas||''} onChange={(e)=>setItensMaquina(list=>list.map((x,k)=>k===idx?{...x,horas_trabalhadas:Number(e.target.value)}:x))}/>
                          <Input placeholder="Observação" className="h-8 text-xs" value={i.observacao||''} onChange={(e)=>setItensMaquina(list=>list.map((x,k)=>k===idx?{...x,observacao:e.target.value}:x))}/>
                          <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>setItensMaquina(list=>list.filter((_,k)=>k!==idx))}><Trash2 className="w-3.5 h-3.5 mr-1"/>Remover</Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {form.usa_produto && (
                <div className="mt-2 p-2 rounded border">
                  <div className="text-sm font-semibold mb-2">Produtos utilizados</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <Select onValueChange={(v)=>setItensProduto(arr=>[...arr,{ produto_id:v, quantidade:1, unidade:'UN', custo:0, fornecedor_id:'', observacao:'', produto_nome:(produtos.find(p=>p.id===v)?.nome_produto)||'' }])}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar produto"/></SelectTrigger>
                      <SelectContent>
                        {produtos.map(m => <SelectItem key={m.id} value={m.id}>{m.nome_produto}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {itensProduto.length>0 && (
                    <div className="mt-2">
                      {itensProduto.map((i,idx)=> (
                        <div key={idx} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-center mb-2">
                          <Input value={i.produto_nome} disabled className="h-8 text-xs" />
                          <Input type="number" placeholder="Qtd" className="h-8 text-xs" value={i.quantidade||''} onChange={(e)=>setItensProduto(list=>list.map((x,k)=>k===idx?{...x,quantidade:Number(e.target.value)}:x))}/>
                          <Input placeholder="Unid" className="h-8 text-xs" value={i.unidade||''} onChange={(e)=>setItensProduto(list=>list.map((x,k)=>k===idx?{...x,unidade:e.target.value}:x))}/>
                          <Input type="number" placeholder="Custo" className="h-8 text-xs" value={i.custo||''} onChange={(e)=>setItensProduto(list=>list.map((x,k)=>k===idx?{...x,custo:Number(e.target.value)}:x))}/>
                          <Select value={i.fornecedor_id||''} onValueChange={(v)=>setItensProduto(list=>list.map((x,k)=>k===idx?{...x,fornecedor_id:v, fornecedor_nome:(pessoas.find(p=>p.id===v)?.nome)||''}:x))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Fornecedor (op)"/></SelectTrigger>
                            <SelectContent>
                              {pessoas.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>setItensProduto(list=>list.filter((_,k)=>k!==idx))}><Trash2 className="w-3.5 h-3.5 mr-1"/>Remover</Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {form.usa_implemento && (
                <div className="mt-2 p-2 rounded border">
                  <div className="text-sm font-semibold mb-2">Implementos utilizados</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <Select onValueChange={(v)=>setItensImplemento(arr=>[...arr,{ implemento_id:v, implemento_nome:(implementos.find(i=>i.id===v)?.nome)||'' }])}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar implemento"/></SelectTrigger>
                      <SelectContent>
                        {implementos.map(i => <SelectItem key={i.id} value={i.id}>{i.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {itensImplemento.length>0 && (
                    <div className="mt-2">
                      {itensImplemento.map((i,idx)=> (
                        <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center mb-2">
                          <Input value={i.implemento_nome} disabled className="h-8 text-xs" />
                          <div className="md:col-span-3"/>
                          <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>setItensImplemento(list=>list.filter((_,k)=>k!==idx))}><Trash2 className="w-3.5 h-3.5 mr-1"/>Remover</Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 lg:col-span-2 justify-end">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{ setShowForm(false); setEditing(null); setForm(emptyForm); setItensMaquina([]); setItensProduto([]); setItensImplemento([]); }}><X className="w-3.5 h-3.5 mr-1"/>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={onSubmit}><Save className="w-3.5 h-3.5 mr-1"/>Salvar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {colunas.status && <TableHead className="text-xs font-bold py-1 border border-black">Status</TableHead>}
                  {colunas.urgencia && <TableHead className="text-xs font-bold py-1 border border-black">Urgência/Nível</TableHead>}
                  {colunas.grupo && <TableHead className="text-xs font-bold py-1 border border-black">Grupo</TableHead>}
                  {colunas.tipo && <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>}
                  {colunas.area && <TableHead className="text-xs font-bold py-1 border border-black">Área</TableHead>}
                  {colunas.areaHa && <TableHead className="text-xs font-bold py-1 border border-black">Área (ha)</TableHead>}
                  {colunas.capUa && <TableHead className="text-xs font-bold py-1 border border-black">Cap. (UA)</TableHead>}
                  {colunas.responsavel && <TableHead className="text-xs font-bold py-1 border border-black">Responsável</TableHead>}
                  {colunas.dataIni && <TableHead className="text-xs font-bold py-1 border border-black">Data inicial</TableHead>}
                  {colunas.dataFim && <TableHead className="text-xs font-bold py-1 border border-black">Data final</TableHead>}
                  {colunas.atrasada && <TableHead className="text-xs font-bold py-1 border border-black">Atrasada?</TableHead>}
                  {colunas.acoes && <TableHead className="text-xs font-bold py-1 border border-black">Ações</TableHead>}
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
                      {colunas.status && <TableCell className="text-xs py-1 border border-gray-300">{l.status_tarefa}</TableCell>}
                      {colunas.urgencia && <TableCell className="text-xs py-1 border border-gray-300">{l.urgencia} / {l.nivel_urgencia}</TableCell>}
                      {colunas.grupo && <TableCell className="text-xs py-1 border border-gray-300">{l.grupo_atividade_nome}</TableCell>}
                      {colunas.tipo && <TableCell className="text-xs py-1 border border-gray-300">{l.nome_tipo_tarefa}</TableCell>}
                      {colunas.area && <TableCell className="text-xs py-1 border border-gray-300">{l.area_pasto_nome || '-'}</TableCell>}
                      {colunas.areaHa && <TableCell className="text-xs py-1 border border-gray-300">{(areas.find(a => a.id === l.area_pasto_id)?.tamanho_hectares) ?? '-'}</TableCell>}
                      {colunas.capUa && <TableCell className="text-xs py-1 border border-gray-300">{(areas.find(a => a.id === l.area_pasto_id)?.capacidade_maxima) ?? '-'}</TableCell>}
                      {colunas.responsavel && <TableCell className="text-xs py-1 border border-gray-300">{l.responsavel_nome}</TableCell>}
                      {colunas.dataIni && <TableCell className="text-xs py-1 border border-gray-300">{l.data_inicial}</TableCell>}
                      {colunas.dataFim && <TableCell className="text-xs py-1 border border-gray-300">{l.data_final}</TableCell>}
                      {colunas.atrasada && <TableCell className="text-xs py-1 border border-gray-300">{l.atrasada ? 'Sim' : 'Não'}</TableCell>}
                      {colunas.acoes && (
                        <TableCell className="text-xs py-1 border border-gray-300">
                          <div className="flex gap-1 flex-wrap">
                            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{ setEditing(l); setForm({ ...l }); setShowForm(true); }}><Pencil className="w-3.5 h-3.5 mr-1"/>Editar</Button>
                            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>duplicar(l)}><Copy className="w-3.5 h-3.5 mr-1"/>Duplicar</Button>
                            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>{ if(confirm('Excluir lançamento?')) deleteMutation.mutate(l.id); }}><Trash2 className="w-3.5 h-3.5 mr-1"/>Excluir</Button>
                          </div>
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