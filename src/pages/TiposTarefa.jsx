import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function TiposTarefa() {
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [grupoFiltro, setGrupoFiltro] = useState("todos");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { data: grupos = [] } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => base44.entities.GrupoAtividade.list(),
    initialData: [],
  });
  const { data: tipos = [], isLoading, refetch } = useQuery({
    queryKey: ["tipos-tarefa"],
    queryFn: () => base44.entities.TipoTarefa.list("-updated_date"),
    initialData: [],
  });

  const filtered = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return tipos.filter((tipo) => {
      if (grupoFiltro !== "todos" && tipo.grupo_atividade_id !== grupoFiltro) return false;
      if (!termo) return true;
      return [tipo.nome_tipo, tipo.grupo_atividade_nome, tipo.descricao].some((value) => (value || "").toLowerCase().includes(termo));
    });
  }, [tipos, search, grupoFiltro]);

  const toggleAll = (v) => setSelected(v ? filtered.map((t) => t.id) : []);
  const toggleOne = (id, v) => setSelected((prev) => (v ? [...prev, id] : prev.filter((x) => x !== id)));

  const excluir = async (id) => {
    await base44.entities.TipoTarefa.delete(id);
    await refetch();
  };
  const excluirSelecionados = async () => {
    for (const id of selected) await base44.entities.TipoTarefa.delete(id);
    setSelected([]);
    await refetch();
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-1">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Tipos de Tarefa</h1>
          <p className="text-xs text-slate-600">Modelos e regras para lançamentos</p>
        </div>
        <div className="flex gap-2">
          <Link to={createPageUrl("TipoTarefaForm")}>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5" />
              Novo
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs pl-8" placeholder="Tipo, grupo ou descrição" />
              </div>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Grupo</Label>
              <Select value={grupoFiltro} onValueChange={setGrupoFiltro}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {grupos.map((grupo) => <SelectItem key={grupo.id} value={grupo.id} className="text-xs">{grupo.nome_grupo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end md:col-span-1">
              <Button variant="outline" size="sm" className="h-8 text-xs w-full" onClick={() => { setSearch(""); setGrupoFiltro("todos"); }}>Limpar Filtros</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">Tipos ({filtered.length})</div>
              <div className="flex gap-2">
                {selected.length > 0 && (
                  <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => setBulkDeleteOpen(true)}>
                    Excluir Selecionados
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black w-8">
                    <Checkbox
                      checked={selected.length === filtered.length && filtered.length > 0}
                      onCheckedChange={(v) => toggleAll(!!v)}
                    />
                  </TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-center w-8"></TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Grupo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Ativo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Criado em</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Atualizado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-xs py-1 border border-gray-300 text-center">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-xs py-1 border border-gray-300 text-center">
                      Nenhum registro
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((t) => (
                    <TableRow key={t.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300 w-8">
                        <Checkbox
                          checked={selected.includes(t.id)}
                          onCheckedChange={(v) => toggleOne(t.id, !!v)}
                        />
                      </TableCell>
                      <TableCell className="text-center text-xs py-1 border border-gray-300 w-12">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem asChild className="text-xs">
                              <Link to={createPageUrl(`TipoTarefaForm?id=${t.id}`)}>Editar</Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDeleteConfirmId(t.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{t.nome_tipo}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        {t.grupo_atividade_nome || grupos.find((g) => g.id === t.grupo_atividade_id)?.nome_grupo || "-"}
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{t.ativo ? "Sim" : "Não"}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        {new Date(t.created_date).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        {new Date(t.updated_date).toLocaleString("pt-BR")}
                      </TableCell>
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