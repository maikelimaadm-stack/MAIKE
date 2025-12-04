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
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical } from "lucide-react";
import { Scale, Save, Trash2, Edit2, RefreshCw, Settings, WifiOff, Wifi, Plus, Download, ChevronRight, MoreVertical, Search, X, ArrowUpDown, ArrowUp, ArrowDown, Database } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  cacheApartacoes,
  getCachedApartacoes,
  cacheLotes,
  getCachedLotes,
  getPendingCounts,
  clearAllPending,
  putItem,
  deleteItem,
  clearStore,
  getAllItems,
  STORES_NAMES,
} from "../components/offline/IndexedDBManager";
import { syncAll, addSyncListener } from "../components/offline/SyncManager";
import OfflineSyncIndicator from "../components/offline/OfflineSyncIndicator";
import SyncProgressDialog from "../components/offline/SyncProgressDialog";
import ComboboxComNovo from "../components/pecuaria/ComboboxComNovo";

// ========== COMPONENTE RESUMO DE LOTES ==========
function ResumoLotes({ apartacaoSelecionada, apartacoes, lotesApartacaoAtual, pesagens, pesagensDia, pendingPesagensDB, dataPesagem }) {
  const [modoVisualizacao, setModoVisualizacao] = useState('dia'); // 'dia' ou 'total'

  const resumoLotes = useMemo(() => {
    if (!apartacaoSelecionada || !lotesApartacaoAtual || lotesApartacaoAtual.length === 0) return [];
    
    let todasPesagensApartacao;
    if (modoVisualizacao === 'dia') {
      // Apenas pesagens do dia
      todasPesagensApartacao = [
        ...(pesagensDia || []).filter(p => p.apartacao_id === apartacaoSelecionada),
      ];
    } else {
      // Todas as pesagens da apartação
      todasPesagensApartacao = [
        ...(pesagens || []).filter(p => p.apartacao_id === apartacaoSelecionada),
        ...(pendingPesagensDB || []).filter(p => p.apartacao_id === apartacaoSelecionada)
      ];
    }

    return lotesApartacaoAtual.map(lote => {
      const animaisLote = todasPesagensApartacao.filter(p => p.lote_id === lote.id);
      const qtd = animaisLote.length;
      const pesoTotal = animaisLote.reduce((s, p) => s + (p.peso || 0), 0);
      const pesoMedio = qtd > 0 ? pesoTotal / qtd : 0;
      
      return {
        ...lote,
        quantidade_atual: qtd,
        peso_medio: pesoMedio,
      };
    }).sort((a, b) => (a.nome_lote || '').localeCompare(b.nome_lote || ''));
  }, [apartacaoSelecionada, lotesApartacaoAtual, pesagens, pesagensDia, pendingPesagensDB, modoVisualizacao]);

  // Sempre renderizar o componente
  return (
    <div className="xl:col-span-1 lg:col-span-1">
      <Card className="shadow-sm sticky top-2">
        <CardHeader className="py-2 px-3 bg-slate-200 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold">Distribuição de Lotes</CardTitle>
          {apartacaoSelecionada && resumoLotes.length > 0 && (
            <div className="flex gap-1">
              <Button 
                variant={modoVisualizacao === 'dia' ? 'default' : 'outline'} 
                size="sm" 
                className="h-6 text-[10px] px-2"
                onClick={() => setModoVisualizacao('dia')}
              >
                Dia
              </Button>
              <Button 
                variant={modoVisualizacao === 'total' ? 'default' : 'outline'} 
                size="sm" 
                className="h-6 text-[10px] px-2"
                onClick={() => setModoVisualizacao('total')}
              >
                Total
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-2">
          {apartacaoSelecionada && resumoLotes.length > 0 ? (
            <>
              <div className="text-center mb-2 py-2 bg-emerald-50 rounded">
                <span className="text-lg font-bold text-emerald-800">
                  {apartacoes?.find(a => a.id === apartacaoSelecionada)?.nome_apartacao || 'Apartação'}
                </span>
                <div className="text-[10px] text-emerald-600">
                  {modoVisualizacao === 'dia' ? `Pesagens do dia (${formatarData(dataPesagem)})` : 'Todas as pesagens'}
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Lote</TableHead>
                    <TableHead className="text-[10px] text-right">Qtd.</TableHead>
                    <TableHead className="text-[10px] text-right">Média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumoLotes.map(lote => {
                    const cheio = lote.fechado || (lote.quantidade_atual >= (lote.quantidade_maxima || 999999));
                    return (
                      <TableRow key={lote.id} className={cheio ? "bg-red-50" : ""}>
                        <TableCell className={`text-xs font-medium ${cheio ? "text-red-700" : ""}`}>
                          {lote.nome_lote} {cheio && "[FECHADO]"}
                        </TableCell>
                        <TableCell className={`text-xs text-right ${cheio ? "text-red-700 font-bold" : ""}`}>
                          {lote.quantidade_atual}/{lote.quantidade_maxima || 0}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">{lote.peso_medio?.toFixed(2) || '0.00'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="mt-2 pt-2 border-t text-xs text-center text-slate-500">
                Qtd. Lançada: {resumoLotes.reduce((s, l) => s + (l.quantidade_atual || 0), 0)}
              </div>
            </>
          ) : (
            <div className="text-center py-6 text-slate-400 text-xs">
              {apartacaoSelecionada 
                ? 'Nenhum lote cadastrado nesta apartação' 
                : 'Selecione uma apartação para ver os lotes'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    // Evitar problema de fuso horário: usar apenas a parte da data
    const dataStr = dataString.split('T')[0];
    const [ano, mes, dia] = dataStr.split('-');
    if (!ano || !mes || !dia) return '--/--/----';
    return `${dia}/${mes}/${ano}`;
  } catch { return '--/--/----'; }
};

export default function LancamentoPesagensIndividuais() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  
  // Verificar se veio para editar
  const urlParams = new URLSearchParams(window.location.search);
  const editarId = urlParams.get('editar');

  // Estado de conexão
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  
  // Estado do dialog de sincronização
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncState, setSyncState] = useState({
    isRunning: false,
    currentStep: 0,
    totalSteps: 0,
    currentItem: '',
    items: [],
    completed: false,
    errors: 0
  });

  // Refs para navegação rápida
  const numeroInputRef = useRef(null);
  const pesoInputRef = useRef(null);

  // Dados em cache (offline-first)
  const [pesagens, setPesagens] = useState([]);
  const [apartacoes, setApartacoes] = useState([]);
  const [lotesApartacao, setLotesApartacao] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Estado do formulário
  const [editingId, setEditingId] = useState(null);
  const [editingOfflineId, setEditingOfflineId] = useState(null);
  const [dataPesagem, setDataPesagem] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [numeroAnimal, setNumeroAnimal] = useState("");
  const [peso, setPeso] = useState("");
  const [sexo, setSexo] = useState("M");
  const [raca, setRaca] = useState("Nelore");
  const [era, setEra] = useState("");
  const [marca, setMarca] = useState("");
  const [observacao, setObservacao] = useState("");
  const [apartacaoSelecionada, setApartacaoSelecionada] = useState("");
  const [loteTransferencia, setLoteTransferencia] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  
  // Checkboxes para fixar valores (quando marcado, campo fica desabilitado)
  const [fixarSexo, setFixarSexo] = useState(true);
  const [fixarRaca, setFixarRaca] = useState(true);
  const [fixarEra, setFixarEra] = useState(false);
  const [fixarMarca, setFixarMarca] = useState(false);
  
  // Tipo de Manejo: 'cadastro' ou 'pesagens'
  const [tipoManejo, setTipoManejo] = useState('cadastro');

  // Campo de pesquisa
  const [searchTerm, setSearchTerm] = useState("");

  // Avisos na tela
  const [avisoTela, setAvisoTela] = useState(null); // {tipo: 'erro'|'alerta'|'info', mensagem: string}

  // Ordenação
  const [sortColumn, setSortColumn] = useState("created_date");
  const [sortDirection, setSortDirection] = useState("desc");

  // Dialog
  const [showApartacoesDialog, setShowApartacoesDialog] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);

  // Configuração de colunas
  const COLUNAS_DISPONIVEIS = [
    { id: 'acoes', label: 'Ações', default: true, fixo: true },
    { id: 'numero_registro', label: 'Nº', default: true },
    { id: 'numero_animal', label: 'Identificação', default: true },
    { id: 'peso', label: 'Peso', default: true },
    { id: 'data_pesagem', label: 'Data', default: true },
    { id: 'sexo', label: 'Sexo', default: true },
    { id: 'raca', label: 'Raça', default: true },
    { id: 'era', label: 'Era', default: true },
    { id: 'marca', label: 'Marca', default: true },
    { id: 'nome_apartacao', label: 'Apartação', default: true },
    { id: 'nome_lote', label: 'Lote', default: true },
    { id: 'data_anterior', label: 'Data Anterior', default: false },
    { id: 'peso_anterior', label: 'Peso Anterior', default: false },
    { id: 'dias', label: 'Dias', default: false },
    { id: 'ganho', label: 'Ganho', default: false },
    { id: 'gmd', label: 'GMD', default: true },
    { id: 'observacao', label: 'Observação', default: false },
  ];

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem('colunas_ordem_lancamento_pesagens');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map(c => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_visiveis_lancamento_pesagens');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter(id => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novasColunas);
    localStorage.setItem('colunas_visiveis_lancamento_pesagens', JSON.stringify(novasColunas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_lancamento_pesagens', JSON.stringify(items));
  };

  const colunasOrdenadas = colunasOrdem
    .map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id))
    .filter(c => c && colunasVisiveis.includes(c.id));

  // ========== CARREGAR REGISTRO PARA EDIÇÃO ==========
  useEffect(() => {
    const carregarParaEdicao = async () => {
      if (editarId && pesagens.length > 0) {
        const pesagem = pesagens.find(p => p.id === editarId);
        if (pesagem) {
          setEditingId(pesagem.id);
          setDataPesagem(pesagem.data_pesagem || format(new Date(), 'yyyy-MM-dd'));
          setNumeroAnimal(pesagem.numero_animal || "");
          setPeso(String(pesagem.peso || ""));
          setSexo(pesagem.sexo || "M");
          setRaca(pesagem.raca || "Nelore");
          setEra(pesagem.era || "");
          setMarca(pesagem.marca || "");
          setObservacao(pesagem.observacao || "");
          if (pesagem.apartacao_id) setApartacaoSelecionada(pesagem.apartacao_id);
          if (pesagem.lote_id) setLoteTransferencia(pesagem.lote_id);
          
          // Limpar o parâmetro da URL para evitar recarregar
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    };
    carregarParaEdicao();
  }, [editarId, pesagens]);

  // ========== OFFLINE FIRST - INICIALIZAR IndexedDB E CARREGAR DADOS ==========
  useEffect(() => {
    const init = async () => {
      try {
        await initDB();
        setDbReady(true);
        await loadAllData();
      } catch (error) {
        console.error('Erro ao inicializar IndexedDB:', error);
        // Fallback para localStorage se IndexedDB falhar
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

    // Listener para sincronização automática
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

  const loadAllData = async () => {
    setIsLoading(true);
    
    try {
      // Tentar carregar do IndexedDB primeiro
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
        // Fallback para localStorage
        const cachedPesagens = JSON.parse(localStorage.getItem('offline_pesagens_individuais') || '[]');
        const cachedApartacoes = JSON.parse(localStorage.getItem('offline_apartacoes') || '[]');
        const cachedLotes = JSON.parse(localStorage.getItem('offline_lotes_apartacao') || '[]');
        
        setPesagens(cachedPesagens.filter(p => p.empresa_id === empresaSelecionadaId));
        setApartacoes(cachedApartacoes.filter(a => a.empresa_id === empresaSelecionadaId));
        setLotesApartacao(cachedLotes.filter(l => l.empresa_id === empresaSelecionadaId));
      }
      
      await updatePendingCount();
      setIsLoading(false);

      // Se online, atualizar do servidor e salvar no IndexedDB
      if (navigator.onLine) {
        const [allPesagens, allApartacoes, allLotes] = await Promise.all([
          base44.entities.PesagemIndividual.list('-data_pesagem'),
          base44.entities.Apartacao.list(),
          base44.entities.LoteApartacao.list(),
        ]);

        const pesagensEmpresa = allPesagens.filter(p => p.empresa_id === empresaSelecionadaId);
        const apartacoesEmpresa = allApartacoes.filter(a => a.empresa_id === empresaSelecionadaId);
        const lotesEmpresa = allLotes.filter(l => l.empresa_id === empresaSelecionadaId);

        // Salvar no IndexedDB (persistente)
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

  // ========== SINCRONIZAÇÃO ==========
  const handleSyncAll = async () => {
    if (!navigator.onLine) {
      toast.error("Sem conexão");
      return;
    }

    setIsSyncing(true);
    setSyncDialogOpen(true);
    setSyncState({
      isRunning: true,
      currentStep: 0,
      totalSteps: 0,
      currentItem: 'Preparando sincronização...',
      items: [],
      completed: false,
      errors: 0
    });
    
    try {
      const result = await syncAll(empresaSelecionadaId, (progress) => {
        setSyncState(prev => ({
          ...prev,
          currentStep: progress.current || prev.currentStep,
          totalSteps: progress.total || prev.totalSteps,
          currentItem: progress.currentItem || prev.currentItem
        }));
      });
      
      setSyncState(prev => ({
        ...prev,
        isRunning: false,
        completed: true,
        items: result.items || [],
        errors: result.totalErrors || 0
      }));
      
      if (result.success) {
        await loadAllData();
        // Fechar dialog após 2 segundos
        setTimeout(() => {
          setSyncDialogOpen(false);
          toast.success(`${result.totalSuccess || 0} registro(s) sincronizado(s)`);
        }, 2000);
      } else if (result.message) {
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Erro na sincronização:', error);
      setSyncState(prev => ({
        ...prev,
        isRunning: false,
        completed: true,
        errors: 1
      }));
      toast.error('Erro na sincronização');
    } finally {
      setIsSyncing(false);
    }
  };

  // Estado para pesagens pendentes do IndexedDB
  const [pendingPesagensDB, setPendingPesagensDB] = useState([]);
  
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

  // ========== PESAGENS DO DIA + PENDENTES + FILTRO + ORDENAÇÃO ==========
  const pesagensDia = useMemo(() => {
    const pendentes = pendingPesagensDB
      .filter(p => p.data_pesagem === dataPesagem)
      .map((p, idx) => ({ ...p, _numero_registro: `P${idx + 1}` }));
    
    // Ordenar por created_date para atribuir número sequencial fixo
    const sincronizadas = pesagens
      .filter(p => p.data_pesagem === dataPesagem)
      .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0))
      .map((p, idx) => ({ ...p, _numero_registro: idx + 1 }));
    
    let resultado = [...pendentes, ...sincronizadas];
    
    // Aplicar filtro de pesquisa
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

    // Aplicar ordenação
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
          // Pendentes (P1, P2) ficam no topo, depois por número
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
  }, [pesagens, dataPesagem, pendingPesagensDB, empresaSelecionadaId, searchTerm, sortColumn, sortDirection]);

  // Função para alternar ordenação
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Renderizar ícone de ordenação
  const SortIcon = ({ column }) => {
    if (sortColumn !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  // ========== VALORES ÚNICOS PARA AUTOCOMPLETE ==========
  const marcasExistentes = useMemo(() => 
    [...new Set(pesagens.map(p => p.marca).filter(Boolean))].sort(),
    [pesagens]
  );
  const racasExistentes = useMemo(() => 
    [...new Set(pesagens.map(p => p.raca).filter(Boolean))].sort(),
    [pesagens]
  );
  const erasExistentes = useMemo(() => 
    [...new Set(pesagens.map(p => p.era).filter(Boolean))].sort(),
    [pesagens]
  );

  // ========== LOTES DA APARTAÇÃO SELECIONADA (inclui lotes offline) ==========
  const lotesApartacaoAtual = useMemo(() => {
    if (!apartacaoSelecionada) return [];
    // Combina lotes sincronizados + lotes criados offline (do cache)
    return lotesApartacao.filter(l => l.apartacao_id === apartacaoSelecionada);
  }, [apartacaoSelecionada, lotesApartacao]);

  // ========== RESUMO DE LOTES COM CONTAGEM ==========
  const resumoLotes = useMemo(() => {
    if (!apartacaoSelecionada) return [];
    
    const todasPesagensApartacao = [
      ...pesagens.filter(p => p.apartacao_id === apartacaoSelecionada),
      ...pendingPesagensDB.filter(p => p.apartacao_id === apartacaoSelecionada)
    ];

    return lotesApartacaoAtual.map(lote => {
      const animaisLote = todasPesagensApartacao.filter(p => p.lote_id === lote.id);
      const qtd = animaisLote.length;
      const pesoTotal = animaisLote.reduce((s, p) => s + (p.peso || 0), 0);
      const pesoMedio = qtd > 0 ? pesoTotal / qtd : 0;
      
      return {
        ...lote,
        quantidade_atual: qtd,
        peso_medio: pesoMedio,
      };
    }).sort((a, b) => a.nome_lote.localeCompare(b.nome_lote));
  }, [apartacaoSelecionada, lotesApartacaoAtual, pesagens, pendingPesagensDB]);

  // ========== ESTATÍSTICAS DO DIA ==========
  const estatisticas = useMemo(() => {
    const total = pesagensDia.length;
    const machos = pesagensDia.filter(p => p.sexo === 'M').length;
    const femeas = pesagensDia.filter(p => p.sexo === 'F').length;
    const pesoMedio = total > 0 ? pesagensDia.reduce((s, p) => s + (p.peso || 0), 0) / total : 0;
    return { total, machos, femeas, pesoMedio };
  }, [pesagensDia]);

  // ========== VERIFICAR SE LOTE ESTÁ CHEIO ==========
  const isLoteCheio = (lote) => {
    if (!lote) return false;
    if (lote.fechado) return true;
    
    // Contar animais no lote (pesagens sincronizadas + pendentes)
    const animaisNoLote = [
      ...pesagens.filter(p => p.lote_id === lote.id),
      ...pendingPesagensDB.filter(p => p.lote_id === lote.id)
    ].length;
    
    return animaisNoLote >= (lote.quantidade_maxima || 999999);
  };

  // ========== DETERMINAR LOTE AUTOMATICAMENTE ==========
  const getLoteAutomatico = (pesoNum) => {
    if (!apartacaoSelecionada || !pesoNum) return null;
    // Não sugerir lotes fechados ou cheios
    const lote = lotesApartacaoAtual.find(l => 
      pesoNum >= l.peso_minimo && pesoNum <= l.peso_maximo && !l.fechado && !isLoteCheio(l)
    );
    return lote;
  };

  // ========== SALVAR PESAGEM ==========
  const handleSalvar = async () => {
    // Evitar cliques duplos
    if (isSaving) return;
    
    // Validações com avisos
    if (!dataPesagem) { 
      toast.error("⚠️ Campo obrigatório: Data da Pesagem"); 
      return; 
    }
    if (!numeroAnimal?.trim()) { 
      toast.error("⚠️ Campo obrigatório: Nº Identificação"); 
      numeroInputRef.current?.focus();
      return; 
    }
    if (!peso || isNaN(parseFloat(peso)) || parseFloat(peso) <= 0) { 
      toast.error("⚠️ Campo obrigatório: Peso (deve ser maior que zero)"); 
      pesoInputRef.current?.focus();
      return; 
    }

    // Verificar duplicado (inclui pesagens pendentes offline) - exceto SN
    const isSN = numeroAnimal.trim().toUpperCase() === 'SN';
    if (!editingId && !isSN) {
      const duplicado = pesagensDia.find(p => 
        p.numero_animal === numeroAnimal.trim() && 
        p.id !== editingId
      );
      if (duplicado) { 
        setAvisoTela({
          tipo: 'erro',
          mensagem: `⚠️ Animal ${numeroAnimal.trim()} já foi pesado hoje! Peso registrado: ${duplicado.peso}kg`
        });
        return; 
      }
    }

    // No modo "Manejo de Pesagens", verificar se o brinco existe no cadastro
    if (tipoManejo === 'pesagens' && !isSN && !editingId) {
      const animalExiste = pesagens.some(p => p.numero_animal === numeroAnimal.trim());
      if (!animalExiste) {
        setAvisoTela({
          tipo: 'erro',
          mensagem: `❌ Brinco ${numeroAnimal.trim()} NÃO CADASTRADO! Use "Manejo Cadastro" para cadastrar primeiro.`
        });
        numeroInputRef.current?.focus();
        return;
      }
    }

    // No modo "Manejo Cadastro", verificar se o brinco JÁ existe (não permitir duplicado)
    if (tipoManejo === 'cadastro' && !isSN && !editingId) {
      const animalExiste = pesagens.some(p => p.numero_animal === numeroAnimal.trim());
      if (animalExiste) {
        const ultimo = pesagens
          .filter(p => p.numero_animal === numeroAnimal.trim())
          .sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem))[0];
        setAvisoTela({
          tipo: 'erro',
          mensagem: `❌ Animal ${numeroAnimal.trim()} já cadastrado em ${formatarData(ultimo.data_pesagem)} com peso ${ultimo.peso}kg! Use "Manejo de Pesagens" para nova pesagem.`
        });
        numeroInputRef.current?.focus();
        return;
      }
    }

    setIsSaving(true);

    const pesoNum = parseFloat(peso);
    
    // Buscar histórico para cálculo de ganho - exceto SN
    let dataAnterior = null, pesoAnterior = null, dias = null, ganho = null, gmd = null;

    if (!isSN) {
      const historicoAnimal = pesagens
        .filter(p => p.numero_animal === numeroAnimal.trim() && p.data_pesagem < dataPesagem)
        .sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));

      if (historicoAnimal.length > 0 && historicoAnimal[0].peso) {
        const ultimo = historicoAnimal[0];
        dataAnterior = ultimo.data_pesagem;
        pesoAnterior = ultimo.peso;
        dias = Math.floor((new Date(dataPesagem) - new Date(dataAnterior)) / (1000 * 60 * 60 * 24));
        ganho = pesoNum - pesoAnterior;
        gmd = dias > 0 ? parseFloat((ganho / dias).toFixed(3)) : 0;
      }
    }

    // Determinar lote
    let loteId = null, nomeLote = null, apartacaoId = null, nomeApartacao = null;
    
    if (loteTransferencia === "NENHUM") {
      // Usuário optou por não vincular a nenhum lote
      loteId = null;
      nomeLote = null;
      apartacaoId = apartacaoSelecionada || null;
      nomeApartacao = apartacaoSelecionada ? apartacoes.find(a => a.id === apartacaoSelecionada)?.nome_apartacao || "" : null;
    } else if (loteTransferencia) {
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

    // Determinar tipo_manejo baseado no modo selecionado
    const tipoManejoRegistro = tipoManejo === 'cadastro' ? 'Cadastro' : 'Pesagens';

    // Se for cadastro, NÃO calcula ganho de peso (é o registro inicial)
    const data = {
      empresa_id: empresaSelecionadaId,
      tipo_manejo: tipoManejoRegistro,
      data_pesagem: dataPesagem,
      numero_animal: numeroAnimal.trim(),
      sexo: sexo || null,
      raca: raca || null,
      era: era || null,
      marca: marca || null,
      peso: pesoNum,
      observacao: observacao || null,
      apartacao_id: apartacaoId,
      nome_apartacao: nomeApartacao,
      lote_id: loteId,
      nome_lote: nomeLote,
      // Cadastro não tem ganho de peso (é o registro inicial)
      data_anterior: tipoManejo === 'cadastro' ? null : dataAnterior,
      peso_anterior: tipoManejo === 'cadastro' ? null : pesoAnterior,
      dias: tipoManejo === 'cadastro' ? null : dias,
      ganho: tipoManejo === 'cadastro' ? null : (ganho ? parseFloat(ganho.toFixed(2)) : null),
      gmd: tipoManejo === 'cadastro' ? null : gmd,
    };

    try {
      if (navigator.onLine && !editingId && !editingOfflineId) {
        await base44.entities.PesagemIndividual.create(data);
        toast.success('✓ Salvo!');
        await loadAllData();
      } else if (editingOfflineId) {
        // Edição de pesagem pendente offline - atualizar no IndexedDB
        if (dbReady) {
          await deletePendingPesagem(editingOfflineId);
          await savePesagemOffline(data);
          const pending = await getPendingPesagens(empresaSelecionadaId);
          setPendingPesagensDB(pending);
        }
        toast.success('💾 Atualizado offline');
        setEditingOfflineId(null);
      } else if (editingId) {
        // Edição de pesagem sincronizada - funciona online e offline
        if (navigator.onLine) {
          await base44.entities.PesagemIndividual.update(editingId, data);
          toast.success('✓ Atualizado!');
          await loadAllData();
        } else {
          // Salvar edição offline
          if (dbReady) {
            await savePesagemOffline({ ...data, _editId: editingId, _action: 'update' });
            // Atualizar cache local
            const pesagemAtualizada = { ...data, id: editingId };
            await putItem(STORES_NAMES.PESAGENS, pesagemAtualizada);
          }
          await updatePendingCount();
          toast.success('💾 Atualizado offline');
          await loadAllData();
        }
      } else if (!navigator.onLine) {
        // Salvar no IndexedDB (persistente mesmo fechando o navegador)
        if (dbReady) {
          await savePesagemOffline(data);
          const pending = await getPendingPesagens(empresaSelecionadaId);
          setPendingPesagensDB(pending);
        } else {
          // Fallback para localStorage
          const pending = JSON.parse(localStorage.getItem('pending_pesagens_individuais') || '[]');
          pending.push({
            ...data,
            _offlineId: Date.now(),
            _offlineTimestamp: new Date().toISOString()
          });
          localStorage.setItem('pending_pesagens_individuais', JSON.stringify(pending));
        }
        await updatePendingCount();
        toast.success('💾 Salvo offline (persistente)');
      }

      // Limpar formulário (mantém campos fixados)
      setEditingId(null);
      setEditingOfflineId(null);
      setNumeroAnimal("");
      setPeso("");
      if (!fixarSexo) setSexo("");
      if (!fixarRaca) setRaca("");
      if (!fixarEra) setEra("");
      if (!fixarMarca) setMarca("");
      setObservacao("");
      setLoteTransferencia("");
      setAvisoTela(null);
      setTimeout(() => numeroInputRef.current?.focus(), 50);
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // ========== EXCLUIR PESAGEM ==========
  const handleExcluir = async (pesagem) => {
    // Confirmar exclusão com aviso na tela
    const confirmacao = window.confirm(`Deseja realmente excluir a pesagem do animal ${pesagem.numero_animal}?\n\nPeso: ${pesagem.peso}kg\nData: ${formatarData(pesagem.data_pesagem)}`);
    if (!confirmacao) return;

    if (pesagem._offlineId) {
      // Excluir do IndexedDB
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
      setAvisoTela({
        tipo: 'info',
        mensagem: `✓ Pesagem do animal ${pesagem.numero_animal} foi removida com sucesso!`
      });
    } else if (navigator.onLine) {
      await base44.entities.PesagemIndividual.delete(pesagem.id);
      setAvisoTela({
        tipo: 'info',
        mensagem: `✓ Pesagem do animal ${pesagem.numero_animal} foi excluída com sucesso!`
      });
      await loadAllData();
    } else {
      setAvisoTela({
        tipo: 'erro',
        mensagem: `❌ Exclusão não disponível offline. Conecte-se à internet para excluir.`
      });
    }
  };

  // ========== EDITAR PESAGEM ==========
  const handleEditar = (p) => {
    // Permitir edição tanto de sincronizadas quanto de pendentes offline
    setEditingId(p.id || p._offlineId);
    setEditingOfflineId(p._offlineId || null);
    setNumeroAnimal(p.numero_animal);
    setPeso(String(p.peso));
    setSexo(p.sexo || "M");
    setRaca(p.raca || "Nelore");
    setEra(p.era || "");
    setMarca(p.marca || "");
    setObservacao(p.observacao || "");
    if (p.apartacao_id) setApartacaoSelecionada(p.apartacao_id);
    if (p.lote_id) setLoteTransferencia(p.lote_id);
    numeroInputRef.current?.focus();
  };

  // ========== NAVEGAÇÃO POR TECLAS ==========
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

  // ========== EXPORTAR EXCEL ==========
  const exportarExcel = () => {
    const headers = ['Nº', 'Identificação', 'Data', 'Sexo', 'Raça', 'Era', 'Marca', 'Peso', 'Apartação', 'Lote', 'Data Anterior', 'Peso Anterior', 'Dias', 'Ganho', 'GMD', 'Observação'];
    const rows = pesagensDia.map(p => [
      p._numero_registro || '',
      p.numero_animal || '',
      formatarData(p.data_pesagem),
      p.sexo || '',
      p.raca || '',
      p.era || '',
      p.marca || '',
      p.peso ? String(p.peso).replace('.', ',') : '',
      p.nome_apartacao || '',
      p.nome_lote || '',
      formatarData(p.data_anterior),
      p.peso_anterior ? String(p.peso_anterior).replace('.', ',') : '',
      p.dias || '',
      p.ganho ? p.ganho.toFixed(2).replace('.', ',') : '',
      p.gmd ? p.gmd.toFixed(3).replace('.', ',') : '',
      p.observacao || ''
    ]);
    
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pesagens_${dataPesagem}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exportado!');
  };

  return (
    <div className="p-3 space-y-2 bg-slate-100 min-h-screen">
      {/* HEADER */}
      <div className="flex justify-between items-center bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-900">Lançamento de Pesagens</h1>
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
        </div>
        <div className="flex gap-2">
          {/* Botão de sincronização oculto
                      {pendingCount > 0 && isOnline && (
                        <Button size="sm" onClick={handleSyncAll} disabled={isSyncing} className="h-8 text-xs gap-1 bg-slate-700 hover:bg-slate-800">
                          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                          Sincronizar
                        </Button>
                      )}
          */}
          {dbReady && (
            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
              <Database className="w-3 h-3 mr-1" />Persistente
            </Badge>
          )}
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="h-8 w-8">
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowApartacoesDialog(true)} className="h-8 text-xs">
            Apartações
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={async () => {
              if (!navigator.onLine) {
                toast.error("Precisa estar online para limpar cache");
                return;
              }
              if (confirm("Limpar cache local, filas pendentes e recarregar dados do servidor?")) {
                try {
                  // Limpar tudo: cache e filas pendentes
                  await clearStore(STORES_NAMES.PESAGENS);
                  await clearStore(STORES_NAMES.APARTACOES);
                  await clearStore(STORES_NAMES.LOTES);
                  await clearAllPending();
                  setPendingPesagensDB([]);
                  setPendingCount(0);
                  toast.success("Cache e filas limpos!");
                  await loadAllData();
                } catch (e) {
                  toast.error("Erro ao limpar cache");
                }
              }
            }} 
            className="h-8 text-xs text-orange-600 border-orange-300 hover:bg-orange-50"
          >
            Limpar Cache
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadAllData()} className="h-8 text-xs">
            Atualizar
          </Button>
        </div>
      </div>

      {/* FORMULÁRIO DE LANÇAMENTO */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          {/* SELEÇÃO DO TIPO DE MANEJO + AVISO */}
          <div className="flex items-center gap-4 mb-4 pb-3 border-b flex-wrap">
            <Label className="text-xs font-semibold text-slate-700">Tipo de Manejo:</Label>
            <Select value={tipoManejo} onValueChange={setTipoManejo}>
              <SelectTrigger className="h-8 text-xs w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cadastro">Manejo Cadastro</SelectItem>
                <SelectItem value="pesagens">Manejo de Pesagens</SelectItem>
              </SelectContent>
            </Select>
            {tipoManejo === 'pesagens' && !avisoTela && (
              <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-1 rounded">
                Apenas animais já cadastrados
              </span>
            )}
            {tipoManejo === 'cadastro' && !avisoTela && (
              <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                Cadastro de novos animais
              </span>
            )}
            {/* AVISO INLINE */}
            {avisoTela && (
              <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                avisoTela.tipo === 'erro' ? 'bg-red-100 text-red-700' :
                avisoTela.tipo === 'alerta' ? 'bg-amber-100 text-amber-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                <span>{avisoTela.mensagem}</span>
                <button onClick={() => setAvisoTela(null)} className="hover:opacity-70">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            {/* Data Pesagem */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Data Pesagem <span className="text-red-500">*</span></Label>
              <Input 
                type="date" 
                value={dataPesagem} 
                onChange={(e) => setDataPesagem(e.target.value)} 
                className="h-9 text-sm w-40"
              />
            </div>
            
            {/* CAMPOS DE CADASTRO - Mostrar apenas no Manejo Cadastro */}
            {tipoManejo === 'cadastro' && (
              <>
                {/* Sexo com Checkbox para fixar */}
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
                  <Select value={sexo} onValueChange={setSexo}>
                    <SelectTrigger className={`h-9 text-sm w-20 ${fixarSexo ? 'bg-emerald-50 border-emerald-300' : ''}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M" className="text-slate-700">M</SelectItem>
                      <SelectItem value="F" className="text-slate-700">F</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Raça com Checkbox para fixar */}
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
                  <div className="w-28">
                    <ComboboxComNovo
                      value={raca}
                      onChange={setRaca}
                      options={racasExistentes}
                      placeholder="Nelore"
                      className={fixarRaca ? 'bg-emerald-50 border-emerald-300' : ''}
                    />
                  </div>
                </div>

                {/* Era com Checkbox para fixar */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">Era</Label>
                    <div className="flex items-center gap-1">
                      <Checkbox 
                        id="fixarEra" 
                        checked={fixarEra} 
                        onCheckedChange={setFixarEra}
                        className="h-3 w-3"
                      />
                      <label htmlFor="fixarEra" className="text-[10px] text-slate-500">Fixar</label>
                    </div>
                  </div>
                  <div className="w-24">
                    <ComboboxComNovo
                      value={era}
                      onChange={setEra}
                      options={erasExistentes}
                      placeholder="Ex: 14"
                    />
                  </div>
                </div>

                {/* Marca com Checkbox para fixar */}
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
                  <div className="w-24">
                    <ComboboxComNovo
                      value={marca}
                      onChange={setMarca}
                      options={marcasExistentes}
                      placeholder="Ex: ABC"
                    />
                  </div>
                </div>
              </>
            )}
            
            {/* Nº Identificação */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Nº Ident./Nome <span className="text-red-500">*</span></Label>
              <Input 
                ref={numeroInputRef}
                value={numeroAnimal} 
                onChange={(e) => {
                  const valor = e.target.value;
                  setNumeroAnimal(valor);
                  setAvisoTela(null); // Limpar aviso anterior
                  
                  // Buscar dados anteriores do animal (exceto SN)
                  if (valor.trim() && valor.trim().toUpperCase() !== 'SN') {
                    const historicoAnimal = pesagens
                      .filter(p => p.numero_animal === valor.trim())
                      .sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));
                    
                    // Verificar se já foi pesado hoje
                    const pesadoHoje = pesagensDia.find(p => p.numero_animal === valor.trim());
                    if (pesadoHoje && !editingId) {
                      setAvisoTela({
                        tipo: 'erro',
                        mensagem: `⚠️ Animal ${valor.trim()} já foi pesado hoje! Peso: ${pesadoHoje.peso}kg`
                      });
                    }
                    
                    if (historicoAnimal.length > 0) {
                      const ultimo = historicoAnimal[0];
                      
                      // No modo CADASTRO, avisar que animal já existe
                      if (tipoManejo === 'cadastro' && !editingId) {
                        setAvisoTela({
                          tipo: 'alerta',
                          mensagem: `⚠️ Animal ${valor.trim()} já cadastrado em ${formatarData(ultimo.data_pesagem)} com peso ${ultimo.peso}kg. Use "Manejo de Pesagens" para nova pesagem.`
                        });
                      }
                      
                      // No modo PESAGENS, mostrar info do animal
                      if (tipoManejo === 'pesagens') {
                        if (!pesadoHoje) {
                          setAvisoTela({
                            tipo: 'info',
                            mensagem: `✓ Animal encontrado: ${ultimo.sexo || '-'} | ${ultimo.raca || '-'} | Era: ${ultimo.era || '-'} | Marca: ${ultimo.marca || '-'} | Última pesagem: ${formatarData(ultimo.data_pesagem)} - ${ultimo.peso}kg`
                          });
                        }
                      }
                      
                      // Preencher campos SEMPRE (no modo pesagens, são readonly)
                      // No modo cadastro, preencher apenas se NÃO estiverem fixados
                      if (tipoManejo === 'pesagens' || !fixarSexo) setSexo(ultimo.sexo || "M");
                      if (tipoManejo === 'pesagens' || !fixarRaca) setRaca(ultimo.raca || "Nelore");
                      if (tipoManejo === 'pesagens' || !fixarMarca) setMarca(ultimo.marca || "");
                      
                      // Calcular evolução da era em meses
                      if (tipoManejo === 'pesagens' || !fixarEra) {
                        if (ultimo.era && ultimo.data_pesagem) {
                          const eraAnterior = parseInt(ultimo.era) || 0;
                          if (eraAnterior > 0) {
                            const dataAnterior = new Date(ultimo.data_pesagem);
                            const dataAtual = new Date(dataPesagem);
                            const mesesDecorridos = Math.round((dataAtual - dataAnterior) / (1000 * 60 * 60 * 24 * 30));
                            const novaEra = eraAnterior + mesesDecorridos;
                            setEra(String(novaEra > 0 ? novaEra : eraAnterior));
                          }
                        } else {
                          setEra(ultimo.era || "");
                        }
                      }
                    } else {
                      // Animal não encontrado
                      if (tipoManejo === 'pesagens') {
                        setAvisoTela({
                          tipo: 'erro',
                          mensagem: `❌ Brinco ${valor.trim()} NÃO CADASTRADO! Use "Manejo Cadastro" para cadastrar primeiro.`
                        });
                      }
                    }
                  }
                }} 
                onKeyDown={(e) => handleKeyDown(e, pesoInputRef)}
                className="h-10 w-36 font-bold text-amber-500"
                style={{ fontSize: '18px' }}
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
                className="h-10 w-28 font-bold text-amber-500"
                style={{ fontSize: '18px' }}
                placeholder="Ex: 320"
              />
            </div>
            
            {/* Observação */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Observação</Label>
              <Input 
                value={observacao} 
                onChange={(e) => setObservacao(e.target.value)} 
                className="h-9 text-sm w-44"
                placeholder="Obs..."
              />
            </div>

            {/* Botões Salvar e Cancelar */}
            <Button onClick={handleSalvar} disabled={isSaving} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              {isSaving ? 'Salvando...' : (editingId ? 'Atualizar' : 'Salvar')}
            </Button>
            {editingId && (
              <Button 
                variant="outline" 
                onClick={() => {
                  setEditingId(null);
                  setEditingOfflineId(null);
                  setNumeroAnimal("");
                  setPeso("");
                  setObservacao("");
                  setLoteTransferencia("");
                  setAvisoTela(null);
                  if (!fixarSexo) setSexo("M");
                  if (!fixarRaca) setRaca("Nelore");
                  if (!fixarEra) setEra("");
                  if (!fixarMarca) setMarca("");
                  setTimeout(() => numeroInputRef.current?.focus(), 50);
                }} 
                size="sm"
                className="h-8 text-xs"
              >
                Cancelar
              </Button>
            )}

            {/* Exibir cálculo de ganho APÓS o botão Salvar */}
            {(() => {
              if (!numeroAnimal?.trim() || !peso) return null;
              if (numeroAnimal.trim().toUpperCase() === 'SN') return null;
              const historicoAnimal = pesagens
                .filter(p => p.numero_animal === numeroAnimal.trim() && p.data_pesagem < dataPesagem)
                .sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));
              if (historicoAnimal.length === 0 || !historicoAnimal[0].peso) return null;
              const ultimo = historicoAnimal[0];
              const pesoNum = parseFloat(peso);
              const dias = Math.floor((new Date(dataPesagem) - new Date(ultimo.data_pesagem)) / (1000 * 60 * 60 * 24));
              const ganho = pesoNum - ultimo.peso;
              const gmd = dias > 0 ? (ganho / dias) : 0;
              return (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-xs font-semibold">
                  <span>{dias}d</span>
                  <span>|</span>
                  <span>{ganho.toFixed(1)}kg</span>
                  <span>|</span>
                  <span>GMD: {gmd.toFixed(3)}</span>
                </div>
              );
            })()}
          </div>
          
          {/* Linha 2: Apartação e Transferência de Lote */}
          <div className="flex flex-wrap items-end gap-4 mt-3 pt-3 border-t">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Apartação</Label>
              <Select value={apartacaoSelecionada} onValueChange={(v) => { setApartacaoSelecionada(v); setLoteTransferencia(""); }}>
                <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Nenhuma</SelectItem>
                  {apartacoes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome_apartacao}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
                              <Label className="text-xs font-medium">Transferência de Lote:</Label>
                              <Select value={loteTransferencia} onValueChange={setLoteTransferencia} disabled={!apartacaoSelecionada}>
                                <SelectTrigger className="h-9 text-sm w-64"><SelectValue placeholder="Automático" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Automático</SelectItem>
                  <SelectItem value="NENHUM" className="text-slate-500 font-medium">-- Sem Lote --</SelectItem>
                  {lotesApartacaoAtual.map(l => {
                    const cheio = isLoteCheio(l);
                    return (
                      <SelectItem key={l.id} value={l.id} className={cheio ? "text-red-600" : ""}>
                        {l.nome_lote} ({l.peso_minimo}-{l.peso_maximo}kg) {cheio ? "[FECHADO]" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {peso && apartacaoSelecionada && !loteTransferencia && (
              (() => {
                const loteAuto = getLoteAutomatico(parseFloat(peso));
                return (
                  <div className={`text-base font-bold px-4 py-2 rounded border-2 ${loteAuto ? 'text-orange-700 bg-orange-100 border-orange-300' : 'text-red-700 bg-red-100 border-red-300'}`}>
                    <ChevronRight className="w-5 h-5 inline" />
                    Lote: {loteAuto?.nome_lote || 'Não encontrado (todos cheios ou fora da faixa)'}
                  </div>
                );
              })()
            )}
          </div>
        </CardContent>
      </Card>

      {/* ÁREA PRINCIPAL: TABELA + RESUMO DE LOTES */}
      <div className="grid grid-cols-1 xl:grid-cols-4 lg:grid-cols-3 gap-2">
        {/* TABELA DE PESAGENS */}
        <div className="xl:col-span-3 lg:col-span-2">
          <Card className="shadow-sm">
            <CardHeader className="py-2 px-3 bg-slate-50 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Pesagens do Dia</CardTitle>
              {/* Campo de Pesquisa */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-slate-400" />
                  <Input 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Pesquisar animal, lote..."
                    className="h-7 text-xs pl-7 w-48"
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
                {searchTerm && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setSearchTerm("")}
                    className="h-7 text-xs gap-1"
                  >
                    <X className="w-3 h-3" />
                    Limpar Filtro
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-100">
                    <TableRow>
                      {colunasOrdenadas.map((coluna) => {
                        if (coluna.id === 'acoes') {
                          return <TableHead key="acoes" className="text-xs w-10">Ações</TableHead>;
                        }
                        const isSortable = ['numero_registro', 'numero_animal', 'peso', 'sexo', 'raca', 'marca', 'nome_apartacao', 'nome_lote'].includes(coluna.id);
                        return (
                          <TableHead 
                            key={coluna.id}
                            className={`text-xs ${coluna.id === 'peso' ? 'text-right' : ''} ${isSortable ? 'cursor-pointer hover:bg-slate-200 select-none' : ''}`}
                            onClick={() => isSortable && handleSort(coluna.id)}
                          >
                            <div className={`flex items-center ${coluna.id === 'peso' ? 'justify-end' : ''}`}>
                              {coluna.label} {isSortable && <SortIcon column={coluna.id} />}
                            </div>
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={20} className="text-center py-4 text-xs">Carregando...</TableCell></TableRow>
                    ) : pesagensDia.length === 0 ? (
                      <TableRow><TableCell colSpan={20} className="text-center py-4 text-xs text-slate-400">Nenhuma pesagem</TableCell></TableRow>
                    ) : (
                      pesagensDia.map((p, idx) => (
                        <TableRow key={p.id || p._offlineId} className={p._offlineId ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                          {colunasOrdenadas.map((coluna) => {
                            if (coluna.id === 'acoes') {
                              return (
                                <TableCell key="acoes" className="text-xs">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-6 w-6">
                                        <MoreVertical className="w-4 h-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                      <DropdownMenuItem onClick={() => handleEditar(p)}>
                                        <Edit2 className="w-3 h-3 mr-2" />Editar
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleExcluir(p)} className="text-red-600">
                                        <Trash2 className="w-3 h-3 mr-2" />Excluir
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              );
                            }
                            if (coluna.id === 'numero_registro') {
                              return <TableCell key={coluna.id} className="text-xs font-mono font-bold text-slate-700">{p._numero_registro}</TableCell>;
                            }
                            if (coluna.id === 'numero_animal') {
                              return (
                                <TableCell key={coluna.id} className="text-xs font-bold">
                                  {p.numero_animal}
                                  {p._offlineId && <Badge variant="outline" className="ml-1 text-[8px] bg-amber-100 text-amber-700">P</Badge>}
                                </TableCell>
                              );
                            }
                            if (coluna.id === 'peso') {
                              return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.peso}</TableCell>;
                            }
                            if (coluna.id === 'data_pesagem') {
                              return <TableCell key={coluna.id} className="text-xs">{formatarData(p.data_pesagem)}</TableCell>;
                            }
                            if (coluna.id === 'sexo') {
                              return <TableCell key={coluna.id} className="text-xs">{p.sexo || '-'}</TableCell>;
                            }
                            if (coluna.id === 'raca') {
                              return <TableCell key={coluna.id} className="text-xs">{p.raca || '-'}</TableCell>;
                            }
                            if (coluna.id === 'era') {
                              return <TableCell key={coluna.id} className="text-xs">{p.era || '-'}</TableCell>;
                            }
                            if (coluna.id === 'marca') {
                              return <TableCell key={coluna.id} className="text-xs">{p.marca || '-'}</TableCell>;
                            }
                            if (coluna.id === 'nome_apartacao') {
                              return <TableCell key={coluna.id} className="text-xs">{p.nome_apartacao || '-'}</TableCell>;
                            }
                            if (coluna.id === 'nome_lote') {
                              return <TableCell key={coluna.id} className="text-xs font-medium">{p.nome_lote || '-'}</TableCell>;
                            }
                            if (coluna.id === 'data_anterior') {
                              return <TableCell key={coluna.id} className="text-xs">{formatarData(p.data_anterior) || '-'}</TableCell>;
                            }
                            if (coluna.id === 'peso_anterior') {
                              return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.peso_anterior || '-'}</TableCell>;
                            }
                            if (coluna.id === 'dias') {
                              return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.dias || '-'}</TableCell>;
                            }
                            if (coluna.id === 'ganho') {
                              return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.ganho ? p.ganho.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</TableCell>;
                            }
                            if (coluna.id === 'gmd') {
                              return (
                                <TableCell key={coluna.id} className={`text-xs text-right font-mono font-semibold ${p.gmd && p.gmd > 0 ? 'text-emerald-600' : p.gmd && p.gmd < 0 ? 'text-red-600' : ''}`}>
                                  {p.gmd ? p.gmd.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : '-'}
                                </TableCell>
                              );
                            }
                            if (coluna.id === 'observacao') {
                              return <TableCell key={coluna.id} className="text-xs">{p.observacao || '-'}</TableCell>;
                            }
                            return <TableCell key={coluna.id} className="text-xs">-</TableCell>;
                          })}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* RODAPÉ COM ESTATÍSTICAS */}
          <div className="flex items-center justify-between mt-2 bg-white rounded px-3 py-2 shadow-sm">
            <div className="flex items-center gap-6 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Total Animais</span>
                <span className="font-bold text-lg">{estatisticas.total}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Total Machos</span>
                <span className="font-bold text-lg">{estatisticas.machos}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Total Fêmeas</span>
                <span className="font-bold text-lg">{estatisticas.femeas}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Peso Médio</span>
                <span className="font-bold text-lg">{estatisticas.pesoMedio.toFixed(2)}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={exportarExcel} className="h-7 text-xs">
              Exportar
            </Button>
          </div>
        </div>

        {/* RESUMO DE LOTES */}
        <ResumoLotes 
          apartacaoSelecionada={apartacaoSelecionada}
          apartacoes={apartacoes}
          lotesApartacaoAtual={lotesApartacaoAtual}
          pesagens={pesagens}
          pesagensDia={pesagensDia}
          pendingPesagensDB={pendingPesagensDB}
          dataPesagem={dataPesagem}
        />
        </div>

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

      {/* DIALOG DE CONFIGURAÇÃO DE COLUNAS */}
      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {COLUNAS_DISPONIVEIS.filter(c => !c.fixo).map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={colunasVisiveis.includes(coluna.id)}
                      onChange={() => toggleColuna(coluna.id)}
                      className="rounded"
                    />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="colunas">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((colunaId, index) => {
                        const coluna = COLUNAS_DISPONIVEIS.find(c => c.id === colunaId);
                        if (!coluna || coluna.fixo) return null;
                        
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`flex items-center gap-2 p-2 border rounded text-xs ${
                                  snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'
                                } ${!colunasVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}
                              >
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasVisiveis.includes(colunaId) && (
                                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">Visível</Badge>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setShowConfigColunas(false)} size="sm" className="h-7 text-xs">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* INDICADOR DE SINCRONIZAÇÃO OFFLINE */}
      <OfflineSyncIndicator 
        empresaId={empresaSelecionadaId}
        onSyncComplete={loadAllData}
      />

{/* Dialog de progresso oculto
      <SyncProgressDialog 
        open={syncDialogOpen}
        syncState={syncState}
      />
*/}
    </div>
  );
}

// ========== DIALOG PARA GERENCIAR APARTAÇÕES E LOTES ==========
function GerenciarApartacoesDialog({ open, onOpenChange, empresaId, apartacoes, lotes, pesagens, onRefresh, dbReady }) {
  const [tab, setTab] = useState('apartacoes');
  const [isSaving, setIsSaving] = useState(false);
  
  // Formulário apartação
  const [nomeApartacao, setNomeApartacao] = useState("");
  const [editingApartacaoId, setEditingApartacaoId] = useState(null);
  
  // Formulário lote
  const [apartacaoIdLote, setApartacaoIdLote] = useState("");
  const [nomeLote, setNomeLote] = useState("");
  const [qtdMaxima, setQtdMaxima] = useState("500");
  const [pesoMinimo, setPesoMinimo] = useState("");
  const [pesoMaximo, setPesoMaximo] = useState("");
  const [editingLoteId, setEditingLoteId] = useState(null);

  // Lotes filtrados pela apartação selecionada
  const lotesFiltrados = useMemo(() => {
    if (!apartacaoIdLote) return lotes;
    return lotes.filter(l => l.apartacao_id === apartacaoIdLote);
  }, [lotes, apartacaoIdLote]);

  const [progressoAtualizacao, setProgressoAtualizacao] = useState({ show: false, current: 0, total: 0, texto: "" });

  const salvarApartacao = async () => {
    // Evitar cliques duplos
    if (isSaving) return;
    
    if (!nomeApartacao.trim()) { 
      toast.error("Nome obrigatório"); 
      return; 
    }

    // Verificar duplicado
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
        // ONLINE: Salvar no servidor
        if (editingApartacaoId) {
          await base44.entities.Apartacao.update(editingApartacaoId, data);

          // Buscar pesagens e lotes vinculados
          const [todasPesagens, todosLotes] = await Promise.all([
            base44.entities.PesagemIndividual.filter({ apartacao_id: editingApartacaoId }),
            base44.entities.LoteApartacao.filter({ apartacao_id: editingApartacaoId })
          ]);

          const totalItens = todasPesagens.length + todosLotes.length;
          
          if (totalItens > 0) {
            setProgressoAtualizacao({ show: true, current: 0, total: totalItens, texto: "Atualizando registros..." });

            // Atualizar lotes primeiro (são poucos)
            for (const l of todosLotes) {
              await base44.entities.LoteApartacao.update(l.id, { nome_apartacao: nomeApartacao.trim() });
              setProgressoAtualizacao(prev => ({ ...prev, current: prev.current + 1 }));
            }

            // Atualizar pesagens em lotes de 10 para maior velocidade
            const batchSize = 10;
            for (let i = 0; i < todasPesagens.length; i += batchSize) {
              const batch = todasPesagens.slice(i, i + batchSize);
              await Promise.all(batch.map(p => 
                base44.entities.PesagemIndividual.update(p.id, { nome_apartacao: nomeApartacao.trim() })
              ));
              setProgressoAtualizacao(prev => ({ 
                ...prev, 
                current: todosLotes.length + Math.min(i + batchSize, todasPesagens.length),
                texto: `Atualizando pesagens ${Math.min(i + batchSize, todasPesagens.length)} de ${todasPesagens.length}...`
              }));
            }

            setProgressoAtualizacao({ show: false, current: 0, total: 0, texto: "" });
          }

          toast.success(`Apartação atualizada! ${todasPesagens.length} pesagens atualizadas.`);
        } else {
          await base44.entities.Apartacao.create(data);
          toast.success("Apartação criada!");
        }
      } else {
        // OFFLINE: Salvar no cache local (IndexedDB)
        if (editingApartacaoId) {
          toast.error("Edição de apartação requer conexão");
          setIsSaving(false);
          return;
        }
        
        const offlineId = `offline_apt_${Date.now()}`;
        const apartacaoOffline = { 
          ...data, 
          id: offlineId,
          _isOffline: true,
          _offlineTimestamp: new Date().toISOString()
        };
        
        if (dbReady) {
          await putItem(STORES_NAMES.APARTACOES, apartacaoOffline);
        }
        
        toast.success("💾 Apartação salva offline!");
      }
      
      setNomeApartacao(""); 
      setEditingApartacaoId(null);
      onRefresh();
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
      setProgressoAtualizacao({ show: false, current: 0, total: 0, texto: "" });
    }
  };

  const salvarLote = async () => {
    // Evitar cliques duplos
    if (isSaving) return;
    
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

    // Verificar duplicado na mesma apartação
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
        // ONLINE: Salvar no servidor
        if (editingLoteId) {
          await base44.entities.LoteApartacao.update(editingLoteId, data);

          // Buscar pesagens vinculadas
          const todasPesagens = await base44.entities.PesagemIndividual.filter({ lote_id: editingLoteId });
          
          if (todasPesagens.length > 0) {
            setProgressoAtualizacao({ show: true, current: 0, total: todasPesagens.length, texto: "Atualizando pesagens..." });

            // Atualizar pesagens em lotes de 10 para maior velocidade
            const batchSize = 10;
            for (let i = 0; i < todasPesagens.length; i += batchSize) {
              const batch = todasPesagens.slice(i, i + batchSize);
              await Promise.all(batch.map(p => 
                base44.entities.PesagemIndividual.update(p.id, { nome_lote: nomeLote.trim() })
              ));
              setProgressoAtualizacao(prev => ({ 
                ...prev, 
                current: Math.min(i + batchSize, todasPesagens.length),
                texto: `Atualizando ${Math.min(i + batchSize, todasPesagens.length)} de ${todasPesagens.length}...`
              }));
            }

            setProgressoAtualizacao({ show: false, current: 0, total: 0, texto: "" });
          }

          toast.success(`Lote atualizado! ${todasPesagens.length} pesagens atualizadas.`);
        } else {
          await base44.entities.LoteApartacao.create(data);
          toast.success("Lote criado!");
        }
      } else {
        // OFFLINE: Salvar no cache local (IndexedDB)
        if (editingLoteId) {
          toast.error("Edição de lote requer conexão");
          setIsSaving(false);
          return;
        }
        
        const offlineId = `offline_lote_${Date.now()}`;
        const loteOffline = { 
          ...data, 
          id: offlineId,
          _isOffline: true,
          _offlineTimestamp: new Date().toISOString()
        };
        
        if (dbReady) {
          await putItem(STORES_NAMES.LOTES, loteOffline);
        }
        
        toast.success("💾 Lote salvo offline!");
      }
      
      setNomeLote(""); 
      setQtdMaxima("500"); 
      setPesoMinimo(""); 
      setPesoMaximo(""); 
      setEditingLoteId(null);
      onRefresh();
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
      setProgressoAtualizacao({ show: false, current: 0, total: 0, texto: "" });
    }
  };

  const excluirApartacao = async (id) => {
    const pesagensVinculadas = pesagens.filter(p => p.apartacao_id === id);
    const lotesVinculados = lotes.filter(l => l.apartacao_id === id);
    
    if (pesagensVinculadas.length > 0) {
      alert(`⚠️ NÃO É POSSÍVEL EXCLUIR!\n\nEsta apartação possui:\n• ${pesagensVinculadas.length} pesagens vinculadas\n• ${lotesVinculados.length} lotes vinculados\n\nRemova primeiro as pesagens e lotes antes de excluir a apartação.`);
      return;
    }

    const confirmacao = confirm(`⚠️ ATENÇÃO!\n\nDeseja realmente excluir esta apartação?\n\nSerão excluídos também ${lotesVinculados.length} lote(s) vinculado(s).\n\nEsta ação NÃO pode ser desfeita!`);
    if (!confirmacao) return;

    // Se é item offline, remover do cache
    if (id.startsWith('offline_')) {
      if (dbReady) {
        await deleteItem(STORES_NAMES.APARTACOES, id);
        for (const l of lotesVinculados) {
          await deleteItem(STORES_NAMES.LOTES, l.id);
        }
      }
      toast.success("Apartação removida!");
      onRefresh();
      return;
    }

    // Se online, excluir do servidor
    if (navigator.onLine) {
      for (const l of lotesVinculados) {
        if (!l.id.startsWith('offline_')) {
          await base44.entities.LoteApartacao.delete(l.id);
        }
      }
      await base44.entities.Apartacao.delete(id);
      toast.success("Apartação excluída!");
      onRefresh();
    } else {
      toast.error("Exclusão de apartações do servidor requer conexão");
    }
  };

  const excluirLote = async (id) => {
    const pesagensVinculadas = pesagens.filter(p => p.lote_id === id);
    const loteInfo = lotes.find(l => l.id === id);
    
    if (pesagensVinculadas.length > 0) {
      alert(`⚠️ NÃO É POSSÍVEL EXCLUIR!\n\nO lote "${loteInfo?.nome_lote || 'Selecionado'}" possui ${pesagensVinculadas.length} pesagens vinculadas.\n\nRemova primeiro as pesagens antes de excluir o lote.`);
      return;
    }

    const confirmacao = confirm(`⚠️ ATENÇÃO!\n\nDeseja realmente excluir o lote "${loteInfo?.nome_lote || 'Selecionado'}"?\n\nEsta ação NÃO pode ser desfeita!`);
    if (!confirmacao) return;

    // Se é item offline, remover do cache
    if (id.startsWith('offline_')) {
      if (dbReady) {
        await deleteItem(STORES_NAMES.LOTES, id);
      }
      toast.success("Lote removido!");
      onRefresh();
      return;
    }

    // Se online, excluir do servidor
    if (navigator.onLine) {
      await base44.entities.LoteApartacao.delete(id);
      toast.success("Lote excluído!");
      onRefresh();
    } else {
      toast.error("Exclusão de lotes do servidor requer conexão");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Gerenciar Apartações e Lotes</DialogTitle>
        </DialogHeader>
        
        <div className="flex gap-2 border-b pb-2">
          <Button variant={tab === 'apartacoes' ? 'default' : 'outline'} size="sm" onClick={() => setTab('apartacoes')}>Apartações</Button>
          <Button variant={tab === 'lotes' ? 'default' : 'outline'} size="sm" onClick={() => setTab('lotes')}>Lotes</Button>
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
                <Button onClick={salvarApartacao} disabled={isSaving} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  {isSaving ? 'Salvando...' : (editingApartacaoId ? 'Atualizar' : 'Adicionar')}
                </Button>
                {editingApartacaoId && (
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setEditingApartacaoId(null); setNomeApartacao(""); }}>
                    Cancelar
                  </Button>
                )}
              </div>
              {/* Barra de progresso de atualização */}
              {progressoAtualizacao.show && (
                <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
                  <div className="flex justify-between text-xs text-blue-800 mb-1">
                    <span>{progressoAtualizacao.texto}</span>
                    <span className="font-bold">{Math.round((progressoAtualizacao.current / progressoAtualizacao.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all" 
                      style={{ width: `${(progressoAtualizacao.current / progressoAtualizacao.total) * 100}%` }} 
                    />
                  </div>
                  <p className="text-[10px] text-blue-600 mt-1">Aguarde, não feche esta janela...</p>
                </div>
              )}

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
                  <Button onClick={salvarLote} disabled={isSaving} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                    {isSaving ? 'Salvando...' : (editingLoteId ? 'Atualizar' : 'Adicionar')}
                  </Button>
                  {editingLoteId && (
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { 
                      setEditingLoteId(null); 
                      setNomeLote(""); 
                      setQtdMaxima("500"); 
                      setPesoMinimo(""); 
                      setPesoMaximo(""); 
                    }}>
                      Cancelar
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