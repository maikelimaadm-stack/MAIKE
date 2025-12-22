import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuItem, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  Plus, Save, X, Pencil, Trash2, RefreshCw, Search,
  Filter, Copy, MoreVertical, Settings, GripVertical
} from "lucide-react";
import { toast } from "sonner";

/* =====================================================
   CONFIGURAÇÃO DE COLUNAS (PADRÃO DO SISTEMA)
===================================================== */
const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", fixo: true, default: true },
  { id: "status", label: "Status", default: true },
  { id: "urgencia", label: "Urgência / Nível", default: true },
  { id: "grupo", label: "Grupo", default: true },
  { id: "tipo", label: "Tipo", default: true },
  { id: "area", label: "Área", default: true },
  { id: "areaHa", label: "Área (ha)", default: false },
  { id: "capUa", label: "Cap. (UA)", default: false },
  { id: "responsavel", label: "Responsável", default: true },
  { id: "dataIni", label: "Data Inicial", default: true },
  { id: "dataFim", label: "Data Final", default: true },
  { id: "atrasada", label: "Atrasada?", default: true },
  { id: "acoes", label: "Ações", fixo: true, default: true },
];

export default function LancamentosTarefas() {
  const queryClient = useQueryClient();

  /* =====================================================
     ESTADO – LAYOUT (ORDEM + VISIBILIDADE)
  ===================================================== */
  const [showLayout, setShowLayout] = useState(false);

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("lanc_tarefas_colunas_ordem");
    return saved ? JSON.parse(saved) : COLUNAS_DISPONIVEIS.map(c => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("lanc_tarefas_colunas_visiveis");
    return saved
      ? JSON.parse(saved)
      : COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const toggleColuna = (id) => {
    const next = colunasVisiveis.includes(id)
      ? colunasVisiveis.filter(c => c !== id)
      : [...colunasVisiveis, id];

    setColunasVisiveis(next);
    localStorage.setItem("lanc_tarefas_colunas_visiveis", JSON.stringify(next));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setColunasOrdem(items);
    localStorage.setItem("lanc_tarefas_colunas_ordem", JSON.stringify(items));
  };

  const colunasOrdenadas = colunasOrdem
    .map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id))
    .filter(c => c && colunasVisiveis.includes(c.id));

  /* =====================================================
     DADOS
  ===================================================== */
  const { data: lancs = [], isLoading, refetch } = useQuery({
    queryKey: ["lancamentos-tarefa"],
    queryFn: () => base44.entities.LancamentoTarefa.list("-updated_date"),
    initialData: []
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    queryFn: () => base44.entities.AreaPastagem.list(),
    initialData: []
  });

  /* =====================================================
     SELEÇÃO
  ===================================================== */
  const [selecionados, setSelecionados] = useState([]);
  const allIds = useMemo(() => lancs.map(l => l.id), [lancs]);
  const todosMarcados = selecionados.length > 0 && selecionados.length === allIds.length;

  const alternarTodos = (v) => setSelecionados(v ? allIds : []);
  const alternarUm = (id, v) => setSelecionados(prev => v ? [...prev, id] : prev.filter(x => x !== id));

  /* =====================================================
     AÇÕES
  ===================================================== */
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.LancamentoTarefa.delete(id),
    onSuccess: () => {
      toast.success("Excluído");
      queryClient.invalidateQueries({ queryKey: ["lancamentos-tarefa"] });
    }
  });

  const duplicar = async (l) => {
    const copy = { ...l };
    delete copy.id;
    delete copy.created_date;
    delete copy.updated_date;
    copy.status_tarefa = "Planejada";
    await base44.entities.LancamentoTarefa.create(copy);
    toast.success("Duplicado");
    refetch();
  };

  /* =====================================================
     RENDER
  ===================================================== */
  return (
    <div className="p-4 space-y-3">

      {/* CABEÇALHO */}
      <Card>
        <CardContent className="p-3 flex justify-between items-center">
          <div>
            <div className="text-sm font-semibold">Lançamentos de Tarefas</div>
            <div className="text-xs text-slate-500">Gestão de atividades</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowLayout(true)}>
              <Settings className="w-3.5 h-3.5 mr-1" /> Layout
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5 mr-1" /> Lançar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* TABELA */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {colunasOrdenadas.map(col => {
                    if (col.id === "selecao") {
                      return (
                        <TableHead key="selecao" className="w-8">
                          <Checkbox checked={todosMarcados} onCheckedChange={alternarTodos} />
                        </TableHead>
                      );
                    }
                    return (
                      <TableHead key={col.id} className="text-xs font-bold">
                        {col.label}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={50} className="text-center text-xs py-4">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : lancs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={50} className="text-center text-xs py-4">
                      Nenhum registro
                    </TableCell>
                  </TableRow>
                ) : (
                  lancs.map(l => (
                    <TableRow key={l.id}>
                      {colunasOrdenadas.map(col => {
                        switch (col.id) {
                          case "selecao":
                            return (
                              <TableCell key="sel">
                                <Checkbox checked={selecionados.includes(l.id)} onCheckedChange={(v)=>alternarUm(l.id, v)} />
                              </TableCell>
                            );
                          case "status":
                            return <TableCell>{l.status_tarefa}</TableCell>;
                          case "urgencia":
                            return <TableCell>{l.urgencia} / {l.nivel_urgencia}</TableCell>;
                          case "grupo":
                            return <TableCell>{l.grupo_atividade_nome}</TableCell>;
                          case "tipo":
                            return <TableCell>{l.nome_tipo_tarefa}</TableCell>;
                          case "area":
                            return <TableCell>{l.area_pasto_nome || "-"}</TableCell>;
                          case "areaHa":
                            return <TableCell>{areas.find(a => a.id === l.area_pasto_id)?.tamanho_hectares ?? "-"}</TableCell>;
                          case "capUa":
                            return <TableCell>{areas.find(a => a.id === l.area_pasto_id)?.capacidade_maxima ?? "-"}</TableCell>;
                          case "responsavel":
                            return <TableCell>{l.responsavel_nome}</TableCell>;
                          case "dataIni":
                            return <TableCell>{l.data_inicial}</TableCell>;
                          case "dataFim":
                            return <TableCell>{l.data_final}</TableCell>;
                          case "atrasada":
                            return <TableCell>{l.atrasada ? "Sim" : "Não"}</TableCell>;
                          case "acoes":
                            return (
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                      <MoreVertical className="w-3.5 h-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={()=>duplicar(l)}>
                                      <Copy className="w-3.5 h-3.5 mr-2"/>Duplicar
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-red-600" onClick={()=>deleteMutation.mutate(l.id)}>
                                      <Trash2 className="w-3.5 h-3.5 mr-2"/>Excluir
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            );
                          default:
                            return <TableCell>-</TableCell>;
                        }
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* DIALOG LAYOUT */}
      <Dialog open={showLayout} onOpenChange={setShowLayout}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar Colunas</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold mb-2">Visibilidade</p>
              {COLUNAS_DISPONIVEIS.filter(c => !c.fixo).map(c => (
                <label key={c.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={colunasVisiveis.includes(c.id)} onChange={()=>toggleColuna(c.id)} />
                  {c.label}
                </label>
              ))}
            </div>

            <div className="border-t pt-2">
              <p className="text-xs font-semibold mb-2">Ordem</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="cols">
                  {(p) => (
                    <div ref={p.innerRef} {...p.droppableProps} className="space-y-1">
                      {colunasOrdem.map((id, idx) => {
                        const c = COLUNAS_DISPONIVEIS.find(x => x.id === id);
                        if (!c || c.fixo) return null;
                        return (
                          <Draggable key={id} draggableId={id} index={idx}>
                            {(p) => (
                              <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps}
                                className="flex items-center gap-2 border p-2 rounded text-xs">
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                {c.label}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {p.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={()=>setShowLayout(false)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
