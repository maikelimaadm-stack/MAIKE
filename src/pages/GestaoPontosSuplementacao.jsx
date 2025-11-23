import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Search, MapPin, Edit, Trash2, AlertCircle, TrendingUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioPontoSuplementacao from "../components/suplementacao/FormularioPontoSuplementacao";
import HistoricoSuplementacaoPonto from "../components/suplementacao/HistoricoSuplementacaoPonto";
import { toast } from "sonner";

export default function GestaoPontosSuplementacao() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingPonto, setEditingPonto] = useState(null);
  const [showHistorico, setShowHistorico] = useState(false);
  const [pontoSelecionado, setPontoSelecionado] = useState(null);
  const queryClient = useQueryClient();

  const { data: pontos = [], isLoading } = useQuery({
    queryKey: ['pontos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId)
        .sort((a, b) => a.nome_ponto.localeCompare(b.nome_ponto));
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: eventos = [] } = useQuery({
    queryKey: ['eventos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter(e => e.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const nextNumber = await getNextNumber();
      return base44.entities.PontoSuplementacao.create({
        ...data,
        numero_ponto: nextNumber
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pontos-suplementacao'] });
      toast.success('Ponto criado com sucesso');
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PontoSuplementacao.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pontos-suplementacao'] });
      toast.success('Ponto atualizado com sucesso');
      setShowForm(false);
      setEditingPonto(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PontoSuplementacao.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pontos-suplementacao'] });
      toast.success('Ponto excluído com sucesso');
    },
  });

  const getNextNumber = async () => {
    const all = await base44.entities.PontoSuplementacao.list();
    const pontosEmpresa = all.filter(p => p.empresa_id === empresaSelecionadaId);
    const maxNum = pontosEmpresa.reduce((max, p) => {
      const num = parseInt(p.numero_ponto) || 0;
      return num > max ? num : max;
    }, 0);
    return String(maxNum + 1).padStart(4, '0');
  };

  const handleSubmit = (data) => {
    if (editingPonto) {
      updateMutation.mutate({ id: editingPonto.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (ponto) => {
    setEditingPonto(ponto);
    setShowForm(true);
  };

  const handleDelete = (ponto) => {
    const eventosRelacionados = eventos.filter(e => e.ponto_suplementacao_id === ponto.id);
    if (eventosRelacionados.length > 0) {
      if (!confirm(`Este ponto possui ${eventosRelacionados.length} lançamentos. Deseja realmente excluir?`)) {
        return;
      }
    } else {
      if (!confirm(`Deseja excluir o ponto "${ponto.nome_ponto}"?`)) {
        return;
      }
    }
    deleteMutation.mutate(ponto.id);
  };

  const handleShowHistorico = (ponto) => {
    setPontoSelecionado(ponto);
    setShowHistorico(true);
  };

  const pontosFiltrados = pontos.filter(p =>
    p.nome_ponto.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.tipo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.area_vinculada_nome?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calcular alertas
  const pontosComAlerta = pontos.filter(p => {
    if (p.status !== 'Ativo') return false;
    const eventosP = eventos.filter(e => e.ponto_suplementacao_id === p.id);
    if (eventosP.length === 0) return true;
    
    const ultimoEvento = eventosP.sort((a, b) => 
      new Date(b.data_lancamento) - new Date(a.data_lancamento)
    )[0];
    
    const diasSemLancamento = Math.floor(
      (new Date() - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24)
    );
    
    return diasSemLancamento > (p.alerta_sem_lancamento_dias || 10);
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestão de Pontos de Suplementação</h1>
          <p className="text-sm text-slate-600 mt-1">Gerencie os pontos de fornecimento de suplementos</p>
        </div>
        <Button
          onClick={() => {
            setEditingPonto(null);
            setShowForm(true);
          }}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Ponto
        </Button>
      </div>

      {pontosComAlerta.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-amber-900">
                  {pontosComAlerta.length} ponto(s) sem lançamento há mais tempo que o esperado
                </div>
                <div className="text-xs text-amber-700 mt-1">
                  {pontosComAlerta.map(p => p.nome_ponto).join(', ')}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Pontos Cadastrados ({pontos.length})</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar pontos..."
                className="pl-9 h-9 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="text-center py-12 text-sm text-slate-500">Carregando...</div>
          ) : pontosFiltrados.length === 0 ? (
            <div className="text-center py-12">
              <MapPin className="w-12 h-12 mx-auto text-slate-300 mb-3" />
              <p className="text-sm text-slate-500">
                {searchTerm ? 'Nenhum ponto encontrado' : 'Nenhum ponto cadastrado'}
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {pontosFiltrados.map((ponto) => {
                const eventosP = eventos.filter(e => e.ponto_suplementacao_id === ponto.id);
                const ultimoEvento = eventosP.length > 0 
                  ? eventosP.sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0]
                  : null;
                
                const diasSemLancamento = ultimoEvento
                  ? Math.floor((new Date() - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24))
                  : null;

                const totalFornecido = eventosP.reduce((sum, e) => sum + e.quantidade_total_kg, 0);
                const temAlerta = ponto.status === 'Ativo' && 
                  (diasSemLancamento === null || diasSemLancamento > (ponto.alerta_sem_lancamento_dias || 10));

                return (
                  <div
                    key={ponto.id}
                    className={`border rounded-lg p-4 bg-white hover:shadow-md transition-shadow ${
                      temAlerta ? 'border-amber-300' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-slate-900">{ponto.nome_ponto}</h3>
                          <Badge variant={ponto.status === 'Ativo' ? 'default' : 'secondary'} className="text-xs">
                            {ponto.status}
                          </Badge>
                          {temAlerta && (
                            <Badge className="bg-amber-100 text-amber-800 text-xs">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Alerta
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div>
                            <span className="font-medium">Tipo:</span> {ponto.tipo}
                          </div>
                          <div>
                            <span className="font-medium">Área:</span> {ponto.area_vinculada_nome}
                          </div>
                          {ponto.produto_padrao && (
                            <div>
                              <span className="font-medium">Produto:</span> {ponto.produto_padrao}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleShowHistorico(ponto)}
                          className="h-8 w-8"
                        >
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(ponto)}
                          className="h-8 w-8"
                        >
                          <Edit className="w-4 h-4 text-slate-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(ponto)}
                          className="h-8 w-8"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-3 border-t">
                      <div className="text-center">
                        <div className="text-xs text-slate-600">Lançamentos</div>
                        <div className="text-lg font-bold text-slate-900">{eventosP.length}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-600">Total Fornecido</div>
                        <div className="text-lg font-bold text-slate-900">{totalFornecido.toFixed(0)} kg</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-600">Último Lançamento</div>
                        <div className="text-lg font-bold text-slate-900">
                          {diasSemLancamento !== null ? `${diasSemLancamento}d` : '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={(open) => {
        setShowForm(open);
        if (!open) setEditingPonto(null);
      }}>
        <DialogContent className="max-w-2xl">
          <FormularioPontoSuplementacao
            ponto={editingPonto}
            onSubmit={handleSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditingPonto(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {pontoSelecionado && (
            <HistoricoSuplementacaoPonto
              pontoId={pontoSelecionado.id}
              pontoNome={pontoSelecionado.nome_ponto}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}