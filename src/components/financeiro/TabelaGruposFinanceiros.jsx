import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Edit, Trash2, Search, X, ChevronRight, ChevronDown } from "lucide-react";
import ConfirmDialog from "@/components/common/ConfirmDialog";

const CLASSIFICACAO_LABELS = {
  Direto: "Direto",
  Indireto: "Indireto",
  NaoAplicavel: "N/A",
};

const CLASSIFICACAO_COLORS = {
  Direto: "bg-blue-100 text-blue-800",
  Indireto: "bg-amber-100 text-amber-800",
  NaoAplicavel: "bg-slate-100 text-slate-600",
};

function buildTree(grupos) {
  const map = {};
  const roots = [];

  grupos.forEach(g => { map[g.id] = { ...g, children: [] }; });
  grupos.forEach(g => {
    if (g.grupo_pai_id && map[g.grupo_pai_id]) {
      map[g.grupo_pai_id].children.push(map[g.id]);
    } else {
      roots.push(map[g.id]);
    }
  });

  const sortFn = (a, b) => (a.ordem ?? 999) - (b.ordem ?? 999);
  const sortTree = (nodes) => {
    nodes.sort(sortFn);
    nodes.forEach(n => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

function flattenTree(nodes, depth = 0) {
  const result = [];
  nodes.forEach(node => {
    result.push({ ...node, _depth: depth });
    if (node.children?.length) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  });
  return result;
}

export default function TabelaGruposFinanceiros({ grupos, onEdit, onDelete, isLoading }) {
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [expanded, setExpanded] = useState({});

  const filtered = useMemo(() => {
    return grupos.filter(g => {
      if (filtroTipo !== "todos" && g.tipo !== filtroTipo) return false;
      if (filtroStatus === "ativos" && g.ativo === false) return false;
      if (filtroStatus === "inativos" && g.ativo !== false) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!(g.nome || "").toLowerCase().includes(s) && !(g.descricao || "").toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [grupos, search, filtroTipo, filtroStatus]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const flatRows = useMemo(() => {
    // Only include children if parent is expanded
    const flatten = (nodes, depth = 0) => {
      const result = [];
      nodes.forEach(node => {
        result.push({ ...node, _depth: depth });
        if (node.children?.length && expanded[node.id]) {
          result.push(...flatten(node.children, depth + 1));
        }
      });
      return result;
    };
    return flatten(tree);
  }, [tree, expanded]);

  const toggleExpand = (id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAll = (checked) => {
    setSelectedIds(checked ? flatRows.map(r => r.id) : []);
  };

  const toggleOne = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const clearFilters = () => {
    setSearch("");
    setFiltroTipo("todos");
    setFiltroStatus("todos");
  };

  return (
    <div className="space-y-1">
      {/* Filtros */}
      <Card className="shadow-sm">
        <CardContent className="p-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
            <div className="relative col-span-2 md:col-span-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="h-7 text-xs pl-7"
              />
            </div>
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos os Tipos</SelectItem>
                <SelectItem value="Despesa" className="text-xs">Despesa</SelectItem>
                <SelectItem value="Receita" className="text-xs">Receita</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos Status</SelectItem>
                <SelectItem value="ativos" className="text-xs">Ativos</SelectItem>
                <SelectItem value="inativos" className="text-xs">Inativos</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={clearFilters} className="h-7 text-xs">
              <X className="w-3 h-3 mr-1" /> Limpar
            </Button>
          </div>
          <div className="flex justify-between items-center mt-1.5">
            <span className="text-xs text-slate-500">{filtered.length} de {grupos.length} registros</span>
            {selectedIds.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    Ações ({selectedIds.length})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => setDeleteConfirm({ ids: selectedIds })} className="text-xs text-red-600">
                    <Trash2 className="w-3.5 h-3.5 mr-2" /> Excluir Selecionados
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-8 text-xs py-2 px-3">
                    <Checkbox
                      checked={flatRows.length > 0 && selectedIds.length === flatRows.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead className="text-xs py-2 px-3 font-bold">Nome</TableHead>
                  <TableHead className="text-xs py-2 px-3 font-bold">Tipo</TableHead>
                  <TableHead className="text-xs py-2 px-3 font-bold text-center">Ordem</TableHead>
                  <TableHead className="text-xs py-2 px-3 font-bold">Classif. Custo</TableHead>
                  <TableHead className="text-xs py-2 px-3 font-bold text-center">Lanç. Direto</TableHead>
                  <TableHead className="text-xs py-2 px-3 font-bold text-center">Ativo</TableHead>
                  <TableHead className="text-xs py-2 px-3 font-bold w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flatRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-xs text-slate-400">
                      {isLoading ? "Carregando..." : "Nenhum grupo encontrado"}
                    </TableCell>
                  </TableRow>
                ) : (
                  flatRows.map(row => {
                    const hasChildren = (row.children?.length || 0) > 0;
                    const isExpanded = expanded[row.id];

                    return (
                      <TableRow key={row.id} className="hover:bg-gray-50 border-b">
                        <TableCell className="text-xs py-2 px-3">
                          <Checkbox
                            checked={selectedIds.includes(row.id)}
                            onCheckedChange={() => toggleOne(row.id)}
                          />
                        </TableCell>
                        <TableCell className="text-xs py-2 px-3">
                          <div className="flex items-center" style={{ paddingLeft: `${row._depth * 20}px` }}>
                            {hasChildren ? (
                              <button onClick={() => toggleExpand(row.id)} className="mr-1 p-0.5 rounded hover:bg-slate-200">
                                {isExpanded ?
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> :
                                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                                }
                              </button>
                            ) : (
                              <span className="w-5" />
                            )}
                            <span className={`uppercase ${row.ativo === false ? 'text-slate-400 line-through' : 'text-slate-900 font-medium'}`}>
                              {row.nome}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs py-2 px-3">
                          <Badge variant="outline" className={`text-[10px] ${row.tipo === 'Despesa' ? 'border-red-300 text-red-700' : 'border-emerald-300 text-emerald-700'}`}>
                            {row.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs py-2 px-3 text-center font-mono">{row.ordem}</TableCell>
                        <TableCell className="text-xs py-2 px-3">
                          {row.classificacao_custo ? (
                            <Badge className={`text-[10px] ${CLASSIFICACAO_COLORS[row.classificacao_custo] || ''}`}>
                              {CLASSIFICACAO_LABELS[row.classificacao_custo] || row.classificacao_custo}
                            </Badge>
                          ) : (
                            <span className="text-slate-400 text-[10px]">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs py-2 px-3 text-center">
                          {row.permite_lancamento_direto ? (
                            <Badge className="text-[10px] bg-emerald-100 text-emerald-700">Sim</Badge>
                          ) : (
                            <span className="text-slate-400 text-[10px]">Não</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs py-2 px-3 text-center">
                          {row.ativo !== false ? (
                            <Badge className="text-[10px] bg-emerald-100 text-emerald-700">Ativo</Badge>
                          ) : (
                            <Badge className="text-[10px] bg-slate-100 text-slate-500">Inativo</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs py-2 px-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => onEdit(row)} className="text-xs">
                                <Edit className="w-3.5 h-3.5 mr-2" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDeleteConfirm({ ids: [row.id] })} className="text-xs text-red-600">
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Confirmar exclusão"
        description={deleteConfirm?.ids?.length > 1
          ? `Tem certeza que deseja excluir ${deleteConfirm.ids.length} grupos? Esta ação não pode ser desfeita.`
          : "Tem certeza que deseja excluir este grupo? Esta ação não pode ser desfeita."}
        onConfirm={() => {
          if (deleteConfirm?.ids) {
            deleteConfirm.ids.forEach(id => onDelete(id));
          }
          setDeleteConfirm(null);
          setSelectedIds([]);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </div>
  );
}