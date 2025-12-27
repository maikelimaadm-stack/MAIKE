import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function GruposAtividades() {
  const [selected, setSelected] = useState<string[]>([] as any);

  const { data: grupos = [], isLoading, refetch } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => base44.entities.GrupoAtividade.list("-updated_date"),
    initialData: [] as any[],
  });

  const filtered = useMemo(() => grupos, [grupos]);

  const toggleAll = (v: boolean) => setSelected(v ? filtered.map((g: any) => g.id) : []);
  const toggleOne = (id: string, v: boolean) => setSelected((prev) => (v ? [...prev, id] : prev.filter((x) => x !== id)));

  const excluir = async (id: string) => {
    if (!confirm("Excluir?")) return;
    await base44.entities.GrupoAtividade.delete(id);
    await refetch();
  };
  const excluirSelecionados = async () => {
    if (!confirm(`Excluir ${selected.length} registro(s)?`)) return;
    for (const id of selected) await base44.entities.GrupoAtividade.delete(id);
    setSelected([]);
    await refetch();
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-1">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Grupos de Atividades</h1>
          <p className="text-xs text-slate-600">Cadastro e organização dos grupos de tarefas</p>
        </div>
        <div className="flex gap-2">
          <Link to={createPageUrl("GrupoAtividadeForm")}>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              Novo
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">Grupos ({filtered.length})</div>
              <div className="flex gap-2">
                {selected.length > 0 && (
                  <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={excluirSelecionados}>
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
                      onCheckedChange={(v: any) => toggleAll(!!v)}
                    />
                  </TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Nome</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Ativo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Criado em</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Atualizado em</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black w-40">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-xs py-1 border border-gray-300 text-center">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-xs py-1 border border-gray-300 text-center">
                      Nenhum registro
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((g: any) => (
                    <TableRow key={g.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300 w-8">
                        <Checkbox
                          checked={selected.includes(g.id)}
                          onCheckedChange={(v: any) => toggleOne(g.id, !!v)}
                        />
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{g.nome_grupo}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{g.ativo ? "Sim" : "Não"}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        {new Date(g.created_date).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        {new Date(g.updated_date).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 w-40">
                        <div className="flex flex-wrap gap-1">
                          <Link to={createPageUrl(`GrupoAtividadeForm?id=${g.id}`)}>
                            <Button variant="outline" size="sm" className="h-8 text-xs">
                              Editar
                            </Button>
                          </Link>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => excluir(g.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" /> Excluir
                          </Button>
                        </div>
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