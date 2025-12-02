import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Save, Trash2, Edit2, RefreshCw, Settings, WifiOff, Wifi, Plus, Download, ChevronRight, MoreVertical, Search, X, ArrowUpDown, ArrowUp, ArrowDown, Database, SlidersHorizontal, ArrowLeft } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// IndexedDB imports
import {
  initDB,
  savePesagemOffline,
  getPendingPesagens,
  deletePendingPesagem,
  cachePesagens,
  getCachedPesagens,
  saveApartacaoOffline,
  cacheApartacoes,
  getCachedApartacoes,
  saveLoteOffline,
  cacheLotes,
  getCachedLotes,
  getPendingCounts,
} from "../components/offline/IndexedDBManager";
import { syncAll, addSyncListener } from "../components/offline/SyncManager";
import OfflineSyncIndicator from "../components/offline/OfflineSyncIndicator";

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '--/--/----';
    return format(date, "dd/MM/yyyy", { locale: ptBR });
  } catch { return '--/--/----'; }
};

// Definição de todas as colunas disponíveis
const TODAS_COLUNAS = [
  { id: 'numero_registro', label: 'Nº', default: true },
  { id: 'numero_animal', label: 'Identificação', default: true },
  { id: 'peso', label: 'Peso', default: true },
  { id: 'data_pesagem', label: 'Data', default: true },
  { id: 'sexo', label: 'Sexo', default: true },
  { id: 'raca', label: 'Raça', default: true },
  { id: 'marca', label: 'Marca', default: true },
  { id: 'nome_apartacao', label: 'Apartação', default: true },
  { id: 'nome_lote', label: 'Lote', default: true },
  { id: 'observacao', label: 'Observação', default: false },
  { id: 'peso_anterior', label: 'Peso Anterior', default: false },
  { id: 'ganho', label: 'Ganho', default: false },
  { id: 'gmd', label: 'GMD', default: false },
  { id: 'dias', label: 'Dias', default: false },
];

export default function LancamentoPesagensIndividuais() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // Estado de conexão
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbReady, setDbReady] = useState(false);

  // Dados em cache (offline-first)
  const [pesagens, setPesagens] = useState([]);
  const [apartacoes, setApartacoes] = useState([]);
  const [lotesApartacao, setLotesApartacao] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // CONTROLE DE MODO: listagem ou lançamento
  const [showForm, setShowForm] = useState(false);
  const [editingPesagem, setEditingPesagem] = useState(null);

  // Campo de pesquisa e filtro de data
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroData, setFiltroData] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Ordenação
  const [sortColumn, setSortColumn] = useState("created_date");
  const [sortDirection, setSortDirection] = useState("desc");

  // Colunas visíveis
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('pesagens_colunas_visiveis');
    if (saved) return JSON.parse(saved);
    return TODAS_COLUNAS.filter(c => c.default).map(c => c.id);
  });

  // Dialog
  const [showApartacoesDialog, setShowApartacoesDialog] = useState(false);
  const [showColunasDialog, setShowColunasDialog] = useState(false);

  // Estado para pesagens pendentes do IndexedDB
  const [pendingPesagensDB, setPendingPesagensDB] = useState([]);

  // ========== OFFLINE FIRST - INICIALIZAR IndexedDB E CARREGAR DADOS ==========
  useEffect(() => {
    const init = async () => {
      try {
        await initDB();
        setDbReady(true);
        await loadAllData();
      } catch (error) {
        console.error('Erro ao inicializar IndexedDB:', error);
        setDbReady(false);
        await loadAllData();
      }
    };
    
    init();
    
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Conexão restaurada!");
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning("Modo offline ativado");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribe = addSyncListener((event) => {
      if (event.type === 'complete') {
        loadAllData();
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [empresaSelecionadaId]);

  // Salvar colunas visíveis no localStorage
  useEffect(() => {
    localStorage.setItem('pesagens_colunas_visiveis', JSON.stringify(colunasVisiveis));
  }, [colunasVisiveis]);

  const loadAllData = async () => {
    setIsLoading(true);
    
    try {
      if (dbReady) {
        const [cachedPesagensDB, cachedApartacoesDB, cachedLotesDB] = await Promise.all([
          getCachedPesagens(empresaSelecionadaId),
          getCachedApartacoes(empresaSelecionadaId),
          getCachedLotes(empresaSelecionadaId),
        ]);
        
        setPesagens(cachedPesagensDB);
        setApartacoes(cachedApartacoesDB);
        setLotesApartacao(cachedLotesDB);
      } else {
        const cachedPesagens = JSON.parse(localStorage.getItem('offline_pesagens_individuais') || '[]');
        const cachedApartacoes = JSON.parse(localStorage.getItem('offline_apartacoes') || '[]');
        const cachedLotes = JSON.parse(localStorage.getItem('offline_lotes_apartacao') || '[]');
        
        setPesagens(cachedPesagens.filter(p => p.empresa_id === empresaSelecionadaId));
        setApartacoes(cachedApartacoes.filter(a => a.empresa_id === empresaSelecionadaId));
        setLotesApartacao(cachedLotes.filter(l => l.empresa_id === empresaSelecionadaId));
      }
      
      await updatePendingCount();
      setIsLoading(false);

      if (navigator.onLine) {
        const [allPesagens, allApartacoes, allLotes] = await Promise.all([
          base44.entities.PesagemIndividual.list('-data_pesagem'),
          base44.entities.Apartacao.list(),
          base44.entities.LoteApartacao.list(),
        ]);

        const pesagensEmpresa = allPesagens.filter(p => p.empresa_id === empresaSelecionadaId);
        const apartacoesEmpresa = allApartacoes.filter(a => a.empresa_id === empresaSelecionadaId);
        const lotesEmpresa = allLotes.filter(l => l.empresa_id === empresaSelecionadaId);

        if (dbReady) {
          await Promise.all([
            cachePesagens(pesagensEmpresa),
            cacheApartacoes(apartacoesEmpresa),
            cacheLotes(lotesEmpresa),
          ]);
        }

        setPesagens(pesagensEmpresa);
        setApartacoes(apartacoesEmpresa);
        setLotesApartacao(lotesEmpresa);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      setIsLoading(false);
    }
  };

  const updatePendingCount = async () => {
    try {
      if (dbReady) {
        const counts = await getPendingCounts();
        setPendingCount(counts.total);
      } else {
        const pending = JSON.parse(localStorage.getItem('pending_pesagens_individuais') || '[]');
        setPendingCount(pending.length);
      }
    } catch (error) {
      console.error('Erro ao atualizar contagem de pendentes:', error);
    }
  };

  // Carregar pesagens pendentes do IndexedDB
  useEffect(() => {
    const loadPending = async () => {
      if (dbReady) {
        try {
          const pending = await getPendingPesagens(empresaSelecionadaId);
          setPendingPesagensDB(pending);
        } catch (error) {
          console.error('Erro ao carregar pendentes:', error);
        }
      }
    };
    loadPending();
  }, [dbReady, empresaSelecionadaId, pendingCount]);

  // ========== SINCRONIZAÇÃO ==========
  const handleSyncAll = async () => {
    if (!navigator.onLine) {
      toast.error("Sem conexão");
      return;
    }

    setIsSyncing(true);
    
    try {
      const result = await syncAll(empresaSelecionadaId);
      
      if (result.success) {
        await loadAllData();
      } else if (result.message) {
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Erro na sincronização:', error);
      toast.error('Erro na sincronização');
    } finally {
      setIsSyncing(false);
    }
  };

  // ========== PESAGENS DO DIA + PENDENTES + FILTRO + ORDENAÇÃO ==========
  const pesagensFiltradas = useMemo(() => {
    const pendentes = pendingPesagensDB
      .filter(p => p.data_pesagem === filtroData)
      .map((p, idx) => ({ ...p, _numero_registro: `P${idx + 1}` }));
    
    const sincronizadas = pesagens
      .filter(p => p.data_pesagem === filtroData)
      .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0))
      .map((p, idx) => ({ ...p, _numero_registro: idx + 1 }));
    
    let resultado = [...pendentes, ...sincronizadas];
    
    if (searchTerm.trim()) {
      const termo = searchTerm.toLowerCase().trim();
      resultado = resultado.filter(p => 
        p.numero_animal?.toLowerCase().includes(termo) ||
        p.nome_lote?.toLowerCase().includes(termo) ||
        p.nome_apartacao?.toLowerCase().includes(termo) ||
        p.raca?.toLowerCase().includes(termo) ||
        p.marca?.toLowerCase().includes(termo)
      );
    }

    resultado.sort((a, b) => {
      let valA, valB;
      switch (sortColumn) {
        case 'numero_animal':
          valA = a.numero_animal || '';
          valB = b.numero_animal || '';
          break;
        case 'peso':
          valA = a.peso || 0;
          valB = b.peso || 0;
          break;
        case 'sexo':
          valA = a.sexo || '';
          valB = b.sexo || '';
          break;
        case 'raca':
          valA = a.raca || '';
          valB = b.raca || '';
          break;
        case 'marca':
          valA = a.marca || '';
          valB = b.marca || '';
          break;
        case 'nome_apartacao':
          valA = a.nome_apartacao || '';
          valB = b.nome_apartacao || '';
          break;
        case 'nome_lote':
          valA = a.nome_lote || '';
          valB = b.nome_lote || '';
          break;
        case 'numero_registro':
          const numA = typeof a._numero_registro === 'string' ? -1000 + parseInt(a._numero_registro.replace('P', '')) : a._numero_registro;
          const numB = typeof b._numero_registro === 'string' ? -1000 + parseInt(b._numero_registro.replace('P', '')) : b._numero_registro;
          valA = numA;
          valB = numB;
          break;
        case 'created_date':
        default:
          valA = new Date(a.created_date || 0);
          valB = new Date(b.created_date || 0);
          break;
      }
      
      if (typeof valA === 'string') {
        return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDirection === 'asc' ? valA - valB : valB - valA;
    });
    
    return resultado;
  }, [pesagens, filtroData, pendingPesagensDB, empresaSelecionadaId, searchTerm, sortColumn, sortDirection]);

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ column }) => {
    if (sortColumn !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  // ========== ESTATÍSTICAS DO DIA ==========
  const estatisticas = useMemo(() => {
    const total = pesagensFiltradas.length;
    const machos = pesagensFiltradas.filter(p => p.sexo === 'M').length;
    const femeas = pesagensFiltradas.filter(p => p.sexo === 'F').length;
    const pesoMedio = total > 0 ? pesagensFiltradas.reduce((s, p) => s + (p.peso || 0), 0) / total : 0;
    return { total, machos, femeas, pesoMedio };
  }, [pesagensFiltradas]);

  // ========== EXCLUIR PESAGEM ==========
  const handleExcluir = async (pesagem) => {
    if (pesagem._offlineId) {
      if (dbReady) {
        await deletePendingPesagem(pesagem._offlineId);
        const pending = await getPendingPesagens(empresaSelecionadaId);
        setPendingPesagensDB(pending);
      } else {
        const pending = JSON.parse(localStorage.getItem('pending_pesagens_individuais') || '[]');
        const updated = pending.filter(p => p._offlineId !== pesagem._offlineId);
        localStorage.setItem('pending_pesagens_individuais', JSON.stringify(updated));
      }
      await updatePendingCount();
      toast.success('Removido');
    } else if (navigator.onLine) {
      await base44.entities.PesagemIndividual.delete(pesagem.id);
      toast.success('Excluído');
      await loadAllData();
    } else {
      toast.error('Exclusão não disponível offline');
    }
  };

  // ========== EDITAR PESAGEM ==========
  const handleEditar = (p) => {
    if (p._offlineId) {
      toast.error('Edição de pendentes não disponível');
      return;
    }
    setEditingPesagem(p);
    setShowForm(true);
  };

  // ========== NOVO LANÇAMENTO ==========
  const handleNovoLancamento = () => {
    setEditingPesagem(null);
    setShowForm(true);
  };

  // ========== VOLTAR PARA LISTAGEM ==========
  const handleVoltar = () => {
    setEditingPesagem(null);
    setShowForm(false);
    loadAllData();
  };

  // ========== EXPORTAR EXCEL ==========
  const exportarExcel = () => {
    const headers = ['Identificação', 'Peso', 'Data', 'Sexo', 'Raça', 'Marca', 'Apartação', 'Lote'];
    const rows = pesagensFiltradas.map(p => [
      p.numero_animal,
      p.peso,
      formatarData(p.data_pesagem),
      p.sexo || '',
      p.raca || '',
      p.marca || '',
      p.nome_apartacao || '',
      p.nome_lote || ''
    ]);
    
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pesagens_${filtroData}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exportado!');
  };

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => 
      prev.includes(colunaId) 
        ? prev.filter(c => c !== colunaId)
        : [...prev, colunaId]
    );
  };

  const renderCellValue = (p, colId) => {
    switch(colId) {
      case 'numero_registro': return p._numero_registro;
      case 'numero_animal': return (
        <>
          {p.numero_animal}
          {p._offlineId && <Badge variant="outline" className="ml-1 text-[8px] bg-amber-100 text-amber-700">P</Badge>}
        </>
      );
      case 'peso': return p.peso;
      case 'data_pesagem': return formatarData(p.data_pesagem);
      case 'sexo': return p.sexo || '-';
      case 'raca': return p.raca || '-';
      case 'marca': return p.marca || '-';
      case 'nome_apartacao': return p.nome_apartacao || '-';
      case 'nome_lote': return p.nome_lote || '-';
      case 'observacao': return p.observacao || '-';
      case 'peso_anterior': return p.peso_anterior || '-';
      case 'ganho': return p.ganho ? p.ganho.toFixed(2) : '-';
      case 'gmd': return p.gmd ? p.gmd.toFixed(3) : '-';
      case 'dias': return p.dias || '-';
      default: return '-';
    }
  };

  // ========== RENDER ==========
  if (showForm) {
    return (
      <FormularioPesagem
        editingPesagem={editingPesagem}
        apartacoes={apartacoes}
        lotesApartacao={lotesApartacao}
        pesagens={pesagens}
        pendingPesagensDB={pendingPesagensDB}
        empresaId={empresaSelecionadaId}
        dbReady={dbReady}
        onVoltar={handleVoltar}
        onSave={async () => {
          await loadAllData();
          await updatePendingCount();
          const pending = await getPendingPesagens(empresaSelecionadaId);
          setPendingPesagensDB(pending);
        }}
      />
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Pesagens Individuais</h1>
          <p className="text-xs text-slate-600">Lançamento e gestão de pesagens</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOnline ? (
            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
              <Wifi className="w-3 h-3 mr-1" />Online
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
              <WifiOff className="w-3 h-3 mr-1" />Offline
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge className="text-[10px] bg-blue-500">{pendingCount} pendente(s)</Badge>
          )}
          {dbReady && (
            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
              <Database className="w-3 h-3 mr-1" />Persistente
            </Badge>
          )}
          {pendingCount > 0 && isOnline && (
            <Button variant="outline" size="sm" onClick={handleSyncAll} disabled={isSyncing} className="h-8 text-xs">
              <RefreshCw className={`w-3 h-3 mr-1 ${isSyncing ? 'animate-spin' : ''}`} />
              Sincronizar
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowApartacoesDialog(true)} className="h-8 text-xs">
            <Settings className="w-3 h-3 mr-1" />
            Apartações
          </Button>
          <Button onClick={handleNovoLancamento} size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-1" />
            Novo Lançamento
          </Button>
        </div>
      </div>

      {/* FILTROS */}
      <Card className="shadow-sm">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Data</Label>
              <Input 
                type="date" 
                value={filtroData} 
                onChange={(e) => setFiltroData(e.target.value)} 
                className="h-8 text-xs w-36"
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className="text-xs font-medium">Pesquisar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-slate-400" />
                <Input 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Animal, lote, raça..."
                  className="h-8 text-xs pl-7"
                />
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2"
                  >
                    <X className="w-3 h-3 text-slate-400 hover:text-slate-600" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <Button variant="outline" size="sm" onClick={() => setShowColunasDialog(true)} className="h-8 text-xs">
                <SlidersHorizontal className="w-3 h-3 mr-1" />
                Colunas
              </Button>
              <Button variant="outline" size="sm" onClick={exportarExcel} className="h-8 text-xs">
                <Download className="w-3 h-3 mr-1" />
                Exportar
              </Button>
              <Button variant="outline" size="sm" onClick={() => loadAllData()} className="h-8 text-xs">
                <RefreshCw className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TABELA DE PESAGENS */}
      <Card className="shadow-sm">
        <CardHeader className="py-2 px-3 bg-slate-50 border-b">
          <CardTitle className="text-xs font-semibold">
            Pesagens do Dia ({estatisticas.total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[500px]">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100">
                <TableRow>
                  <TableHead className="text-xs w-10">Ações</TableHead>
                  {TODAS_COLUNAS.filter(c => colunasVisiveis.includes(c.id)).map(col => (
                    <TableHead 
                      key={col.id}
                      className="text-xs cursor-pointer hover:bg-slate-200 select-none"
                      onClick={() => handleSort(col.id)}
                    >
                      <div className="flex items-center">
                        {col.label} <SortIcon column={col.id} />
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={colunasVisiveis.length + 1} className="text-center py-4 text-xs">Carregando...</TableCell></TableRow>
                ) : pesagensFiltradas.length === 0 ? (
                  <TableRow><TableCell colSpan={colunasVisiveis.length + 1} className="text-center py-4 text-xs text-slate-400">Nenhuma pesagem encontrada</TableCell></TableRow>
                ) : (
                  pesagensFiltradas.map((p) => (
                    <TableRow key={p.id || p._offlineId} className={p._offlineId ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                      <TableCell className="text-xs">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handleEditar(p)} disabled={!!p._offlineId}>
                              <Edit2 className="w-3 h-3 mr-2" />Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExcluir(p)} className="text-red-600">
                              <Trash2 className="w-3 h-3 mr-2" />Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      {TODAS_COLUNAS.filter(c => colunasVisiveis.includes(c.id)).map(col => (
                        <TableCell key={col.id} className="text-xs">
                          {renderCellValue(p, col.id)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* RODAPÉ COM ESTATÍSTICAS */}
      <div className="flex items-center justify-between bg-white rounded px-3 py-2 shadow-sm">
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Total</span>
            <span className="font-bold text-lg">{estatisticas.total}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Machos</span>
            <span className="font-bold text-lg">{estatisticas.machos}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Fêmeas</span>
            <span className="font-bold text-lg">{estatisticas.femeas}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Peso Médio</span>
            <span className="font-bold text-lg">{estatisticas.pesoMedio.toFixed(2)} kg</span>
          </div>
        </div>
      </div>

      {/* DIALOG COLUNAS */}
      <Dialog open={showColunasDialog} onOpenChange={setShowColunasDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {TODAS_COLUNAS.map(col => (
              <div key={col.id} className="flex items-center gap-2">
                <Checkbox 
                  id={`col-${col.id}`}
                  checked={colunasVisiveis.includes(col.id)}
                  onCheckedChange={() => toggleColuna(col.id)}
                />
                <label htmlFor={`col-${col.id}`} className="text-xs cursor-pointer">{col.label}</label>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG APARTAÇÕES/LOTES */}
      <GerenciarApartacoesDialog 
        open={showApartacoesDialog} 
        onOpenChange={setShowApartacoesDialog}
        empresaId={empresaSelecionadaId}
        apartacoes={apartacoes}
        lotes={lotesApartacao}
        pesagens={pesagens}
        onRefresh={loadAllData}
        dbReady={dbReady}
      />

      {/* INDICADOR DE SINCRONIZAÇÃO OFFLINE */}
      <OfflineSyncIndicator 
        empresaId={empresaSelecionadaId}
        onSyncComplete={loadAllData}
      />
    </div>
  );
}

// ========== COMPONENTE FORMULÁRIO DE PESAGEM ==========
function FormularioPesagem({ 
  editingPesagem, 
  apartacoes, 
  lotesApartacao, 
  pesagens, 
  pendingPesagensDB,
  empresaId, 
  dbReady, 
  onVoltar, 
  onSave 
}) {
  const numeroInputRef = useRef(null);
  const pesoInputRef = useRef(null);

  const [dataPesagem, setDataPesagem] = useState(editingPesagem?.data_pesagem || format(new Date(), 'yyyy-MM-dd'));
  const [numeroAnimal, setNumeroAnimal] = useState(editingPesagem?.numero_animal || "");
  const [peso, setPeso] = useState(editingPesagem?.peso ? String(editingPesagem.peso) : "");
  const [sexo, setSexo] = useState(editingPesagem?.sexo || "M");
  const [raca, setRaca] = useState(editingPesagem?.raca || "Nelore");
  const [marca, setMarca] = useState(editingPesagem?.marca || "");
  const [observacao, setObservacao] = useState(editingPesagem?.observacao || "");
  const [apartacaoSelecionada, setApartacaoSelecionada] = useState(editingPesagem?.apartacao_id || "");
  const [loteTransferencia, setLoteTransferencia] = useState(editingPesagem?.lote_id || "");
  const [isSaving, setIsSaving] = useState(false);
  
  const [fixarSexo, setFixarSexo] = useState(true);
  const [fixarRaca, setFixarRaca] = useState(true);
  const [fixarMarca, setFixarMarca] = useState(false);

  const lotesApartacaoAtual = useMemo(() => {
    if (!apartacaoSelecionada) return [];
    return lotesApartacao.filter(l => l.apartacao_id === apartacaoSelecionada);
  }, [apartacaoSelecionada, lotesApartacao]);

  const getLoteAutomatico = (pesoNum) => {
    if (!apartacaoSelecionada || !pesoNum) return null;
    const lote = lotesApartacaoAtual.find(l => 
      pesoNum >= l.peso_minimo && pesoNum <= l.peso_maximo && !l.fechado
    );
    return lote;
  };

  const pesagensDoDia = useMemo(() => {
    return [
      ...pesagens.filter(p => p.data_pesagem === dataPesagem),
      ...pendingPesagensDB.filter(p => p.data_pesagem === dataPesagem)
    ];
  }, [pesagens, pendingPesagensDB, dataPesagem]);

  const handleSalvar = async () => {
    if (!dataPesagem) { 
      toast.error("Campo obrigatório: Data da Pesagem"); 
      return; 
    }
    if (!numeroAnimal?.trim()) { 
      toast.error("Campo obrigatório: Nº Identificação"); 
      numeroInputRef.current?.focus();
      return; 
    }
    if (!peso || isNaN(parseFloat(peso)) || parseFloat(peso) <= 0) { 
      toast.error("Campo obrigatório: Peso (deve ser maior que zero)"); 
      pesoInputRef.current?.focus();
      return; 
    }

    if (!editingPesagem) {
      const duplicado = pesagensDoDia.find(p => p.numero_animal === numeroAnimal.trim());
      if (duplicado) { 
        toast.error("Animal já pesado hoje! Nº: " + numeroAnimal); 
        return; 
      }
    }

    setIsSaving(true);

    const pesoNum = parseFloat(peso);
    
    const historicoAnimal = pesagens
      .filter(p => p.numero_animal === numeroAnimal.trim() && p.data_pesagem < dataPesagem)
      .sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));

    let dataAnterior = null, pesoAnterior = null, dias = null, ganho = null, gmd = null;
    if (historicoAnimal.length > 0 && historicoAnimal[0].peso) {
      const ultimo = historicoAnimal[0];
      dataAnterior = ultimo.data_pesagem;
      pesoAnterior = ultimo.peso;
      dias = Math.floor((new Date(dataPesagem) - new Date(dataAnterior)) / (1000 * 60 * 60 * 24));
      ganho = pesoNum - pesoAnterior;
      gmd = dias > 0 ? parseFloat((ganho / dias).toFixed(3)) : 0;
    }

    let loteId = null, nomeLote = null, apartacaoId = null, nomeApartacao = null;
    
    if (loteTransferencia) {
      const lote = lotesApartacaoAtual.find(l => l.id === loteTransferencia);
      if (lote) {
        loteId = lote.id;
        nomeLote = lote.nome_lote;
        apartacaoId = apartacaoSelecionada;
        nomeApartacao = apartacoes.find(a => a.id === apartacaoSelecionada)?.nome_apartacao || "";
      }
    } else if (apartacaoSelecionada) {
      const loteAuto = getLoteAutomatico(pesoNum);
      if (loteAuto) {
        loteId = loteAuto.id;
        nomeLote = loteAuto.nome_lote;
        apartacaoId = apartacaoSelecionada;
        nomeApartacao = apartacoes.find(a => a.id === apartacaoSelecionada)?.nome_apartacao || "";
      }
    }

    const data = {
      empresa_id: empresaId,
      data_pesagem: dataPesagem,
      numero_animal: numeroAnimal.trim(),
      sexo: sexo || null,
      raca: raca || null,
      marca: marca || null,
      peso: pesoNum,
      observacao: observacao || null,
      apartacao_id: apartacaoId,
      nome_apartacao: nomeApartacao,
      lote_id: loteId,
      nome_lote: nomeLote,
      data_anterior: dataAnterior,
      peso_anterior: pesoAnterior,
      dias, ganho: ganho ? parseFloat(ganho.toFixed(2)) : null, gmd,
    };

    try {
      if (navigator.onLine && !editingPesagem) {
        await base44.entities.PesagemIndividual.create(data);
        toast.success('Salvo!');
      } else if (navigator.onLine && editingPesagem) {
        await base44.entities.PesagemIndividual.update(editingPesagem.id, data);
        toast.success('Atualizado!');
      } else {
        if (dbReady) {
          await savePesagemOffline(data);
        } else {
          const pending = JSON.parse(localStorage.getItem('pending_pesagens_individuais') || '[]');
          pending.push({
            ...data,
            _offlineId: Date.now(),
            _offlineTimestamp: new Date().toISOString()
          });
          localStorage.setItem('pending_pesagens_individuais', JSON.stringify(pending));
        }
        toast.success('Salvo offline!');
      }

      await onSave();

      // Limpar formulário para novo lançamento
      if (!editingPesagem) {
        setNumeroAnimal("");
        setPeso("");
        if (!fixarSexo) setSexo("M");
        if (!fixarRaca) setRaca("Nelore");
        if (!fixarMarca) setMarca("");
        setObservacao("");
        setLoteTransferencia("");
        setTimeout(() => numeroInputRef.current?.focus(), 50);
      } else {
        onVoltar();
      }
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e, nextAction) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nextAction === 'salvar') {
        handleSalvar();
      } else {
        nextAction?.current?.focus();
      }
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {editingPesagem ? 'Editar Pesagem' : 'Novo Lançamento'}
          </h1>
          <p className="text-xs text-slate-600">Preencha os dados da pesagem</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onVoltar} className="h-8 text-xs">
            <ArrowLeft className="w-3 h-3 mr-1" />
            Voltar
          </Button>
        </div>
      </div>

      {/* FORMULÁRIO */}
      <Card className="shadow-sm">
        <CardHeader className="py-2 px-3 bg-white border-b">
          <CardTitle className="text-sm font-semibold">Dados da Pesagem</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {/* Data Pesagem */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Data Pesagem <span className="text-red-500">*</span></Label>
              <Input 
                type="date" 
                value={dataPesagem} 
                onChange={(e) => setDataPesagem(e.target.value)} 
                className="h-9 text-sm"
              />
            </div>
            
            {/* Nº Identificação */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Nº Ident./Nome <span className="text-red-500">*</span></Label>
              <Input 
                ref={numeroInputRef}
                value={numeroAnimal} 
                onChange={(e) => setNumeroAnimal(e.target.value)} 
                onKeyDown={(e) => handleKeyDown(e, pesoInputRef)}
                className="h-9 text-sm font-bold border-2 border-slate-300 focus:border-emerald-500"
                autoFocus
                placeholder="Ex: 1234"
              />
            </div>
            
            {/* Peso */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Peso (kg) <span className="text-red-500">*</span></Label>
              <Input 
                ref={pesoInputRef}
                type="number"
                value={peso} 
                onChange={(e) => setPeso(e.target.value)} 
                onKeyDown={(e) => handleKeyDown(e, 'salvar')}
                className="h-9 text-sm font-bold border-2 border-slate-300 focus:border-emerald-500"
                placeholder="Ex: 320"
              />
            </div>
            
            {/* Sexo */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium">Sexo</Label>
                <div className="flex items-center gap-1">
                  <Checkbox 
                    id="fixarSexo" 
                    checked={fixarSexo} 
                    onCheckedChange={setFixarSexo}
                    className="h-3 w-3"
                  />
                  <label htmlFor="fixarSexo" className="text-[10px] text-slate-500">Fixar</label>
                </div>
              </div>
              <Select value={sexo} onValueChange={setSexo} disabled={fixarSexo && sexo}>
                <SelectTrigger className={`h-9 text-sm ${fixarSexo ? 'bg-slate-100' : ''}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">Macho</SelectItem>
                  <SelectItem value="F">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Raça */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium">Raça</Label>
                <div className="flex items-center gap-1">
                  <Checkbox 
                    id="fixarRaca" 
                    checked={fixarRaca} 
                    onCheckedChange={setFixarRaca}
                    className="h-3 w-3"
                  />
                  <label htmlFor="fixarRaca" className="text-[10px] text-slate-500">Fixar</label>
                </div>
              </div>
              <Input 
                value={raca} 
                onChange={(e) => setRaca(e.target.value)} 
                className={`h-9 text-sm ${fixarRaca ? 'bg-slate-100' : ''}`}
                placeholder="Nelore"
                disabled={fixarRaca && raca}
              />
            </div>

            {/* Marca */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium">Marca</Label>
                <div className="flex items-center gap-1">
                  <Checkbox 
                    id="fixarMarca" 
                    checked={fixarMarca} 
                    onCheckedChange={setFixarMarca}
                    className="h-3 w-3"
                  />
                  <label htmlFor="fixarMarca" className="text-[10px] text-slate-500">Fixar</label>
                </div>
              </div>
              <Input 
                value={marca} 
                onChange={(e) => setMarca(e.target.value)} 
                className={`h-9 text-sm ${fixarMarca ? 'bg-slate-100' : ''}`}
                placeholder="Ex: ABC"
                disabled={fixarMarca && marca}
              />
            </div>
          </div>
          
          {/* Linha 2: Apartação, Lote, Observação */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Apartação</Label>
              <Select value={apartacaoSelecionada} onValueChange={(v) => { setApartacaoSelecionada(v); setLoteTransferencia(""); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Nenhuma</SelectItem>
                  {apartacoes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome_apartacao}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Lote (Transferência Manual)</Label>
              <Select value={loteTransferencia} onValueChange={setLoteTransferencia} disabled={!apartacaoSelecionada}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Automático" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Automático</SelectItem>
                  {lotesApartacaoAtual.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.nome_lote} ({l.peso_minimo}-{l.peso_maximo}kg)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Observação</Label>
              <Input 
                value={observacao} 
                onChange={(e) => setObservacao(e.target.value)} 
                className="h-9 text-sm"
                placeholder="Observações..."
              />
            </div>
          </div>

          {/* Indicador de lote automático */}
          {peso && apartacaoSelecionada && !loteTransferencia && (
            <div className="mt-4 text-sm font-semibold text-orange-600 bg-orange-50 px-3 py-2 rounded border border-orange-200">
              <ChevronRight className="w-4 h-4 inline mr-1" />
              Lote Automático: {getLoteAutomatico(parseFloat(peso))?.nome_lote || 'Não encontrado para este peso'}
            </div>
          )}
          
          {/* Botões */}
          <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
            <Button variant="outline" onClick={onVoltar} className="h-9 text-xs">
              Cancelar
            </Button>
            <Button onClick={handleSalvar} disabled={isSaving} className="h-9 text-xs bg-slate-700 hover:bg-slate-800">
              <Save className="w-4 h-4 mr-1" />
              {isSaving ? 'Salvando...' : (editingPesagem ? 'Atualizar' : 'Salvar')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ========== DIALOG PARA GERENCIAR APARTAÇÕES E LOTES ==========
function GerenciarApartacoesDialog({ open, onOpenChange, empresaId, apartacoes, lotes, pesagens, onRefresh, dbReady }) {
  const [tab, setTab] = useState('apartacoes');
  const [isSaving, setIsSaving] = useState(false);
  
  const [nomeApartacao, setNomeApartacao] = useState("");
  const [editingApartacaoId, setEditingApartacaoId] = useState(null);
  
  const [apartacaoIdLote, setApartacaoIdLote] = useState("");
  const [nomeLote, setNomeLote] = useState("");
  const [qtdMaxima, setQtdMaxima] = useState("500");
  const [pesoMinimo, setPesoMinimo] = useState("");
  const [pesoMaximo, setPesoMaximo] = useState("");
  const [editingLoteId, setEditingLoteId] = useState(null);

  const lotesFiltrados = useMemo(() => {
    if (!apartacaoIdLote) return lotes;
    return lotes.filter(l => l.apartacao_id === apartacaoIdLote);
  }, [lotes, apartacaoIdLote]);

  const salvarApartacao = async () => {
    if (!nomeApartacao.trim()) { 
      toast.error("Nome obrigatório"); 
      return; 
    }

    const nomeNormalizado = nomeApartacao.trim().toUpperCase();
    const duplicado = apartacoes.find(a => 
      a.nome_apartacao.toUpperCase() === nomeNormalizado && 
      a.id !== editingApartacaoId
    );
    if (duplicado) {
      toast.error("Já existe uma apartação com esse nome!");
      return;
    }

    setIsSaving(true);
    const data = { empresa_id: empresaId, nome_apartacao: nomeApartacao.trim() };

    try {
      if (navigator.onLine) {
        if (editingApartacaoId) {
          await base44.entities.Apartacao.update(editingApartacaoId, data);
          toast.success("Apartação atualizada!");
        } else {
          await base44.entities.Apartacao.create(data);
          toast.success("Apartação criada!");
        }
        onRefresh();
      } else {
        const novaApartacao = { ...data, id: `offline_${Date.now()}`, created_date: new Date().toISOString() };
        
        if (dbReady) {
          if (editingApartacaoId) {
            await saveApartacaoOffline('update', { id: editingApartacaoId, ...data });
          } else {
            await saveApartacaoOffline('create', novaApartacao);
          }
        } else {
          const pending = JSON.parse(localStorage.getItem('pending_apartacoes') || '[]');
          pending.push({ 
            action: editingApartacaoId ? 'update' : 'create', 
            id: editingApartacaoId,
            data: editingApartacaoId ? data : novaApartacao, 
            timestamp: Date.now() 
          });
          localStorage.setItem('pending_apartacoes', JSON.stringify(pending));
        }

        toast.success(editingApartacaoId ? "Apartação atualizada offline!" : "Apartação criada offline!");
        onRefresh();
      }
      setNomeApartacao(""); 
      setEditingApartacaoId(null);
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const salvarLote = async () => {
    if (!apartacaoIdLote) { 
      toast.error("Selecione uma apartação"); 
      return; 
    }
    if (!nomeLote.trim()) { 
      toast.error("Nome do lote obrigatório"); 
      return; 
    }
    if (!pesoMinimo || !pesoMaximo) { 
      toast.error("Peso mínimo e máximo obrigatórios"); 
      return; 
    }
    if (parseFloat(pesoMinimo) > parseFloat(pesoMaximo)) {
      toast.error("Peso mínimo não pode ser maior que o máximo");
      return;
    }

    const nomeNormalizado = nomeLote.trim().toUpperCase();
    const duplicado = lotes.find(l => 
      l.apartacao_id === apartacaoIdLote &&
      l.nome_lote.toUpperCase() === nomeNormalizado && 
      l.id !== editingLoteId
    );
    if (duplicado) {
      toast.error("Já existe um lote com esse nome nesta apartação!");
      return;
    }

    setIsSaving(true);
    const apt = apartacoes.find(a => a.id === apartacaoIdLote);
    const data = {
      empresa_id: empresaId,
      apartacao_id: apartacaoIdLote,
      nome_apartacao: apt?.nome_apartacao || "",
      nome_lote: nomeLote.trim(),
      quantidade_maxima: parseInt(qtdMaxima) || 500,
      peso_minimo: parseFloat(pesoMinimo),
      peso_maximo: parseFloat(pesoMaximo),
      fechado: false,
    };

    try {
      if (navigator.onLine) {
        if (editingLoteId) {
          await base44.entities.LoteApartacao.update(editingLoteId, data);
          toast.success("Lote atualizado!");
        } else {
          await base44.entities.LoteApartacao.create(data);
          toast.success("Lote criado!");
        }
        onRefresh();
      } else {
        const novoLote = { ...data, id: `offline_${Date.now()}`, created_date: new Date().toISOString() };
        
        if (dbReady) {
          if (editingLoteId) {
            await saveLoteOffline('update', { id: editingLoteId, ...data });
          } else {
            await saveLoteOffline('create', novoLote);
          }
        } else {
          const pending = JSON.parse(localStorage.getItem('pending_lotes') || '[]');
          pending.push({ 
            action: editingLoteId ? 'update' : 'create', 
            id: editingLoteId,
            data: editingLoteId ? data : novoLote, 
            timestamp: Date.now() 
          });
          localStorage.setItem('pending_lotes', JSON.stringify(pending));
        }

        toast.success(editingLoteId ? "Lote atualizado offline!" : "Lote criado offline!");
        onRefresh();
      }
      setNomeLote(""); 
      setQtdMaxima("500"); 
      setPesoMinimo(""); 
      setPesoMaximo(""); 
      setEditingLoteId(null);
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const excluirApartacao = async (id) => {
    const pesagensVinculadas = pesagens.filter(p => p.apartacao_id === id);
    if (pesagensVinculadas.length > 0) {
      toast.error(`Não é possível excluir! Existem ${pesagensVinculadas.length} pesagens vinculadas.`);
      return;
    }

    if (!confirm("Excluir apartação e todos os lotes vinculados?")) return;

    if (navigator.onLine) {
      const lotesVinculados = lotes.filter(l => l.apartacao_id === id);
      for (const l of lotesVinculados) {
        await base44.entities.LoteApartacao.delete(l.id);
      }
      await base44.entities.Apartacao.delete(id);
      toast.success("Apartação excluída!");
      onRefresh();
    } else {
      if (dbReady && !id.startsWith('offline_')) {
        await saveApartacaoOffline('delete', { id });
      } else if (!dbReady && !id.startsWith('offline_')) {
        const pending = JSON.parse(localStorage.getItem('pending_apartacoes') || '[]');
        pending.push({ action: 'delete', id, timestamp: Date.now() });
        localStorage.setItem('pending_apartacoes', JSON.stringify(pending));
      }
      toast.success("Apartação excluída offline!");
      onRefresh();
    }
  };

  const excluirLote = async (id) => {
    const pesagensVinculadas = pesagens.filter(p => p.lote_id === id);
    if (pesagensVinculadas.length > 0) {
      toast.error(`Não é possível excluir! Existem ${pesagensVinculadas.length} pesagens vinculadas.`);
      return;
    }

    if (!confirm("Excluir lote?")) return;

    if (navigator.onLine) {
      await base44.entities.LoteApartacao.delete(id);
      toast.success("Lote excluído!");
      onRefresh();
    } else {
      if (dbReady && !id.startsWith('offline_')) {
        await saveLoteOffline('delete', { id });
      } else if (!dbReady && !id.startsWith('offline_')) {
        const pending = JSON.parse(localStorage.getItem('pending_lotes') || '[]');
        pending.push({ action: 'delete', id, timestamp: Date.now() });
        localStorage.setItem('pending_lotes', JSON.stringify(pending));
      }
      toast.success("Lote excluído offline!");
      onRefresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Gerenciar Apartações e Lotes</DialogTitle>
        </DialogHeader>
        
        <div className="flex gap-2 border-b pb-2">
          <Button variant={tab === 'apartacoes' ? 'default' : 'outline'} size="sm" onClick={() => setTab('apartacoes')} className="text-xs">Apartações</Button>
          <Button variant={tab === 'lotes' ? 'default' : 'outline'} size="sm" onClick={() => setTab('lotes')} className="text-xs">Lotes</Button>
        </div>

        <div className="flex-1 overflow-auto">
          {tab === 'apartacoes' ? (
            <div className="space-y-3">
              <div className="flex gap-2 items-end bg-slate-50 p-3 rounded">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Nome da Apartação</Label>
                  <Input 
                    value={nomeApartacao} 
                    onChange={(e) => setNomeApartacao(e.target.value)} 
                    className="h-9 text-sm" 
                    placeholder="Ex: ROTINA" 
                  />
                </div>
                <Button onClick={salvarApartacao} disabled={isSaving} size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700 text-xs">
                  {editingApartacaoId ? 'Atualizar' : 'Adicionar'}
                </Button>
                {editingApartacaoId && (
                  <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => { setEditingApartacaoId(null); setNomeApartacao(""); }}>
                    Cancelar
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nome</TableHead>
                    <TableHead className="text-xs text-center">Lotes</TableHead>
                    <TableHead className="text-xs text-center">Pesagens</TableHead>
                    <TableHead className="text-xs w-24">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apartacoes.map(a => {
                    const qtdLotes = lotes.filter(l => l.apartacao_id === a.id).length;
                    const qtdPesagens = pesagens.filter(p => p.apartacao_id === a.id).length;
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs font-medium">{a.nome_apartacao}</TableCell>
                        <TableCell className="text-xs text-center">{qtdLotes}</TableCell>
                        <TableCell className="text-xs text-center">
                          {qtdPesagens > 0 ? (
                            <Badge variant="outline" className="text-[10px]">{qtdPesagens}</Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                              setNomeApartacao(a.nome_apartacao); 
                              setEditingApartacaoId(a.id);
                            }}>
                              <Edit2 className="w-3 h-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-red-500" 
                              onClick={() => excluirApartacao(a.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {apartacoes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-xs text-slate-400 py-6">
                        Nenhuma apartação cadastrada
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-6 gap-2 items-end bg-slate-50 p-3 rounded">
                <div className="space-y-1">
                  <Label className="text-xs">Apartação</Label>
                  <Select value={apartacaoIdLote} onValueChange={setApartacaoIdLote}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {apartacoes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome_apartacao}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nome Lote</Label>
                  <Input value={nomeLote} onChange={(e) => setNomeLote(e.target.value)} className="h-9 text-xs" placeholder="Ex: BOIADA" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Qtd Máx</Label>
                  <Input type="number" value={qtdMaxima} onChange={(e) => setQtdMaxima(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso Mín</Label>
                  <Input type="number" value={pesoMinimo} onChange={(e) => setPesoMinimo(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso Máx</Label>
                  <Input type="number" value={pesoMaximo} onChange={(e) => setPesoMaximo(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="flex gap-1">
                  <Button onClick={salvarLote} disabled={isSaving} size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700 text-xs">
                    {editingLoteId ? 'Atualizar' : 'Adicionar'}
                  </Button>
                  {editingLoteId && (
                    <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => { 
                      setEditingLoteId(null); 
                      setNomeLote(""); 
                      setQtdMaxima("500"); 
                      setPesoMinimo(""); 
                      setPesoMaximo(""); 
                    }}>
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Apartação</TableHead>
                    <TableHead className="text-xs">Lote</TableHead>
                    <TableHead className="text-xs text-center">Qtd Máx</TableHead>
                    <TableHead className="text-xs text-center">Peso Mín</TableHead>
                    <TableHead className="text-xs text-center">Peso Máx</TableHead>
                    <TableHead className="text-xs text-center">Pesagens</TableHead>
                    <TableHead className="text-xs w-24">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lotesFiltrados.map(l => {
                    const qtdPesagens = pesagens.filter(p => p.lote_id === l.id).length;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">{l.nome_apartacao}</TableCell>
                        <TableCell className="text-xs font-medium">{l.nome_lote}</TableCell>
                        <TableCell className="text-xs text-center">{l.quantidade_maxima}</TableCell>
                        <TableCell className="text-xs text-center">{l.peso_minimo}</TableCell>
                        <TableCell className="text-xs text-center">{l.peso_maximo}</TableCell>
                        <TableCell className="text-xs text-center">
                          {qtdPesagens > 0 ? (
                            <Badge variant="outline" className="text-[10px]">{qtdPesagens}</Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                              setApartacaoIdLote(l.apartacao_id); 
                              setNomeLote(l.nome_lote);
                              setQtdMaxima(String(l.quantidade_maxima)); 
                              setPesoMinimo(String(l.peso_minimo));
                              setPesoMaximo(String(l.peso_maximo)); 
                              setEditingLoteId(l.id);
                            }}>
                              <Edit2 className="w-3 h-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-red-500" 
                              onClick={() => excluirLote(l.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {lotesFiltrados.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-xs text-slate-400 py-6">
                        {apartacaoIdLote ? 'Nenhum lote nesta apartação' : 'Selecione uma apartação ou cadastre lotes'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}