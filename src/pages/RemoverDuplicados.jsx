import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function RemoverDuplicados() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [removendo, setRemovendo] = useState(false);
  const [progresso, setProgresso] = useState({ total: 0, atual: 0 });

  const { data: pesagens = [], isLoading, refetch } = useQuery({
    queryKey: ['pesagens-duplicados', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PesagemIndividual.filter({
        empresa_id: empresaSelecionadaId,
        data_pesagem: "2025-12-02"
      });
      return all;
    },
    enabled: !!empresaSelecionadaId,
  });

  // Agrupar por numero_animal e identificar duplicados
  const analise = useMemo(() => {
    const grupos = {};
    pesagens.forEach(p => {
      const key = p.numero_animal;
      if (!grupos[key]) {
        grupos[key] = [];
      }
      grupos[key].push(p);
    });

    const duplicados = [];
    const unicos = [];

    Object.entries(grupos).forEach(([numero, registros]) => {
      if (registros.length > 1) {
        // Ordenar por created_date (manter o mais antigo)
        registros.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        unicos.push(registros[0]); // Manter o primeiro
        duplicados.push(...registros.slice(1)); // Marcar resto como duplicado
      } else {
        unicos.push(registros[0]);
      }
    });

    return {
      total: pesagens.length,
      unicos: unicos.length,
      duplicados,
      grupos
    };
  }, [pesagens]);

  const removerDuplicados = async () => {
    if (analise.duplicados.length === 0) {
      toast.info('Nenhum duplicado encontrado');
      return;
    }

    if (!confirm(`Confirma remover ${analise.duplicados.length} registros duplicados?`)) {
      return;
    }

    setRemovendo(true);
    setProgresso({ total: analise.duplicados.length, atual: 0 });

    let removidos = 0;
    let erros = 0;

    for (const dup of analise.duplicados) {
      try {
        await base44.entities.PesagemIndividual.delete(dup.id);
        removidos++;
      } catch (error) {
        console.error('Erro ao remover:', dup.id, error);
        erros++;
      }
      setProgresso(prev => ({ ...prev, atual: removidos + erros }));
    }

    setRemovendo(false);
    
    if (erros === 0) {
      toast.success(`${removidos} duplicados removidos com sucesso!`);
    } else {
      toast.warning(`${removidos} removidos, ${erros} erros`);
    }

    refetch();
    queryClient.invalidateQueries({ queryKey: ['pesagens-individuais'] });
  };

  const formatarData = (dataString) => {
    if (!dataString) return '--';
    try {
      return new Date(dataString).toLocaleString('pt-BR');
    } catch { return '--'; }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Remover Duplicados - 02/12/2025</h1>
          <p className="text-sm text-slate-500">Ferramenta para limpar pesagens duplicadas</p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>Atualizar</Button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-slate-700">{analise.total}</div>
            <div className="text-xs text-slate-500">Total de Registros</div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50">
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-emerald-600" />
            <div className="text-3xl font-bold text-emerald-700">{analise.unicos}</div>
            <div className="text-xs text-emerald-600">Animais Únicos</div>
          </CardContent>
        </Card>
        <Card className="bg-red-50">
          <CardContent className="p-4 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-1 text-red-600" />
            <div className="text-3xl font-bold text-red-700">{analise.duplicados.length}</div>
            <div className="text-xs text-red-600">Duplicados a Remover</div>
          </CardContent>
        </Card>
      </div>

      {/* Botão de Ação */}
      {analise.duplicados.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-red-800">
                  {analise.duplicados.length} registros duplicados encontrados
                </h3>
                <p className="text-sm text-red-600">
                  Será mantido o primeiro registro de cada animal (mais antigo)
                </p>
              </div>
              <Button 
                onClick={removerDuplicados} 
                disabled={removendo}
                className="bg-red-600 hover:bg-red-700"
              >
                {removendo ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Removendo {progresso.atual}/{progresso.total}
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Remover Todos Duplicados
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de Duplicados */}
      {analise.duplicados.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Registros que serão removidos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-white">
                  <TableRow>
                    <TableHead className="text-xs">ID</TableHead>
                    <TableHead className="text-xs">Animal</TableHead>
                    <TableHead className="text-xs">Peso</TableHead>
                    <TableHead className="text-xs">Lote</TableHead>
                    <TableHead className="text-xs">Criado em</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analise.duplicados.slice(0, 100).map((dup) => (
                    <TableRow key={dup.id} className="bg-red-50/50">
                      <TableCell className="text-xs font-mono">{dup.id.slice(-8)}</TableCell>
                      <TableCell className="text-xs font-medium">{dup.numero_animal}</TableCell>
                      <TableCell className="text-xs">{dup.peso} kg</TableCell>
                      <TableCell className="text-xs">{dup.nome_lote}</TableCell>
                      <TableCell className="text-xs">{formatarData(dup.created_date)}</TableCell>
                      <TableCell>
                        <Badge variant="destructive" className="text-[10px]">Duplicado</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {analise.duplicados.length > 100 && (
                <div className="p-2 text-center text-xs text-slate-500">
                  Mostrando 100 de {analise.duplicados.length} duplicados
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="text-center py-8">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400" />
          <p className="text-sm text-slate-500 mt-2">Carregando pesagens...</p>
        </div>
      )}

      {!isLoading && analise.duplicados.length === 0 && (
        <Card className="bg-emerald-50">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-600" />
            <h3 className="font-semibold text-emerald-800">Nenhum duplicado encontrado!</h3>
            <p className="text-sm text-emerald-600">Todos os {analise.unicos} registros são únicos.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}