import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Leaf, Tractor, Plus, MapPin, DollarSign, Edit2, Trash2,
  TrendingUp, Package, Calculator, ChevronUp, ChevronDown, History
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { toast } from "sonner";
import FormularioOperacao from "../operacoes/FormularioOperacao";
import FormularioControleArea from "../areas/FormularioControleArea";

export default function DetalhesArea({ area, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showOperacao, setShowOperacao] = useState(false);
  const [showControle, setShowControle] = useState(false);
  const [editingControle, setEditingControle] = useState(null);
  const [mainTab, setMainTab] = useState('lotes');
  const [subTab, setSubTab] = useState('resumo');
  const [sortField, setSortField] = useState('categoria');
  const [sortDir, setSortDir] = useState('asc');
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const queryClient = useQueryClient();

  // Buscar operações da área
  const { data: operacoes = [] } = useQuery({
    queryKey: ['operacoes-area', area.id],
    queryFn: async () => {
      const all = await base44.entities.OperacaoAgricola.list('-data_inicio');
      return all.filter(o => o.area_id === area.id);
    },
  });

  // Buscar controle da área
  const { data: controles = [] } = useQuery({
    queryKey: ['controle-area', area.id],
    queryFn: async () => {
      const all = await base44.entities.ControleArea.list('-created_date');
      return all.filter(c => c.area_id === area.id);
    },
  });

  // Buscar lotes na área
  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-area', area.id],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.area_atual_id === area.id && l.status === 'Ativo');
    },
  });

  const controleAtual = controles.length > 0 ? controles[0] : null;

  // Calcular métricas pecuárias
  const metricas = useMemo(() => {
    const areaTotal = area.tamanho_hectares || 0;
    const areaUtil = area.area_util_hectares || areaTotal;
    const diasPastejados = area.dias_pastejo || 0;
    
    const totalCabecas = lotes.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);
    
    // Calcular UA (Unidade Animal) = peso médio / 450kg
    const totalUA = lotes.reduce((sum, l) => {
      const cabecas = l.quantidade_cabecas || 0;
      const pesoMedio = l.peso_medio_kg || 450;
      return sum + (cabecas * pesoMedio / 450);
    }, 0);
    
    // Carga de lotação = UA total
    const cargaLotacao = totalUA;
    
    // Taxa de lotação = UA / ha útil
    const taxaLotacao = areaUtil > 0 ? totalUA / areaUtil : 0;

    return {
      areaTotal,
      areaUtil,
      diasPastejados,
      totalCabecas,
      totalUA,
      cargaLotacao,
      taxaLotacao
    };
  }, [area, lotes]);

  // Ordenar e paginar lotes
  const lotesSorted = useMemo(() => {
    const sorted = [...lotes].sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'categoria':
          valA = a.categoria || '';
          valB = b.categoria || '';
          break;
        case 'nome':
          valA = a.nome || '';
          valB = b.nome || '';
          break;
        case 'cabecas':
          valA = a.quantidade_cabecas || 0;
          valB = b.quantidade_cabecas || 0;
          break;
        case 'peso':
          valA = a.peso_medio_kg || 0;
          valB = b.peso_medio_kg || 0;
          break;
        default:
          valA = a.categoria || '';
          valB = b.categoria || '';
      }
      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });
    
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [lotes, sortField, sortDir, currentPage, pageSize]);

  const totalPages = Math.ceil(lotes.length / pageSize);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' 
      ? <ChevronUp className="w-3 h-3 text-emerald-600" />
      : <ChevronDown className="w-3 h-3 text-emerald-600" />;
  };

  // Totais para tabela
  const totais = useMemo(() => {
    return {
      cabecas: lotes.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0),
      ua: lotes.reduce((sum, l) => {
        const cabecas = l.quantidade_cabecas || 0;
        const peso = l.peso_medio_kg || 450;
        return sum + (cabecas * peso / 450);
      }, 0)
    };
  }, [lotes]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 max-h-[80vh]" translate="no">
      {/* Painel Esquerdo - Informações da Área */}
      <div className="w-full lg:w-64 flex-shrink-0 space-y-3">
        {/* Ações */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs flex-1" onClick={() => { setEditingControle(controleAtual); setShowControle(true); }}>
            Editar detalhes
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs flex-1">
            Editar área
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs text-red-600 hover:bg-red-50">
            Excluir
          </Button>
        </div>

        {/* Card Info Área */}
        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-start gap-3 mb-3">
            {area.icone_url ? (
              <img src={area.icone_url} alt="" className="w-10 h-10 object-contain" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Leaf className="w-5 h-5 text-emerald-600" />
              </div>
            )}
            <div>
              <div className="font-bold text-slate-900 text-sm">{area.nome}</div>
              <div className="text-xs text-slate-500">{area.tipo_pastagem || 'Pastejo'} / {area.forrageira || 'Natural Grasses'}</div>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Área total</span>
              <span className="font-semibold">{metricas.areaTotal} ha</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Área útil</span>
              <span className="font-semibold">{metricas.areaUtil} ha</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Dias pastejados</span>
              <span className="font-semibold">{metricas.diasPastejados} dias</span>
            </div>
          </div>
        </div>

        {/* Card Métricas Pecuárias */}
        <div className="border rounded-lg p-3 bg-white space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Bovinos</span>
            <span className="font-semibold">{metricas.totalCabecas.toLocaleString('pt-BR')} cabeça</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Carga de lotação</span>
            <span className="font-semibold">{metricas.cargaLotacao.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} UA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Taxa de lotação</span>
            <span className="font-semibold">{metricas.taxaLotacao.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} UA / ha</span>
          </div>
        </div>
      </div>

      {/* Painel Direito - Tabs */}
      <div className="flex-1 min-w-0">
        {/* Tabs Principais */}
        <Tabs value={mainTab} onValueChange={setMainTab} className="w-full">
          <div className="flex items-center justify-between mb-3">
            <TabsList className="h-9">
              <TabsTrigger value="lotes" className="text-xs px-4">Lotes</TabsTrigger>
              <TabsTrigger value="historico" className="text-xs px-4">Histórico</TabsTrigger>
            </TabsList>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1">
              <Plus className="w-3 h-3" />
              Criar registro de rebanho
            </Button>
          </div>

          <TabsContent value="lotes" className="mt-0">
            {/* Sub Tabs */}
            <Tabs value={subTab} onValueChange={setSubTab} className="w-full">
              <div className="flex items-center justify-between mb-3">
                <TabsList className="h-8 bg-slate-100">
                  <TabsTrigger value="resumo" className="text-xs px-3 h-7">Resumo</TabsTrigger>
                  <TabsTrigger value="lotes" className="text-xs px-3 h-7">Lotes</TabsTrigger>
                </TabsList>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <span>≡</span> Colunas ({6})
                </Button>
              </div>

              <TabsContent value="resumo" className="mt-0">
                {/* Resumo por categoria */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left p-2 font-medium text-slate-600">Categoria</th>
                        <th className="text-right p-2 font-medium text-slate-600">Cabeças</th>
                        <th className="text-right p-2 font-medium text-slate-600">UA</th>
                        <th className="text-right p-2 font-medium text-slate-600">Peso Médio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(
                        lotes.reduce((acc, l) => {
                          const cat = l.categoria || 'Sem categoria';
                          if (!acc[cat]) acc[cat] = { cabecas: 0, ua: 0, pesoTotal: 0 };
                          acc[cat].cabecas += l.quantidade_cabecas || 0;
                          const peso = l.peso_medio_kg || 450;
                          acc[cat].ua += (l.quantidade_cabecas || 0) * peso / 450;
                          acc[cat].pesoTotal += (l.quantidade_cabecas || 0) * peso;
                          return acc;
                        }, {})
                      ).map(([cat, dados]) => (
                        <tr key={cat} className="border-b hover:bg-slate-50">
                          <td className="p-2 font-medium">{cat}</td>
                          <td className="p-2 text-right">{dados.cabecas.toLocaleString('pt-BR')}</td>
                          <td className="p-2 text-right">{dados.ua.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                          <td className="p-2 text-right">{dados.cabecas > 0 ? (dados.pesoTotal / dados.cabecas).toFixed(0) : '-'} kg</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-100 font-semibold">
                      <tr>
                        <td className="p-2">TOTAL</td>
                        <td className="p-2 text-right">{totais.cabecas.toLocaleString('pt-BR')}</td>
                        <td className="p-2 text-right">{totais.ua.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                        <td className="p-2 text-right">-</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="lotes" className="mt-0">
                {/* Tabela de lotes detalhada */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="w-8 p-2">
                            <input type="checkbox" className="rounded" />
                          </th>
                          <th 
                            className="text-left p-2 font-medium text-slate-600 cursor-pointer hover:bg-slate-100"
                            onClick={() => handleSort('categoria')}
                          >
                            <div className="flex items-center gap-1">
                              CATEGORIA ANIMAL <SortIcon field="categoria" />
                            </div>
                          </th>
                          <th 
                            className="text-left p-2 font-medium text-slate-600 cursor-pointer hover:bg-slate-100"
                            onClick={() => handleSort('nome')}
                          >
                            <div className="flex items-center gap-1">
                              TAG DE MANEJO <SortIcon field="nome" />
                            </div>
                          </th>
                          <th className="text-left p-2 font-medium text-slate-600">COR DO BRINCO</th>
                          <th 
                            className="text-left p-2 font-medium text-slate-600 cursor-pointer hover:bg-slate-100"
                            onClick={() => handleSort('nome')}
                          >
                            <div className="flex items-center gap-1">
                              NOME DO LOTE <SortIcon field="nome" />
                            </div>
                          </th>
                          <th 
                            className="text-right p-2 font-medium text-slate-600 cursor-pointer hover:bg-slate-100"
                            onClick={() => handleSort('cabecas')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              CABEÇA <SortIcon field="cabecas" />
                            </div>
                          </th>
                          <th className="text-right p-2 font-medium text-slate-600">CARGA (UA)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lotesSorted.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-500">
                              Nenhum lote nesta área
                            </td>
                          </tr>
                        ) : lotesSorted.map(lote => {
                          const ua = (lote.quantidade_cabecas || 0) * (lote.peso_medio_kg || 450) / 450;
                          return (
                            <tr key={lote.id} className="border-b hover:bg-slate-50">
                              <td className="p-2">
                                <input type="checkbox" className="rounded" />
                              </td>
                              <td className="p-2">{lote.categoria || '-'}</td>
                              <td className="p-2">{lote.tag_manejo || '-'}</td>
                              <td className="p-2">
                                {lote.cor_brinco && (
                                  <Badge variant="outline" className="text-[10px]">
                                    <span className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: lote.cor_brinco_hex || '#666' }}></span>
                                    {lote.cor_brinco}
                                  </Badge>
                                )}
                              </td>
                              <td className="p-2 font-medium">{lote.nome}</td>
                              <td className="p-2 text-right font-semibold">{(lote.quantidade_cabecas || 0).toLocaleString('pt-BR')}</td>
                              <td className="p-2 text-right">{ua.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-100">
                        <tr className="text-[10px] text-slate-500">
                          <td colSpan={5} className="p-2">MÉD.</td>
                          <td className="p-2 text-right"></td>
                          <td className="p-2 text-right"></td>
                        </tr>
                        <tr className="font-semibold">
                          <td colSpan={5} className="p-2">TOTAL</td>
                          <td className="p-2 text-right">{totais.cabecas.toLocaleString('pt-BR')}</td>
                          <td className="p-2 text-right">{totais.ua.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Paginação */}
                  <div className="flex items-center justify-between p-2 border-t bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-7 w-7"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(p => p - 1)}
                      >
                        &lt;
                      </Button>
                      <Badge variant="default" className="bg-emerald-600 h-7 px-3">
                        {currentPage}
                      </Badge>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-7 w-7"
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage(p => p + 1)}
                      >
                        &gt;
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <span>Resultados por página</span>
                      <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                        <SelectTrigger className="h-7 w-16 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="25">25</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                          <SelectItem value="100">100</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="historico" className="mt-0">
            <div className="border rounded-lg p-6 text-center text-slate-500">
              <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Histórico de movimentações da área</p>
              <p className="text-xs">Em breve...</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialog Controle */}
      <Dialog open={showControle} onOpenChange={setShowControle}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingControle ? 'Editar Detalhes' : 'Registrar Cultura'} - {area.nome}</DialogTitle>
          </DialogHeader>
          <FormularioControleArea
            controle={editingControle || { area_id: area.id, area_nome: area.nome }}
            onSave={() => {
              setShowControle(false);
              queryClient.invalidateQueries({ queryKey: ['controle-area'] });
              toast.success('Dados salvos!');
            }}
            onCancel={() => setShowControle(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog Operação */}
      <Dialog open={showOperacao} onOpenChange={setShowOperacao}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Operação - {area.nome}</DialogTitle>
          </DialogHeader>
          <FormularioOperacao
            operacao={{ area_id: area.id, area_nome: area.nome }}
            onSave={() => {
              setShowOperacao(false);
              queryClient.invalidateQueries({ queryKey: ['operacoes-area'] });
              toast.success('Operação registrada!');
            }}
            onCancel={() => setShowOperacao(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}