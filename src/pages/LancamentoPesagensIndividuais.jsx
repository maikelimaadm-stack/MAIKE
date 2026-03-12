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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, Eye, EyeOff } from "lucide-react";
import { Scale, Save, Trash2, Edit2, RefreshCw, Settings, WifiOff, Wifi, Plus, Download, ChevronRight, MoreVertical, Search, X, ArrowUpDown, ArrowUp, ArrowDown, Database, Syringe, Truck, FolderOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
window.__toast = toast;
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
  saveUpdateOffline,
  STORES_NAMES,
  bulkPut } from
"../components/offline/IndexedDBManager";
import { syncAll, addSyncListener } from "../components/offline/SyncManager";
import OfflineSyncIndicator from "../components/offline/OfflineSyncIndicator";
import SyncProgressDialog from "../components/offline/SyncProgressDialog";
import ComboboxComNovo from "../components/pecuaria/ComboboxComNovo";
import GerenciarSanidades from "../components/sanidade/GerenciarSanidades";
import GerenciarEmbarquesDialog from "../components/embarque/GerenciarEmbarquesDialog";
import ResumoEmbarque from "../components/embarque/ResumoEmbarque";
import ResumoVendaDia from "../components/pesagens/ResumoVendaDia";
import SequenciaBrincos from "../components/pesagens/SequenciaBrincos";
import GerenciarApartacoesDialog from "../components/pesagens/GerenciarApartacoesDialog";
import ResumoLotes from "../components/pesagens/ResumoLotes";

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    // Evitar problema de fuso horário: usar apenas a parte da data
    const dataStr = dataString.split('T')[0];
    const [ano, mes, dia] = dataStr.split('-');
    if (!ano || !mes || !dia) return '--/--/----';
    return `${dia}/${mes}/${ano}`;
  } catch {return '--/--/----';}
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
  const [tipoManejo, setTipoManejo] = useState('Manejo');
  const [motivoSaida, setMotivoSaida] = useState("");



  const [mostrarDadosCompra, setMostrarDadosCompra] = useState(false);
  const [mostrarSequenciaBrinco, setMostrarSequenciaBrinco] = useState(false);
  const [valorPagoCabeca, setValorPagoCabeca] = useState("");
  const [origemAnimal, setOrigemAnimal] = useState("");
  const [documentacao, setDocumentacao] = useState("");
  const [numeroGTA, setNumeroGTA] = useState("");
  const [numeroNFeCompra, setNumeroNFeCompra] = useState("");
  const [valorFreteCompra, setValorFreteCompra] = useState("");
  const [observacoesCompra, setObservacoesCompra] = useState("");

  // Campos de Saída (Venda/Abate)
  const [mostrarDadosVenda, setMostrarDadosVenda] = useState(false);
  const [comprador, setComprador] = useState("");
  const [valorVendaTotal, setValorVendaTotal] = useState("");
  const [valorArroba, setValorArroba] = useState("");
  const [destinoVenda, setDestinoVenda] = useState("");
  const [numeroGTAVenda, setNumeroGTAVenda] = useState("");
  const [numeroNFeVenda, setNumeroNFeVenda] = useState("");
  const [valorFreteVenda, setValorFreteVenda] = useState("");
  const [observacoesVenda, setObservacoesVenda] = useState("");
  const [mostrarDadosAbate, setMostrarDadosAbate] = useState(false);
  const [frigorifico, setFrigorifico] = useState("");
  const [valorArrobaAbate, setValorArrobaAbate] = useState("");
  const [valorTotalAbate, setValorTotalAbate] = useState("");
  const [numeroGTAAbate, setNumeroGTAAbate] = useState("");
  const [observacoesAbate, setObservacoesAbate] = useState("");
  // Embarque/Documentação (para Saída Abate)
  const [embarques, setEmbarques] = useState([]);
  const [documentosEmbarque, setDocumentosEmbarque] = useState([]);
  const [embarqueSelecionadoDoc, setEmbarqueSelecionadoDoc] = useState("");
  const [documentoSelecionado, setDocumentoSelecionado] = useState("");
  const [dialogEmbarqueOpen, setDialogEmbarqueOpen] = useState(false);

  // Sanidade
  const [mostrarSanidade, setMostrarSanidade] = useState(false);
  const [sanidadesAplicadas, setSanidadesAplicadas] = useState([]);
  const [configuracoesSanidade, setConfiguracoesSanidade] = useState([]);
  const [itensSanidade, setItensSanidade] = useState([]);
  const [sanidadeAtivaId, setSanidadeAtivaId] = useState(() => {
    return localStorage.getItem('sanidade_em_uso') || "";
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [avisoTela, setAvisoTela] = useState(null);

  // Ordenação
  const [sortColumn, setSortColumn] = useState("created_date");
  const [sortDirection, setSortDirection] = useState("desc");

  // Dialog
  const [showApartacoesDialog, setShowApartacoesDialog] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);

  // Painel direito: modo de visualização (apartacao | venda | abate)
  const [painelResumoTipo, setPainelResumoTipo] = useState('apartacao');

  // Configuração de colunas
  const COLUNAS_DISPONIVEIS = [
  { id: 'acoes', label: 'Ações', default: true, fixo: true },
  { id: 'numero_registro', label: 'Nº', default: true },
  { id: 'tipo_manejo', label: 'Tipo', default: true },
  { id: 'motivo_saida', label: 'Motivo Saída', default: true },
  { id: 'numero_animal', label: 'Identificação', default: true },
  { id: 'peso', label: 'Peso', default: true },
  { id: 'sanidade', label: 'Sanidade', default: true },
  { id: 'data_pesagem', label: 'Data', default: true },
  { id: 'sexo', label: 'Sexo', default: true },
  { id: 'raca', label: 'Raça', default: true },
  { id: 'era', label: 'Era', default: true },
  { id: 'marca', label: 'Marca', default: true },
  { id: 'nome_apartacao', label: 'Apartação', default: true },
  { id: 'nome_lote', label: 'Lote', default: true },
  { id: 'valor_pago_cabeca', label: 'Valor Compra', default: true },
  { id: 'origem_animal', label: 'Origem', default: false },
  { id: 'comprador', label: 'Comprador', default: true },
  { id: 'destino_venda', label: 'Destino', default: false },
  { id: 'valor_venda_total', label: 'Valor Venda', default: true },
  { id: 'valor_arroba', label: 'Valor @', default: true },
  { id: 'quantidade_arrobas', label: 'Qtd @', default: true },
  { id: 'frigorifico', label: 'Frigorífico', default: true },
  { id: 'embarque_nome', label: 'Embarque', default: true },
  { id: 'documento_tipo', label: 'Doc', default: true },
  { id: 'documento_numero', label: 'Nº Doc', default: true },
  { id: 'motorista_nome', label: 'Motorista', default: true },
  { id: 'placa_carreta', label: 'Placa', default: true },
  { id: 'doc_qtd', label: 'Qtd Doc (Dia)', default: true },
  { id: 'data_anterior', label: 'Data Anterior', default: false },
  { id: 'peso_anterior', label: 'Peso Anterior', default: false },
  { id: 'dias', label: 'Dias', default: false },
  { id: 'ganho', label: 'Ganho', default: false },
  { id: 'gmd', label: 'GMD', default: true },
  { id: 'observacao', label: 'Observação', default: false }];


  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem('colunas_ordem_lancamento_pesagens');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_visiveis_lancamento_pesagens');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
  });

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId) ?
    colunasVisiveis.filter((id) => id !== colunaId) :
    [...colunasVisiveis, colunaId];
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

  const colunasOrdenadas = colunasOrdem.
  map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).
  filter((c) => c && colunasVisiveis.includes(c.id));

  // ========== CARREGAR REGISTRO PARA EDIÇÃO ==========
  useEffect(() => {
    const carregarParaEdicao = async () => {
      if (editarId && pesagens.length > 0) {
        const pesagem = pesagens.find((p) => p.id === editarId);
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
        const [cachedPesagensDB, cachedApartacoesDB, cachedLotesDB, cachedEmbarquesDB, cachedDocsDB] = await Promise.all([
        getCachedPesagens(empresaSelecionadaId),
        getCachedApartacoes(empresaSelecionadaId),
        getCachedLotes(empresaSelecionadaId),
        getAllItems('embarques'),
        getAllItems('documentos_embarque')]
        );

        setPesagens(cachedPesagensDB);
        setApartacoes(cachedApartacoesDB);
        setLotesApartacao(cachedLotesDB);
        setEmbarques((cachedEmbarquesDB||[]).filter(e=>e.empresa_id===empresaSelecionadaId));
        setDocumentosEmbarque((cachedDocsDB||[]).filter(d=>d.empresa_id===empresaSelecionadaId));
      } else {
        // Fallback para localStorage
        const cachedPesagens = JSON.parse(localStorage.getItem('offline_pesagens_individuais') || '[]');
        const cachedApartacoes = JSON.parse(localStorage.getItem('offline_apartacoes') || '[]');
        const cachedLotes = JSON.parse(localStorage.getItem('offline_lotes_apartacao') || '[]');

        setPesagens(cachedPesagens.filter((p) => p.empresa_id === empresaSelecionadaId));
        setApartacoes(cachedApartacoes.filter((a) => a.empresa_id === empresaSelecionadaId));
        setLotesApartacao(cachedLotes.filter((l) => l.empresa_id === empresaSelecionadaId));
      }

      await updatePendingCount();
      setIsLoading(false);

      // Se online, atualizar do servidor e salvar no IndexedDB
      if (navigator.onLine) {
        const [allPesagens, allApartacoes, allLotes, allSanidades, allConfigs, allItens, allEmbarques, allDocs] = await Promise.all([
        base44.entities.PesagemIndividual.list('-data_pesagem'),
        base44.entities.Apartacao.list(),
        base44.entities.LoteApartacao.list(),
        base44.entities.SanidadeAnimal.list('-data_aplicacao'),
        base44.entities.ConfiguracaoSanidade.list(),
        base44.entities.ItemSanidade.list(),
        base44.entities.Embarque.list('-updated_date'),
        base44.entities.DocumentoEmbarque.list('-updated_date')]
        );

        const pesagensEmpresa = allPesagens.filter((p) => p.empresa_id === empresaSelecionadaId);
        const apartacoesEmpresa = allApartacoes.filter((a) => a.empresa_id === empresaSelecionadaId);
        const lotesEmpresa = allLotes.filter((l) => l.empresa_id === empresaSelecionadaId);
        const sanidadesEmpresa = allSanidades.filter((s) => s.empresa_id === empresaSelecionadaId);
        const configsEmpresa = allConfigs.filter((c) => c.empresa_id === empresaSelecionadaId && c.ativo);
        const itensEmpresa = allItens;

        // Salvar no IndexedDB (persistente)
        if (dbReady) {
          await Promise.all([
          cachePesagens(pesagensEmpresa),
          cacheApartacoes(apartacoesEmpresa),
          cacheLotes(lotesEmpresa),
          bulkPut('embarques', allEmbarques.filter(e=>e.empresa_id===empresaSelecionadaId)),
          bulkPut('documentos_embarque', allDocs.filter(d=>d.empresa_id===empresaSelecionadaId))]
          );
        }

        setPesagens(pesagensEmpresa);
        setApartacoes(apartacoesEmpresa);
        setLotesApartacao(lotesEmpresa);
        setSanidadesAplicadas(sanidadesEmpresa);
        setConfiguracoesSanidade(configsEmpresa);
        setItensSanidade(itensEmpresa);
        setEmbarques(allEmbarques.filter(e=>e.empresa_id===empresaSelecionadaId));
        setDocumentosEmbarque(allDocs.filter(d=>d.empresa_id===empresaSelecionadaId));
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
        setSyncState((prev) => ({
          ...prev,
          currentStep: progress.current || prev.currentStep,
          totalSteps: progress.total || prev.totalSteps,
          currentItem: progress.currentItem || prev.currentItem
        }));
      });

      setSyncState((prev) => ({
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
      setSyncState((prev) => ({
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
      .filter((p) => p.data_pesagem === dataPesagem)
      .map((p, idx) => ({ ...p, _numero_registro: `P${idx + 1}` }));

    const sincronizadas = pesagens
      .filter((p) => p.data_pesagem === dataPesagem)
      .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0))
      .map((p, idx) => ({ ...p, _numero_registro: idx + 1 }));

    let resultado = [...pendentes, ...sincronizadas];

    if (searchTerm.trim()) {
      const termo = searchTerm.toLowerCase().trim();
      resultado = resultado.filter((p) =>
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
  }, [pesagens, dataPesagem, pendingPesagensDB, empresaSelecionadaId, searchTerm, sortColumn, sortDirection]);

  const docCountsDia = useMemo(() => {
    const map = {};
    pesagensDia.forEach((p) => {
      const id = p.documento_embarque_id;
      if (id) map[id] = (map[id] || 0) + 1;
    });
    return map;
  }, [pesagensDia]);

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
    return sortDirection === 'asc' ?
    <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" /> :
    <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  // ========== VALORES ÚNICOS PARA AUTOCOMPLETE ==========
  const marcasExistentes = useMemo(() =>
  [...new Set(pesagens.map((p) => p.marca).filter(Boolean))].sort(),
  [pesagens]
  );
  const racasExistentes = useMemo(() =>
  [...new Set(pesagens.map((p) => p.raca).filter(Boolean))].sort(),
  [pesagens]
  );
  const erasExistentes = useMemo(() => [...new Set(pesagens.map((p) => p.era).filter(Boolean))].sort(), [pesagens]);
  const numerosUsados = useMemo(() => { const s = new Set(); pesagens.forEach((p) => { if (p.numero_animal) s.add(p.numero_animal); }); pendingPesagensDB.forEach((p) => { if (p.numero_animal) s.add(p.numero_animal); }); return s; }, [pesagens, pendingPesagensDB]);
  const lotesApartacaoAtual = useMemo(() => { if (!apartacaoSelecionada) return []; return lotesApartacao.filter((l) => l.apartacao_id === apartacaoSelecionada); }, [apartacaoSelecionada, lotesApartacao]);

  // ========== ESTATÍSTICAS DO DIA ==========
  const estatisticas = useMemo(() => {
    const total = pesagensDia.length;
    const machos = pesagensDia.filter((p) => p.sexo === 'M').length;
    const femeas = pesagensDia.filter((p) => p.sexo === 'F').length;
    const pesoMedio = total > 0 ? pesagensDia.reduce((s, p) => s + (p.peso || 0), 0) / total : 0;
    return { total, machos, femeas, pesoMedio };
  }, [pesagensDia]);

  // Estatísticas do documento/embarque selecionados (Abate)
  const pesagensDocSelecionado = useMemo(() => {
    if (!documentoSelecionado) return [];
    return [...pendingPesagensDB, ...pesagens].filter((p) => p.documento_embarque_id === documentoSelecionado);
  }, [documentoSelecionado, pesagens, pendingPesagensDB]);

  const resumoDoc = useMemo(() => {
    const total = pesagensDocSelecionado.length;
    const machos = pesagensDocSelecionado.filter((p) => p.sexo === 'M').length;
    const femeas = pesagensDocSelecionado.filter((p) => p.sexo === 'F').length;
    const pesoTotal = pesagensDocSelecionado.reduce((s, p) => s + (p.peso || 0), 0);
    const pesoMedio = total > 0 ? pesoTotal / total : 0;
    return { total, machos, femeas, pesoTotal, pesoMedio };
  }, [pesagensDocSelecionado]);

  const pesagensEmbarqueSelecionado = useMemo(() => {
    if (!embarqueSelecionadoDoc) return [];
    return [...pendingPesagensDB, ...pesagens].filter((p) => p.embarque_id === embarqueSelecionadoDoc);
  }, [embarqueSelecionadoDoc, pesagens, pendingPesagensDB]);

  const resumoEmbarque = useMemo(() => {
    const total = pesagensEmbarqueSelecionado.length;
    const machos = pesagensEmbarqueSelecionado.filter((p) => p.sexo === 'M').length;
    const femeas = pesagensEmbarqueSelecionado.filter((p) => p.sexo === 'F').length;
    const pesoTotal = pesagensEmbarqueSelecionado.reduce((s, p) => s + (p.peso || 0), 0);
    const pesoMedio = total > 0 ? pesoTotal / total : 0;
    return { total, machos, femeas, pesoTotal, pesoMedio };
  }, [pesagensEmbarqueSelecionado]);

  // Resumo por Documento do Embarque selecionado (para tabela Doc/Nº/Prev/Emb/Faltam)
  const documentosDoEmbarqueSel = useMemo(() => {
    if (!embarqueSelecionadoDoc) return [];
    return documentosEmbarque.filter((d) => d.embarque_id === embarqueSelecionadoDoc);
  }, [documentosEmbarque, embarqueSelecionadoDoc]);

  const todasPesagensAbate = useMemo(() => {
    return [...pendingPesagensDB, ...pesagens];
  }, [pendingPesagensDB, pesagens]);

  const resumoDocsAbate = useMemo(() => {
    return documentosDoEmbarqueSel.map((d) => {
      const pesDoc = todasPesagensAbate.filter((p) => p.documento_embarque_id === d.id);
      const pesoTotal = pesDoc.reduce((s, p) => s + (p.peso || 0), 0);
      const pesoMedio = pesDoc.length ? pesoTotal / pesDoc.length : 0;
      return {
        id: d.id,
        gta: d.numero_gta || '-',
        nfe: d.numero_nfe || '-',
        prevM: d.qtd_prev_machos || 0,
        prevF: d.qtd_prev_femeas || 0,
        pesoTotal,
        pesoMedio,
      };
    });
  }, [documentosDoEmbarqueSel, todasPesagensAbate]);

  const totaisDocsAbate = useMemo(() => {
    return resumoDocsAbate.reduce((acc, r) => ({
      prevM: acc.prevM + r.prevM,
      prevF: acc.prevF + r.prevF,
      embM: acc.embM + r.embM,
      embF: acc.embF + r.embF,
      faltamM: acc.faltamM + r.faltamM,
      faltamF: acc.faltamF + r.faltamF,
    }), { prevM: 0, prevF: 0, embM: 0, embF: 0, faltamM: 0, faltamF: 0 });
  }, [resumoDocsAbate]);

  // Buscar sanidades aplicadas para cada animal do dia
  const sanidadesPorAnimal = useMemo(() => {
    const map = {};
    pesagensDia.forEach((p) => {
      const sanidadesDoAnimal = sanidadesAplicadas.filter((s) =>
      s.numero_animal === p.numero_animal &&
      s.data_aplicacao === dataPesagem
      );
      if (sanidadesDoAnimal.length > 0) {
        // Agrupar por nome_sanidade
        const porNome = sanidadesDoAnimal.reduce((acc, s) => {
          const key = s.nome_sanidade || 'Sem nome';
          if (!acc[key]) {
            acc[key] = {
              nome: key,
              medicamentos: [],
              custoTotal: 0
            };
          }
          acc[key].medicamentos.push({
            medicamento: s.medicamento,
            quantidade: s.quantidade,
            unidade: s.unidade_medida,
            custo: s.custo_total || 0
          });
          acc[key].custoTotal += s.custo_total || 0;
          return acc;
        }, {});
        map[p.numero_animal] = Object.values(porNome);
      }
    });
    return map;
  }, [pesagensDia, sanidadesAplicadas, dataPesagem]);

  // ========== VERIFICAR SE LOTE ESTÁ CHEIO ==========
  const isLoteCheio = (lote) => {
    if (!lote) return false;
    if (lote.fechado) return true;

    // Contar animais no lote (pesagens sincronizadas + pendentes)
    const animaisNoLote = [
    ...pesagens.filter((p) => p.lote_id === lote.id),
    ...pendingPesagensDB.filter((p) => p.lote_id === lote.id)].
    length;

    return animaisNoLote >= (lote.quantidade_maxima || 999999);
  };

  // ========== DETERMINAR LOTE AUTOMATICAMENTE ==========
  const getLoteAutomatico = (pesoNum) => {
    if (!apartacaoSelecionada || !pesoNum) return null;
    // Não sugerir lotes fechados ou cheios
    const lote = lotesApartacaoAtual.find((l) =>
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
    if (tipoManejo === 'Saída' && !motivoSaida) {
      toast.error("⚠️ Campo obrigatório: Motivo da Saída");
      return;
    }
    if (tipoManejo === 'Saída' && motivoSaida === 'Abate') {
      if (!embarqueSelecionadoDoc || !documentoSelecionado) {
        toast.error("Selecione o Embarque e o Documento (GTA/NF-e)");
        return;
      }
    }

    // Verificar duplicado (inclui pesagens pendentes offline) - exceto SN e variações SNx
    const isSN = /^SN\s*\d*$/i.test(numeroAnimal.trim()) || numeroAnimal.trim().toUpperCase() === 'SN';
    if (!editingId && !isSN) {
      const duplicado = pesagensDia.find((p) =>
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

    // No modo "Manejo", verificar se o brinco existe no cadastro
    if (tipoManejo === 'Manejo' && !isSN && !editingId) {
      const animalExiste = pesagens.some((p) => p.numero_animal === numeroAnimal.trim() && p.status_animal === 'Ativo');
      if (!animalExiste) {
        setAvisoTela({
          tipo: 'erro',
          mensagem: `❌ Brinco ${numeroAnimal.trim()} NÃO CADASTRADO! Use "Cadastro" para cadastrar primeiro.`
        });
        numeroInputRef.current?.focus();
        return;
      }
    }

    // No modo "Saída", verificar se o brinco existe
    if (tipoManejo === 'Saída' && !isSN && !editingId) {
      const animalExiste = pesagens.some((p) => p.numero_animal === numeroAnimal.trim() && p.status_animal === 'Ativo');
      if (!animalExiste) {
        setAvisoTela({
          tipo: 'erro',
          mensagem: `❌ Brinco ${numeroAnimal.trim()} NÃO CADASTRADO ou já está INATIVO!`
        });
        numeroInputRef.current?.focus();
        return;
      }
    }

    // No modo "Cadastro", verificar se o brinco JÁ existe (não permitir duplicado)
    if (tipoManejo === 'Cadastro' && !isSN && !editingId) {
      const animalExiste = pesagens.some((p) => p.numero_animal === numeroAnimal.trim());
      if (animalExiste) {
        const ultimo = pesagens.
        filter((p) => p.numero_animal === numeroAnimal.trim()).
        sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem))[0];
        setAvisoTela({
          tipo: 'erro',
          mensagem: `❌ Animal ${numeroAnimal.trim()} já cadastrado em ${formatarData(ultimo.data_pesagem)} com peso ${ultimo.peso}kg! Use "Manejo" para nova pesagem.`
        });
        numeroInputRef.current?.focus();
        return;
      }
    }

    setIsSaving(true);

    const pesoNum = parseFloat(peso);

    // Buscar histórico para cálculo de ganho - exceto SN
    let dataAnterior = null,pesoAnterior = null,dias = null,ganho = null,gmd = null;

    if (!isSN) {
      const historicoAnimal = pesagens.
      filter((p) => p.numero_animal === numeroAnimal.trim() && p.data_pesagem < dataPesagem).
      sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));

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
    let loteId = null,nomeLote = null,apartacaoId = null,nomeApartacao = null;

    if (loteTransferencia === "NENHUM") {
      // Usuário optou por não vincular a nenhum lote
      loteId = null;
      nomeLote = null;
      apartacaoId = apartacaoSelecionada || null;
      nomeApartacao = apartacaoSelecionada ? apartacoes.find((a) => a.id === apartacaoSelecionada)?.nome_apartacao || "" : null;
    } else if (loteTransferencia) {
      const lote = lotesApartacaoAtual.find((l) => l.id === loteTransferencia);
      if (lote) {
        loteId = lote.id;
        nomeLote = lote.nome_lote;
        apartacaoId = apartacaoSelecionada;
        nomeApartacao = apartacoes.find((a) => a.id === apartacaoSelecionada)?.nome_apartacao || "";
      }
    } else if (apartacaoSelecionada) {
      const loteAuto = getLoteAutomatico(pesoNum);
      if (loteAuto) {
        loteId = loteAuto.id;
        nomeLote = loteAuto.nome_lote;
        apartacaoId = apartacaoSelecionada;
        nomeApartacao = apartacoes.find((a) => a.id === apartacaoSelecionada)?.nome_apartacao || "";
      }
    }

    // Se for cadastro ou saída, NÃO calcula ganho de peso
    // Calcular arrobas se for venda (peso / 2 / 15 = peso / 30, considerando 50% de aproveitamento)
    let quantidadeArrobas = null;
    if (tipoManejo === 'Saída' && motivoSaida === 'Venda' && pesoNum) {
      quantidadeArrobas = pesoNum / 30;
    }

    const selectedDoc = documentosEmbarque.find(d => d.id === documentoSelecionado);
    const selectedEmb = embarques.find(e => e.id === embarqueSelecionadoDoc);

    const data = {
    empresa_id: empresaSelecionadaId,
    tipo_manejo: tipoManejo,
    motivo_saida: tipoManejo === 'Saída' ? motivoSaida : null,
    status_animal: tipoManejo === 'Saída' ? 'Inativo' : 'Ativo',
    data_pesagem: dataPesagem,
    numero_animal: numeroAnimal.trim(),
    // Dados cadastrais - SEMPRE SALVAR (não só em Cadastro)
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
      // Dados de Cadastro (Compra)
      valor_pago_cabeca: tipoManejo === 'Cadastro' && valorPagoCabeca ? parseFloat(valorPagoCabeca) : null,
      origem_animal: tipoManejo === 'Cadastro' ? origemAnimal : null,
      documentacao: tipoManejo === 'Cadastro' ? numeroGTA || numeroNFeCompra || valorFreteCompra || observacoesCompra ? JSON.stringify({
        gta: numeroGTA,
        nfe: numeroNFeCompra,
        frete: valorFreteCompra,
        obs: observacoesCompra
      }) : null : null,
      // Dados de Saída (Venda)
      comprador: tipoManejo === 'Saída' && motivoSaida === 'Venda' ? comprador : null,
      destino_venda: tipoManejo === 'Saída' && motivoSaida === 'Venda' ? destinoVenda : null,
      valor_venda_total: tipoManejo === 'Saída' && motivoSaida === 'Venda' && valorVendaTotal ? parseFloat(valorVendaTotal) : null,
      valor_arroba: tipoManejo === 'Saída' && motivoSaida === 'Venda' && valorArroba ? parseFloat(valorArroba) : null,
      quantidade_arrobas: quantidadeArrobas ? parseFloat(quantidadeArrobas.toFixed(2)) : null,
      // Dados de Saída (Abate)
      frigorifico: tipoManejo === 'Saída' && motivoSaida === 'Abate' ? frigorifico : null,
      // Embarque/documentação
      embarque_id: tipoManejo === 'Saída' && motivoSaida === 'Abate' ? (embarqueSelecionadoDoc || null) : null,
      embarque_nome: tipoManejo === 'Saída' && motivoSaida === 'Abate' ? (selectedEmb?.nome || null) : null,
      documento_embarque_id: tipoManejo === 'Saída' && motivoSaida === 'Abate' ? (documentoSelecionado || null) : null,
      documento_tipo: tipoManejo === 'Saída' && motivoSaida === 'Abate' ? (selectedDoc?.tipo_documento || null) : null,
      documento_numero: tipoManejo === 'Saída' && motivoSaida === 'Abate' ? (selectedDoc ? (selectedDoc.tipo_documento === 'GTA+NF-e' ? `GTA: ${selectedDoc.numero_gta || '-'} | NF-e: ${selectedDoc.numero_nfe || '-'}` : (selectedDoc.numero_gta || selectedDoc.numero_nfe || null)) : null) : null,
      motorista_nome: tipoManejo === 'Saída' && motivoSaida === 'Abate' ? (selectedDoc?.motorista_nome || null) : null,
      placa_carreta: tipoManejo === 'Saída' && motivoSaida === 'Abate' ? (selectedDoc?.placa_carreta || null) : null,
      // Cadastro e Saída não têm ganho de peso
      data_anterior: tipoManejo === 'Manejo' ? dataAnterior : null,
      peso_anterior: tipoManejo === 'Manejo' ? pesoAnterior : null,
      dias: tipoManejo === 'Manejo' ? dias : null,
      ganho: tipoManejo === 'Manejo' ? ganho ? parseFloat(ganho.toFixed(2)) : null : null,
      gmd: tipoManejo === 'Manejo' ? gmd : null
    };

    try {
      if (navigator.onLine && !editingId && !editingOfflineId) {
        // Salvar pesagem
        const novaPesagem = await base44.entities.PesagemIndividual.create(data);
        toast.success('✓ Salvo!');

        // Aplicar sanidade em background (não bloquear UI)
        if (sanidadeAtivaId && (tipoManejo === 'Cadastro' || tipoManejo === 'Manejo')) {
          const configSanidade = configuracoesSanidade.find((c) => c.id === sanidadeAtivaId);
          const itens = itensSanidade.filter((i) => i.configuracao_sanidade_id === sanidadeAtivaId);

          if (itens.length > 0) {
            Promise.all(itens.map(item => {
              const custoTotal = (item.quantidade_padrao || 0) * (item.custo_unitario || 0);
              return base44.entities.SanidadeAnimal.create({
                empresa_id: empresaSelecionadaId,
                configuracao_sanidade_id: sanidadeAtivaId,
                nome_sanidade: configSanidade?.nome_sanidade || "",
                numero_animal: numeroAnimal.trim(),
                data_aplicacao: dataPesagem,
                medicamento: item.medicamento,
                finalidade: item.finalidade,
                quantidade: item.quantidade_padrao,
                unidade_medida: item.unidade_medida,
                custo_unitario: item.custo_unitario,
                custo_total: custoTotal
              });
            })).then(() => loadAllData());
          }
        }

        // Atualizar apenas as pesagens do dia (mais rápido)
        const novasPesagens = await base44.entities.PesagemIndividual.filter({ data_pesagem: dataPesagem, empresa_id: empresaSelecionadaId });
        const sanidadesNovas = await base44.entities.SanidadeAnimal.filter({ data_aplicacao: dataPesagem, empresa_id: empresaSelecionadaId });
        
        setPesagens(prev => {
          const outrosDias = prev.filter(p => p.data_pesagem !== dataPesagem);
          return [...outrosDias, ...novasPesagens];
        });
        setSanidadesAplicadas(prev => {
          const outrosDias = prev.filter(s => s.data_aplicacao !== dataPesagem);
          return [...outrosDias, ...sanidadesNovas];
        });
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
          // Buscar o registro original para saber o tipo_manejo
          const registroOriginal = pesagens.find((p) => p.id === editingId);

          await base44.entities.PesagemIndividual.update(editingId, data);

          // Se estamos editando um registro de CADASTRO, propagar dados para todos os registros do animal
          if (registroOriginal?.tipo_manejo === 'Cadastro') {
            await atualizarDadosCadastroEmTodos(numeroAnimal.trim(), {
              sexo: sexo || null,
              raca: raca || null,
              era: era || null,
              marca: marca || null
            });
          }

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

      setEditingId(null); setEditingOfflineId(null); setPeso("");
      if (window.__sequenciaBrincos && tipoManejo === 'Cadastro') { const usadosAtualizados = new Set(numerosUsados); usadosAtualizados.add(numeroAnimal.trim()); const r = window.__sequenciaBrincos.avancar(usadosAtualizados); if (!r.ok) { toast.info("✅ Sequência finalizada!"); setNumeroAnimal(""); } else if (r.pulos > 0) toast.info(`⏭️ ${r.pulos} pulado(s)`); } else { setNumeroAnimal(""); }
      setObservacao("");
      setLoteTransferencia("");
      if (tipoManejo !== 'Saída') setMotivoSaida("");
      setValorPagoCabeca("");
      setOrigemAnimal("");
      setDocumentacao("");
      setNumeroGTA("");
      setNumeroNFeCompra("");
      setValorFreteCompra("");
      setObservacoesCompra("");
      if (!(tipoManejo === 'Saída' && motivoSaida === 'Venda')) {
        setComprador("");
        setValorVendaTotal("");
        setValorArroba("");
        setDestinoVenda("");
        setNumeroGTAVenda("");
        setNumeroNFeVenda("");
        setValorFreteVenda("");
        setObservacoesVenda("");
      }
      setFrigorifico("");
      setValorArrobaAbate("");
      setValorTotalAbate("");
      setNumeroGTAAbate("");
      setObservacoesAbate("");
      setEmbarqueSelecionadoDoc("");
      setDocumentoSelecionado("");
      if (!(tipoManejo === 'Saída' && motivoSaida === 'Venda')) setMostrarDadosVenda(false);
      if (!(tipoManejo === 'Saída' && motivoSaida === 'Abate')) setMostrarDadosAbate(false);
      setAvisoTela(null);
      if (window.__sequenciaBrincos && tipoManejo === 'Cadastro') setTimeout(() => pesoInputRef.current?.focus(), 100); else numeroInputRef.current?.focus();
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
        const updated = pending.filter((p) => p._offlineId !== pesagem._offlineId);
        localStorage.setItem('pending_pesagens_individuais', JSON.stringify(updated));
      }
      await updatePendingCount();
      setAvisoTela({
        tipo: 'info',
        mensagem: `✓ Pesagem do animal ${pesagem.numero_animal} foi removida com sucesso!`
      });
    } else if (navigator.onLine) {
      // Excluir sanidades aplicadas neste animal na mesma data
      const sanidadesParaExcluir = sanidadesAplicadas.filter((s) =>
      s.numero_animal === pesagem.numero_animal &&
      s.data_aplicacao === pesagem.data_pesagem
      );

      for (const s of sanidadesParaExcluir) {
        await base44.entities.SanidadeAnimal.delete(s.id);
      }

      await base44.entities.PesagemIndividual.delete(pesagem.id);
      setAvisoTela({
        tipo: 'info',
        mensagem: `✓ Pesagem do animal ${pesagem.numero_animal} foi excluída com sucesso!${sanidadesParaExcluir.length > 0 ? ` (${sanidadesParaExcluir.length} sanidade(s) também removida(s))` : ''}`
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
    setTipoManejo(p.tipo_manejo || 'Manejo');
    setMotivoSaida(p.motivo_saida || "");
    if (p.apartacao_id) setApartacaoSelecionada(p.apartacao_id);
    if (p.lote_id) setLoteTransferencia(p.lote_id);
    numeroInputRef.current?.focus();
  };

  // ========== ATUALIZAR DADOS DE CADASTRO EM TODOS OS REGISTROS ==========
  const atualizarDadosCadastroEmTodos = async (numeroAnimalAtual, novosDados) => {
    if (!navigator.onLine) {
      toast.error("Atualização em lote requer conexão");
      return;
    }

    // Buscar TODOS os registros deste animal
    const registrosAnimal = pesagens.filter((p) => p.numero_animal === numeroAnimalAtual);

    if (registrosAnimal.length <= 1) return; // Só tem um registro, não precisa propagar

    // Atualizar todos os registros com os novos dados de cadastro
    let atualizados = 0;
    for (const registro of registrosAnimal) {
      try {
        await base44.entities.PesagemIndividual.update(registro.id, {
          sexo: novosDados.sexo,
          raca: novosDados.raca,
          era: novosDados.era,
          marca: novosDados.marca
        });
        atualizados++;
      } catch (e) {
        console.error('Erro ao atualizar registro:', e);
      }
    }

    if (atualizados > 1) {
      toast.success(`Dados atualizados em ${atualizados} registros do animal ${numeroAnimalAtual}`);
    }
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
    // Usa as colunas visíveis e na ordem atual da tabela (exceto Ações)
    const visibleCols = colunasOrdenadas.filter(c => c.id !== 'acoes');
    const headers = visibleCols.map(c => c.label);

    const val = (v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return String(v).replace('.', ',');
      const s = String(v);
      return s.replaceAll(';', ',');
    };
    const money = (n) => (n !== null && n !== undefined) ? `R$ ${Number(n).toFixed(2).replace('.', ',')}` : '';
    const date = (d) => formatarData(d);

    const rows = pesagensDia.map((p) => visibleCols.map((col) => {
      switch (col.id) {
        case 'numero_registro':
          return val(p._numero_registro || '');
        case 'tipo_manejo':
          return val(p.tipo_manejo || '');
        case 'motivo_saida':
          return val(p.motivo_saida || '');
        case 'numero_animal':
          return val(p.numero_animal || '');
        case 'peso':
          return p.peso != null ? val(Number(p.peso)) : '';
        case 'sanidade': {
          const sanis = (sanidadesPorAnimal[p.numero_animal] || []).map(s => s.nome).join(' + ');
          return val(sanis);
        }
        case 'data_pesagem':
          return val(date(p.data_pesagem));
        case 'sexo':
          return val(p.sexo || '');
        case 'raca':
          return val(p.raca || '');
        case 'era':
          return val(p.era || '');
        case 'marca':
          return val(p.marca || '');
        case 'nome_apartacao':
          return val(p.nome_apartacao || '');
        case 'nome_lote':
          return val(p.nome_lote || '');
        case 'valor_pago_cabeca':
          return money(p.valor_pago_cabeca);
        case 'origem_animal':
          return val(p.origem_animal || '');
        case 'comprador':
          return val(p.comprador || '');
        case 'destino_venda':
          return val(p.destino_venda || '');
        case 'valor_venda_total':
          return money(p.valor_venda_total);
        case 'valor_arroba':
          return money(p.valor_arroba);
        case 'quantidade_arrobas':
          return p.quantidade_arrobas != null ? val(p.quantidade_arrobas.toFixed(2)) : '';
        case 'frigorifico':
          return val(p.frigorifico || '');
        case 'embarque_nome':
          return val(p.embarque_nome || '');
        case 'documento_tipo':
          return val(p.documento_tipo || '');
        case 'documento_numero':
          return val(p.documento_numero || '');
        case 'motorista_nome':
          return val(p.motorista_nome || '');
        case 'placa_carreta':
          return val(p.placa_carreta || '');
        case 'doc_qtd':
          return p.documento_embarque_id ? val(docCountsDia[p.documento_embarque_id] || 0) : '';
        case 'data_anterior':
          return val(date(p.data_anterior));
        case 'peso_anterior':
          return p.peso_anterior != null ? val(Number(p.peso_anterior)) : '';
        case 'dias':
          return p.dias != null ? val(p.dias) : '';
        case 'ganho':
          return p.ganho != null ? val(Number(p.ganho).toFixed(2)) : '';
        case 'gmd':
          return p.gmd != null ? val(Number(p.gmd).toFixed(3)) : '';
        case 'observacao':
          return val(p.observacao || '');
        default:
          return '';
      }
    }));

    const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
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
          {isOnline ?
          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
              <Wifi className="w-3 h-3 mr-1" />Online
            </Badge> :

          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
              <WifiOff className="w-3 h-3 mr-1" />Offline
            </Badge>
          }
          {pendingCount > 0 &&
          <Badge className="text-[10px] bg-blue-500">{pendingCount} pendente(s)</Badge>
          }
        </div>
        <div className="flex gap-2">
          {pendingCount > 0 && isOnline &&
          <Button size="sm" onClick={handleSyncAll} disabled={isSyncing} className="h-8 text-xs gap-1 bg-slate-700 hover:bg-slate-800">
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              Sincronizar
            </Button>
          }
          {dbReady &&
          <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
              <Database className="w-3 h-3 mr-1" />Persistente
            </Badge>
          }
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
            className="h-8 text-xs text-orange-600 border-orange-300 hover:bg-orange-50">

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
          {/* SELEÇÃO DO TIPO DE MANEJO + BOTÃO APARTAÇÕES */}
          <div className="flex items-center gap-1 mb-1 pb-1 border-b flex-wrap">
            <Label className="text-xs font-semibold text-slate-700">Tipo de Movimentação:</Label>
            <Select value={tipoManejo} onValueChange={(v) => {setTipoManejo(v);setMotivoSaida("");setMostrarDadosVenda(false);setMostrarDadosAbate(false);}}>
              <SelectTrigger className="h-8 text-xs w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cadastro">Cadastro (Novo Animal)</SelectItem>
                <SelectItem value="Manejo">Manejo (Pesagem Periódica)</SelectItem>
                <SelectItem value="Saída">Saída (Venda/Morte/Doação)</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowApartacoesDialog(true)}
              className="h-8 w-8"
              title="Gerenciar Apartações">

              <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/a75ec14d9_Logosimplescircularesmaltariapreto1.png" alt="" className="w-8 h-8" />
            </Button>

            {/* Motivo da Saída (rente ao Tipo) */}
            {tipoManejo === 'Saída' &&
            <>
                <Label className="text-xs font-medium">Motivo da Saída <span className="text-red-500">*</span></Label>
                <Select value={motivoSaida} onValueChange={setMotivoSaida}>
                  <SelectTrigger className="h-8 text-xs w-44">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Venda">Venda</SelectItem>
                    <SelectItem value="Morte">Morte</SelectItem>
                    <SelectItem value="Doação">Doação</SelectItem>
                    <SelectItem value="Abate">Abate</SelectItem>
                    <SelectItem value="Transferência">Transferência</SelectItem>
                    <SelectItem value="Outros">Outros</SelectItem>
                  </SelectContent>
                </Select>

                {/* Ícone para Venda */}
                {motivoSaida === 'Venda' &&
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setMostrarDadosVenda(!mostrarDadosVenda)}
                className="h-8 w-8"
                title={mostrarDadosVenda ? 'Ocultar Dados de Venda' : 'Mostrar Dados de Venda'}>

                    {mostrarDadosVenda ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
              }

                {/* Ícone para Abate */}
                {motivoSaida === 'Abate' &&
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setMostrarDadosAbate(!mostrarDadosAbate)}
                      className="h-8 w-8"
                      title={mostrarDadosAbate ? 'Ocultar Dados de Abate' : 'Mostrar Dados de Abate'}>
                      {mostrarDadosAbate ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setDialogEmbarqueOpen(true)}
                      className="h-8 w-8"
                      title="Gerenciar Documentação de Embarque">
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  </>
                  }
              </>
            }

            {tipoManejo === 'Cadastro' && <>
              <Button type="button" variant="outline" size="icon" onClick={() => setMostrarSequenciaBrinco(!mostrarSequenciaBrinco)} className="h-8 w-8" title={mostrarSequenciaBrinco ? 'Ocultar Sequência de Brincos' : 'Sequência de Brincos'}>
                <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/ef5814d44_istockphoto-1951050133-612x612-removebg-preview.png" alt="" className="w-5 h-5" />
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={() => setMostrarDadosCompra(!mostrarDadosCompra)} className="h-8 w-8" title={mostrarDadosCompra ? 'Ocultar Dados de Compra' : 'Mostrar Dados de Compra'}>
                {mostrarDadosCompra ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </>}
            
            {(tipoManejo === 'Cadastro' || tipoManejo === 'Manejo') &&
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMostrarSanidade(true)} className="h-8 text-xs gap-1 px-2"

              title="Gerenciar Sanidades">

                <Syringe className="w-3.5 h-3.5" />
              </Button>
            }
            


            {/* Mensagens de Status */}
            {tipoManejo === 'Cadastro' && !avisoTela &&
            <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                Cadastro de novos animais (Ativo)
              </span>
            }
            {tipoManejo === 'Manejo' && !avisoTela &&
            <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-1 rounded">
                Apenas animais já cadastrados (Ativo)
              </span>
            }
            {tipoManejo === 'Saída' && !avisoTela &&
            <span className="text-[10px] text-red-600 bg-red-50 px-2 py-1 rounded">
                Animal será marcado como INATIVO
              </span>
            }

            {/* AVISO INLINE */}
            {avisoTela &&
            <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
            avisoTela.tipo === 'erro' ? 'bg-red-100 text-red-700' :
            avisoTela.tipo === 'alerta' ? 'bg-amber-100 text-amber-700' :
            'bg-blue-100 text-blue-700'}`
            }>
                <span>{avisoTela.mensagem}</span>
                <button onClick={() => setAvisoTela(null)} className="hover:opacity-70">
                  <X className="w-3 h-3" />
                </button>
              </div>
            }
          </div>

          <div className="flex flex-wrap items-end gap-1">
            <div className="space-y-1"><Label className="text-xs font-medium">Data <span className="text-red-500">*</span></Label><Input type="date" value={dataPesagem} onChange={(e) => setDataPesagem(e.target.value)} className="h-9 text-sm w-40" /></div>
            {tipoManejo === 'Cadastro' && <>
              <div className="space-y-1"><Label className="text-xs font-medium">Sexo</Label><Select value={sexo} onValueChange={setSexo}><SelectTrigger className="h-9 text-sm w-20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="M">M</SelectItem><SelectItem value="F">F</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label className="text-xs font-medium">Raça</Label><ComboboxComNovo value={raca} onChange={setRaca} options={racasExistentes} placeholder="Nelore" className="h-9 text-sm w-28" /></div>
              <div className="space-y-1"><Label className="text-xs font-medium">Era</Label><ComboboxComNovo value={era} onChange={setEra} options={erasExistentes} placeholder="Ex: 14" className="h-9 text-sm w-24" /></div>
              <div className="space-y-1"><Label className="text-xs font-medium">Marca</Label><ComboboxComNovo value={marca} onChange={setMarca} options={marcasExistentes} placeholder="Ex: ABC" className="h-9 text-sm w-24" /></div>
            </>}
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
                    const historicoAnimal = pesagens.
                    filter((p) => p.numero_animal === valor.trim()).
                    sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));

                    // Verificar se já foi pesado hoje
                    const pesadoHoje = pesagensDia.find((p) => p.numero_animal === valor.trim() && p.id !== editingId && p._offlineId !== editingOfflineId);
                    if (pesadoHoje) {
                      setAvisoTela({
                        tipo: 'erro',
                        mensagem: `⚠️ Animal ${valor.trim()} já foi pesado hoje! Peso: ${pesadoHoje.peso}kg`
                      });
                      return; // Não preenche dados se já foi pesado
                    }

                    if (historicoAnimal.length > 0) {
                      // BUSCAR O REGISTRO DE CADASTRO (tipo_manejo === 'Cadastro')
                      const cadastroOriginal = pesagens.find((p) => p.numero_animal === valor.trim() && p.tipo_manejo === 'Cadastro');
                      const ultimo = historicoAnimal[0];
                      const dadosCadastro = cadastroOriginal || ultimo;

                      // PREENCHER DADOS AUTOMATICAMENTE EM TODOS OS MODOS
                      setSexo(dadosCadastro.sexo || "M");
                      setRaca(dadosCadastro.raca || "Nelore");
                      setEra(dadosCadastro.era || "");
                      setMarca(dadosCadastro.marca || "");

                      // No modo CADASTRO, avisar que animal já existe
                      if (tipoManejo === 'Cadastro' && !editingId && !editingOfflineId) {
                        setAvisoTela({
                          tipo: 'alerta',
                          mensagem: `⚠️ Animal ${valor.trim()} já cadastrado em ${formatarData(ultimo.data_pesagem)} com peso ${ultimo.peso}kg. Use "Manejo" para nova pesagem.`
                        });
                      } else if (tipoManejo === 'Manejo' || tipoManejo === 'Saída') {
                        const statusAtual = ultimo.status_animal || 'Ativo';
                        setAvisoTela({
                          tipo: statusAtual === 'Inativo' ? 'erro' : 'info',
                          mensagem: statusAtual === 'Inativo' ?
                          `❌ Animal ${valor.trim()} está INATIVO (já teve saída registrada)` :
                          `✓ ${dadosCadastro.sexo || '-'} | ${dadosCadastro.raca || '-'} | Era: ${dadosCadastro.era || '-'} | Marca: ${dadosCadastro.marca || '-'} | Última: ${formatarData(ultimo.data_pesagem)} - ${ultimo.peso}kg`
                        });
                      }
                    } else {
                      // Animal não encontrado
                      if (tipoManejo === 'Manejo' || tipoManejo === 'Saída') {
                        setAvisoTela({
                          tipo: 'erro',
                          mensagem: `❌ Brinco ${valor.trim()} NÃO CADASTRADO! Use "Cadastro" para cadastrar primeiro.`
                        });
                      }
                    }
                  }
                }}
                onKeyDown={(e) => handleKeyDown(e, pesoInputRef)} className="h-9 w-36 text-amber-500 font-bold" style={{ fontSize: '18px' }} autoFocus placeholder="Ex: 1234" />

            </div>

            {/* Peso */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Peso (kg) <span className="text-red-500">*</span></Label>
              <Input
                ref={pesoInputRef}
                type="number"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, 'salvar')} className="flex rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-9 w-28 font-bold text-amber-500"

                style={{ fontSize: '18px' }}
                placeholder="Ex: 320" />

            </div>
            
            {/* Observação */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Observação</Label>
              <Input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className="h-9 text-sm w-44"
                placeholder="Obs..." />

            </div>

            {/* Botões Salvar e Cancelar */}
            <Button onClick={handleSalvar} disabled={isSaving} size="sm" className="h-9 text-xs px-4 bg-emerald-600 hover:bg-emerald-700">
              {isSaving ? 'Salvando...' : editingId ? 'Atualizar' : 'Salvar'}
            </Button>
            {editingId &&
            <Button
              variant="outline"
              onClick={() => {
                setEditingId(null);
                setEditingOfflineId(null);
                setNumeroAnimal("");
                setPeso("");
                setObservacao("");
                setLoteTransferencia("");
                setMotivoSaida("");
                setAvisoTela(null);
                setSexo("M");
                setRaca("Nelore");
                setEra("");
                setMarca("");
                setTimeout(() => numeroInputRef.current?.focus(), 50);
              }}
              size="sm"
              className="h-8 text-xs">

                Cancelar
              </Button>
            }

            {/* Exibir cálculo de ganho APÓS o botão Salvar */}
            {(() => {
              if (!numeroAnimal?.trim() || !peso) return null;
              if (numeroAnimal.trim().toUpperCase() === 'SN') return null;
              const historicoAnimal = pesagens.
              filter((p) => p.numero_animal === numeroAnimal.trim() && p.data_pesagem < dataPesagem).
              sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));
              if (historicoAnimal.length === 0 || !historicoAnimal[0].peso) return null;
              const ultimo = historicoAnimal[0];
              const pesoNum = parseFloat(peso);
              const dias = Math.floor((new Date(dataPesagem) - new Date(ultimo.data_pesagem)) / (1000 * 60 * 60 * 24));
              const ganho = pesoNum - ultimo.peso;
              const gmd = dias > 0 ? ganho / dias : 0;
              return (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-xs font-semibold">
                  <span>{dias}d</span>
                  <span>|</span>
                  <span>{ganho.toFixed(1)}kg</span>
                  <span>|</span>
                  <span>GMD: {gmd.toFixed(3)}</span>
                </div>);

            })()}
          </div>

          {tipoManejo === 'Cadastro' && <SequenciaBrincos visivel={mostrarSequenciaBrinco} brincoAtual={numeroAnimal} onSetNumeroAnimal={setNumeroAnimal} numerosUsados={numerosUsados} onFocusPeso={() => setTimeout(() => pesoInputRef.current?.focus(), 100)} />}
          {tipoManejo === 'Cadastro' && mostrarDadosCompra &&
          <div className="mt-3 p-3 border-t bg-slate-50 rounded">
              <h3 className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Dados de Compra
              </h3>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Valor por Cabeça (R$)</Label>
                  <Input
                  type="number"
                  value={valorPagoCabeca}
                  onChange={(e) => setValorPagoCabeca(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 2500.00" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Origem do Animal</Label>
                  <Input
                  value={origemAnimal}
                  onChange={(e) => setOrigemAnimal(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: Fazenda ABC" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Número GTA</Label>
                  <Input
                  value={numeroGTA}
                  onChange={(e) => setNumeroGTA(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 12345" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Número NF-e</Label>
                  <Input
                  value={numeroNFeCompra}
                  onChange={(e) => setNumeroNFeCompra(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 98765" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor do Frete (R$)</Label>
                  <Input
                  type="number"
                  value={valorFreteCompra}
                  onChange={(e) => setValorFreteCompra(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="0.00" />

                </div>
                <div className="space-y-1 col-span-3">
                  <Label className="text-xs">Observações</Label>
                  <Input
                  value={observacoesCompra}
                  onChange={(e) => setObservacoesCompra(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Observações da compra..." />

                </div>
              </div>
            </div>
          }

          {/* Dados de Saída (Venda) */}
          {tipoManejo === 'Saída' && motivoSaida === 'Venda' && mostrarDadosVenda &&
          <div className="mt-3 p-3 border-t bg-blue-50 rounded">
              <h3 className="text-xs font-semibold text-blue-700 mb-3 flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Dados da Venda
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1 ml-auto"
                  onClick={() => {
                    setComprador("");
                    setDestinoVenda("");
                    setValorArroba("");
                    setValorVendaTotal("");
                    setNumeroGTAVenda("");
                    setNumeroNFeVenda("");
                    setValorFreteVenda("");
                    setObservacoesVenda("");
                  }}
                >
                  <X className="w-3.5 h-3.5" /> Limpar Dados da Venda
                </Button>
              </h3>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Comprador</Label>
                  <Input
                  value={comprador}
                  onChange={(e) => setComprador(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Nome do comprador" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Destino</Label>
                  <Input
                  value={destinoVenda}
                  onChange={(e) => setDestinoVenda(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: Fazenda XYZ" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor da Arroba (R$)</Label>
                  <Input
                  type="number"
                  value={valorArroba}
                  onChange={(e) => setValorArroba(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 280.00" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor Total (R$)</Label>
                  <Input
                  type="number"
                  value={valorVendaTotal}
                  onChange={(e) => setValorVendaTotal(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Calculado ou manual" />

                </div>
                {peso && valorArroba &&
              <div className="space-y-1 col-span-4">
                    <Label className="text-xs">Cálculo Automático (50% aproveitamento)</Label>
                    <div className="h-8 flex items-center text-xs font-semibold text-blue-700">
                      R$ {(parseFloat(peso) / 30 * parseFloat(valorArroba || 0)).toFixed(2)} ({(parseFloat(peso) / 30).toFixed(2)} @)
                    </div>
                  </div>
              }
                <div className="space-y-1">
                  <Label className="text-xs">Número GTA</Label>
                  <Input
                  value={numeroGTAVenda}
                  onChange={(e) => setNumeroGTAVenda(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 12345" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Número NF-e</Label>
                  <Input
                  value={numeroNFeVenda}
                  onChange={(e) => setNumeroNFeVenda(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 98765" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor do Frete (R$)</Label>
                  <Input
                  type="number"
                  value={valorFreteVenda}
                  onChange={(e) => setValorFreteVenda(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="0.00" />

                </div>
                <div className="space-y-1 col-span-4">
                  <Label className="text-xs">Observações</Label>
                  <Input
                  value={observacoesVenda}
                  onChange={(e) => setObservacoesVenda(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Observações da venda..." />

                </div>
              </div>
            </div>
          }

          {/* Dados de Saída (Abate) */}
          {tipoManejo === 'Saída' && motivoSaida === 'Abate' && mostrarDadosAbate &&
          <div className="mt-3 p-3 border-t bg-purple-50 rounded">
              <h3 className="text-xs font-semibold text-purple-700 mb-3 flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Documentação / Abate
              </h3>
              {/* Seleção de Embarque/Documento para o abate */}
              <div className="grid grid-cols-4 gap-3 mb-2">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Embarque</Label>
                  <Select value={embarqueSelecionadoDoc} onValueChange={(v)=>{setEmbarqueSelecionadoDoc(v);setDocumentoSelecionado('');}}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {embarques.map(e=> <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Documento (GTA/NF-e)</Label>
                  <Select value={documentoSelecionado} onValueChange={setDocumentoSelecionado} disabled={!embarqueSelecionadoDoc}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {documentosEmbarque.filter(d=>d.embarque_id===embarqueSelecionadoDoc).map(d=> {
                        const label = d.tipo_documento === 'GTA+NF-e'
                          ? `${d.tipo_documento} • GTA: ${d.numero_gta || '-'} • NF-e: ${d.numero_nfe || '-'}`
                          : `${d.tipo_documento} • ${d.numero_gta || d.numero_nfe || '-'}`;
                        return (
                          <SelectItem key={d.id} value={d.id}>{label}</SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {embarqueSelecionadoDoc && resumoDocsAbate.length > 0 && (
                <div className="mb-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">GTA</TableHead>
                        <TableHead className="text-[10px]">NF-e</TableHead>
                        <TableHead className="text-[10px] text-center">Prev M/F</TableHead>
                        <TableHead className="text-[10px] text-right">Peso Total</TableHead>
                        <TableHead className="text-[10px] text-right">Peso Médio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resumoDocsAbate.map((r) => (
                        <TableRow key={r.id} className="hover:bg-gray-50">
                          <TableCell className="text-xs py-1">{r.gta}</TableCell>
                          <TableCell className="text-xs py-1">{r.nfe}</TableCell>
                          <TableCell className="text-xs py-1 text-center">{r.prevM}/{r.prevF}</TableCell>
                          <TableCell className="text-xs py-1 text-right font-mono">{r.pesoTotal.toFixed(2)}</TableCell>
                          <TableCell className="text-xs py-1 text-right font-mono">{r.pesoMedio.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Frigorífico</Label>
                  <Input
                  value={frigorifico}
                  onChange={(e) => setFrigorifico(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Nome do frigorífico" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor por Arroba (R$)</Label>
                  <Input
                  type="number"
                  value={valorArrobaAbate}
                  onChange={(e) => setValorArrobaAbate(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 280.00" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor Total (R$)</Label>
                  <Input
                  type="number"
                  value={valorTotalAbate}
                  onChange={(e) => setValorTotalAbate(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Calculado ou manual" />

                </div>
                {peso && valorArrobaAbate &&
              <div className="space-y-1">
                    <Label className="text-xs">Cálculo Automático (50% aproveitamento)</Label>
                    <div className="h-8 flex items-center text-xs font-semibold text-purple-700">
                      R$ {(parseFloat(peso) / 30 * parseFloat(valorArrobaAbate || 0)).toFixed(2)} ({(parseFloat(peso) / 30).toFixed(2)} @)
                    </div>
                  </div>
              }
                <div className="space-y-1">
                  <Label className="text-xs">Número GTA</Label>
                  <Input
                  value={numeroGTAAbate}
                  onChange={(e) => setNumeroGTAAbate(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 12345" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Número NF-e</Label>
                  <Input
                  value={numeroNFeVenda}
                  onChange={(e) => setNumeroNFeVenda(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: 98765" />

                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor do Frete (R$)</Label>
                  <Input
                  type="number"
                  value={valorFreteVenda}
                  onChange={(e) => setValorFreteVenda(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="0.00" />

                </div>
                <div className="space-y-1 col-span-4">
                  <Label className="text-xs">Observações</Label>
                  <Input
                  value={observacoesAbate}
                  onChange={(e) => setObservacoesAbate(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Observações do abate..." />

                </div>
              </div>
            </div>
          }
          
          {/* Linha 2: Apartação e Transferência de Lote */}
          <div className="flex flex-wrap items-end gap-1 mt-1 pt-1 border-t">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Apartação</Label>
              <Select value={apartacaoSelecionada} onValueChange={(v) => {setApartacaoSelecionada(v);setLoteTransferencia("");}}>
                <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Nenhuma</SelectItem>
                  {apartacoes.map((a) =>
                  <SelectItem key={a.id} value={a.id}>
                      <div className="flex items-center gap-2">
                        <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/3a7353353_Logosimplescircularesmaltariapreto1.png" alt="" className="w-4 h-4" />
                        {a.nome_apartacao}
                      </div>
                    </SelectItem>
                  )}
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
                  {lotesApartacaoAtual.map((l) => {
                    const cheio = isLoteCheio(l);
                    return (
                      <SelectItem key={l.id} value={l.id} className={cheio ? "text-red-600" : ""}>
                        {l.nome_lote} ({l.peso_minimo}-{l.peso_maximo}kg) {cheio ? "[FECHADO]" : ""}
                      </SelectItem>);

                  })}
                </SelectContent>
              </Select>
            </div>
            {tipoManejo === 'Saída' && motivoSaida === 'Abate' && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Embarque (Abate)</Label>
                <Select value={embarqueSelecionadoDoc} onValueChange={(v)=>{setEmbarqueSelecionadoDoc(v);setDocumentoSelecionado('');}}>
                  <SelectTrigger className="h-8 text-xs w-56"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {embarques.map((e)=> (
                      <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {tipoManejo === 'Saída' && motivoSaida === 'Abate' && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Documento (GTA/NF-e)</Label>
                <Select value={documentoSelecionado} onValueChange={setDocumentoSelecionado} disabled={!embarqueSelecionadoDoc}>
                  <SelectTrigger className="h-8 text-xs w-56"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {documentosEmbarque.filter(d=>d.embarque_id===embarqueSelecionadoDoc).map((d)=> (
                      <SelectItem key={d.id} value={d.id}>{d.tipo_documento} • {d.numero_gta || d.numero_nfe || '-'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {peso && apartacaoSelecionada && !loteTransferencia &&
            (() => {
              const loteAuto = getLoteAutomatico(parseFloat(peso));
              return (
                <div className={`text-base font-bold px-4 py-2 rounded border-2 ${loteAuto ? 'text-orange-700 bg-orange-100 border-orange-300' : 'text-red-700 bg-red-100 border-red-300'}`}>
                    <ChevronRight className="w-5 h-5 inline" />
                    Lote: {loteAuto?.nome_lote || 'Não encontrado (todos cheios ou fora da faixa)'}
                  </div>);

            })()
            }
          </div>
        </CardContent>
      </Card>

      {/* ÁREA PRINCIPAL: TABELA + RESUMO DE LOTES */}
      <div className="flex justify-end mb-1">
        <div className="flex items-center gap-1 bg-white rounded px-2 py-1 border shadow-sm">
          <button
            className={`h-7 px-2 rounded text-xs ${painelResumoTipo==='apartacao' ? 'bg-emerald-600 text-white' : 'border border-slate-300 text-slate-700'}`}
            onClick={() => setPainelResumoTipo('apartacao')}
            title="Ver Apartação"
          >
            Apartação
          </button>
          <button
            className={`h-7 px-2 rounded text-xs ${painelResumoTipo==='venda' ? 'bg-emerald-600 text-white' : 'border border-slate-300 text-slate-700'}`}
            onClick={() => setPainelResumoTipo('venda')}
            title="Ver Resumo de Venda"
          >
            Venda
          </button>
          <button
            className={`h-7 px-2 rounded text-xs ${painelResumoTipo==='abate' ? 'bg-emerald-600 text-white' : 'border border-slate-300 text-slate-700'}`}
            onClick={() => setPainelResumoTipo('abate')}
            title="Ver Abate/Documentação"
          >
            Abate
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-4 lg:grid-cols-3 gap-2">
        {/* TABELA DE PESAGENS */}
        <div className="xl:col-span-3 lg:col-span-2">
          <Card className="shadow-sm">
            <CardHeader className="py-2 px-3 bg-slate-50 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Pesagens do Dia</CardTitle>
              {/* Campo de Pesquisa + Controles */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-slate-400" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Pesquisar animal, lote..."
                    className="h-7 text-xs pl-7 w-48" />

                  {searchTerm &&
                  <button
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2">

                      <X className="w-3 h-3 text-slate-400 hover:text-slate-600" />
                    </button>
                  }
                </div>
                {searchTerm &&
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchTerm("")}
                  className="h-7 text-xs gap-1">

                    <X className="w-3 h-3" />
                    Limpar
                  </Button>
                }
                <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="h-7 w-7" title="Configurar Colunas">
                  <Settings className="w-3.5 h-3.5" />
                </Button>
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
                            key={coluna.id} className="bg-transparent text-muted-foreground px-2 text-xs font-medium text-left h-10 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"

                            onClick={() => isSortable && handleSort(coluna.id)}>

                            <div className={`flex items-center ${coluna.id === 'peso' ? 'justify-end' : ''}`}>
                              {coluna.label} {isSortable && <SortIcon column={coluna.id} />}
                            </div>
                          </TableHead>);

                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ?
                    <TableRow><TableCell colSpan={20} className="text-center py-4 text-xs">Carregando...</TableCell></TableRow> :
                    pesagensDia.length === 0 ?
                    <TableRow><TableCell colSpan={20} className="text-center py-4 text-xs text-slate-400">Nenhuma pesagem</TableCell></TableRow> :

                    pesagensDia.map((p, idx) =>
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
                                </TableCell>);

                        }
                        if (coluna.id === 'numero_registro') {
                          return <TableCell key={coluna.id} className="text-xs font-mono font-bold text-slate-700">{p._numero_registro}</TableCell>;
                        }
                        if (coluna.id === 'tipo_manejo') {
                          return (
                            <TableCell key={coluna.id} className="text-xs">
                                  <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                p.tipo_manejo === 'Cadastro' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' :
                                p.tipo_manejo === 'Saída' ? 'bg-red-50 text-red-700 border-red-300' :
                                'bg-blue-50 text-blue-700 border-blue-300'}`
                                }>

                                    {p.tipo_manejo || 'Manejo'}
                                  </Badge>
                                </TableCell>);

                        }
                        if (coluna.id === 'motivo_saida') {
                          return <TableCell key={coluna.id} className="text-xs">{p.motivo_saida || '-'}</TableCell>;
                        }
                        if (coluna.id === 'valor_pago_cabeca') {
                          return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.valor_pago_cabeca ? `R$ ${p.valor_pago_cabeca.toFixed(2)}` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'origem_animal') {
                          return <TableCell key={coluna.id} className="text-xs">{p.origem_animal || '-'}</TableCell>;
                        }
                        if (coluna.id === 'comprador') {
                          return <TableCell key={coluna.id} className="text-xs">{p.comprador || '-'}</TableCell>;
                        }
                        if (coluna.id === 'destino_venda') {
                          return <TableCell key={coluna.id} className="text-xs">{p.destino_venda || '-'}</TableCell>;
                        }
                        if (coluna.id === 'valor_venda_total') {
                          return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.valor_venda_total ? `R$ ${p.valor_venda_total.toFixed(2)}` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'valor_arroba') {
                          return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.valor_arroba ? `R$ ${p.valor_arroba.toFixed(2)}` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'quantidade_arrobas') {
                          return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.quantidade_arrobas ? `${p.quantidade_arrobas.toFixed(2)} @` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'frigorifico') {
                          return <TableCell key={coluna.id} className="text-xs">{p.frigorifico || '-'}</TableCell>;
                        }
                        if (coluna.id === 'embarque_nome') {
                          return <TableCell key={coluna.id} className="text-xs">{p.embarque_nome || '-'}</TableCell>;
                        }
                        if (coluna.id === 'documento_tipo') {
                          return <TableCell key={coluna.id} className="text-xs">{p.documento_tipo || '-'}</TableCell>;
                        }
                        if (coluna.id === 'documento_numero') {
                          return <TableCell key={coluna.id} className="text-xs">{p.documento_numero || '-'}</TableCell>;
                        }
                        if (coluna.id === 'motorista_nome') {
                          return <TableCell key={coluna.id} className="text-xs">{p.motorista_nome || '-'}</TableCell>;
                        }
                        if (coluna.id === 'placa_carreta') {
                          return <TableCell key={coluna.id} className="text-xs">{p.placa_carreta || '-'}</TableCell>;
                        }
                        if (coluna.id === 'doc_qtd') {
                          return <TableCell key={coluna.id} className="text-xs text-center">{p.documento_embarque_id ? (docCountsDia[p.documento_embarque_id] || 0) : '-'}</TableCell>;
                        }
                        if (coluna.id === 'numero_animal') {
                          return (
                            <TableCell key={coluna.id} className="text-xs font-bold">
                                  {p.numero_animal}
                                  {p._offlineId && <Badge variant="outline" className="ml-1 text-[8px] bg-amber-100 text-amber-700">P</Badge>}
                                </TableCell>);

                        }
                        if (coluna.id === 'peso') {
                          return <TableCell key={coluna.id} className="text-xs text-right font-mono">{p.peso}</TableCell>;
                        }
                        if (coluna.id === 'sanidade') {
                          const sanidades = sanidadesPorAnimal[p.numero_animal] || [];
                          return (
                            <TableCell key={coluna.id} className="text-xs text-center">
                                 {sanidades.length > 0 ?
                              <Popover>
                                     <PopoverTrigger asChild>
                                       <button className="hover:opacity-70 transition-opacity">
                                         <Syringe className="w-3.5 h-3.5 text-emerald-600 mx-auto" />
                                       </button>
                                     </PopoverTrigger>
                                     <PopoverContent className="w-80">
                                       <div className="space-y-2">
                                         <h4 className="font-semibold text-sm text-emerald-700">Sanidades Aplicadas</h4>
                                         {sanidades.map((sanidade, idx) =>
                                    <div key={idx} className="border-b pb-2 last:border-b-0">
                                             <div className="font-medium text-xs text-slate-800 mb-1">{sanidade.nome}</div>
                                             <div className="space-y-1">
                                               {sanidade.medicamentos.map((med, i) =>
                                        <div key={i} className="text-xs bg-slate-50 rounded px-2 py-1 flex justify-between">
                                                   <span className="font-medium">{med.medicamento}</span>
                                                   <span className="text-slate-600">{med.quantidade} {med.unidade}</span>
                                                 </div>
                                        )}
                                             </div>
                                             <div className="text-xs text-emerald-700 font-semibold mt-1">
                                               Total: R$ {sanidade.custoTotal.toFixed(2)}
                                             </div>
                                           </div>
                                    )}
                                       </div>
                                     </PopoverContent>
                                   </Popover> :

                              <span className="text-slate-400">-</span>
                              }
                               </TableCell>);

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
                                </TableCell>);

                        }
                        if (coluna.id === 'observacao') {
                          return <TableCell key={coluna.id} className="text-xs">{p.observacao || '-'}</TableCell>;
                        }
                        return <TableCell key={coluna.id} className="text-xs">-</TableCell>;
                      })}
                        </TableRow>
                    )
                    }
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
            {tipoManejo === 'Saída' && motivoSaida === 'Abate' && (
              <div className="flex items-center gap-1 ml-4">
                <span className="text-slate-500">{documentoSelecionado ? 'Doc Selecionado' : 'Embarque Selecionado'}</span>
                <span className="font-bold text-lg text-amber-500">{documentoSelecionado ? resumoDoc.total : resumoEmbarque.total}</span>
                <span className="text-slate-400">/</span>
                <span className="text-slate-500">M</span>
                <span className="font-bold text-lg text-amber-500">{documentoSelecionado ? resumoDoc.machos : resumoEmbarque.machos}</span>
                <span className="text-slate-400">/</span>
                <span className="text-slate-500">F</span>
                <span className="font-bold text-lg text-amber-500">{documentoSelecionado ? resumoDoc.femeas : resumoEmbarque.femeas}</span>
                <span className="text-slate-400">•</span>
                <span className="text-slate-500">Média</span>
                <span className="font-bold text-lg text-amber-500">{(documentoSelecionado ? resumoDoc.pesoMedio : resumoEmbarque.pesoMedio).toFixed(2)}</span>
              </div>
            )}
            </div>
            <Button variant="outline" size="sm" onClick={exportarExcel} className="h-7 text-xs">
              Exportar
            </Button>
          </div>
        </div>

        {/* RESUMO: Lotes ou Documentação */}
        {painelResumoTipo === 'abate' ? (
          <ResumoEmbarque
            embarques={embarques}
            documentos={documentosEmbarque}
            embarqueSelecionado={embarqueSelecionadoDoc}
            pesagens={pesagens}
            pendingPesagens={pendingPesagensDB}
          />
        ) : painelResumoTipo === 'venda' ? (
          <ResumoVendaDia
            pesagens={pesagens}
            pendingPesagensDB={pendingPesagensDB}
            dataPesagem={dataPesagem}
          />
        ) : (
          <ResumoLotes
            apartacaoSelecionada={apartacaoSelecionada}
            apartacoes={apartacoes}
            lotesApartacaoAtual={lotesApartacaoAtual}
            pesagens={pesagens}
            pesagensDia={pesagensDia}
            pendingPesagensDB={pendingPesagensDB}
            dataPesagem={dataPesagem}
          />
        )}
      </div>

      {/* RESUMO DE SANIDADES APLICADAS */}
      {apartacaoSelecionada && sanidadesAplicadas.filter((s) =>
      s.data_aplicacao === dataPesagem &&
      pesagensDia.some((p) => p.numero_animal === s.numero_animal && p.apartacao_id === apartacaoSelecionada)
      ).length > 0 &&
      <Card className="shadow-sm">
          <CardHeader className="py-2 px-3 bg-emerald-50 border-b">
            <CardTitle className="text-xs font-semibold text-emerald-700 flex items-center gap-2">
              <Syringe className="w-4 h-4" />
              Sanidades Aplicadas Hoje
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {(() => {
            // Agrupar por sanidade
            const sanidadesHoje = sanidadesAplicadas.filter((s) =>
            s.data_aplicacao === dataPesagem &&
            pesagensDia.some((p) => p.numero_animal === s.numero_animal && p.apartacao_id === apartacaoSelecionada)
            );

            const porSanidade = sanidadesHoje.reduce((acc, s) => {
              const key = s.nome_sanidade || 'Sem nome';
              if (!acc[key]) {
                acc[key] = {
                  nome: key,
                  animais: new Set(),
                  medicamentos: {},
                  custoTotal: 0
                };
              }
              acc[key].animais.add(s.numero_animal);
              if (!acc[key].medicamentos[s.medicamento]) {
                acc[key].medicamentos[s.medicamento] = {
                  nome: s.medicamento,
                  finalidade: s.finalidade,
                  quantidade: s.quantidade,
                  unidade: s.unidade_medida,
                  custo: s.custo_unitario || 0
                };
              }
              acc[key].custoTotal += s.custo_total || 0;
              return acc;
            }, {});

            return Object.values(porSanidade).map((sanidade, idx) => {
              const qtdAnimais = sanidade.animais.size;
              const custoPorAnimal = qtdAnimais > 0 ? sanidade.custoTotal / qtdAnimais : 0;

              return (
                <div key={idx} className="mb-3 last:mb-0 border rounded p-2 bg-white">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-sm font-bold text-emerald-700">{sanidade.nome}</h4>
                      <div className="text-right">
                        <div className="text-xs text-slate-600">{qtdAnimais} animais</div>
                        <div className="text-sm font-bold text-emerald-700">R$ {sanidade.custoTotal.toFixed(2)}</div>
                        <div className="text-[10px] text-slate-500">R$ {custoPorAnimal.toFixed(2)}/animal</div>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      {Object.values(sanidade.medicamentos).map((med, i) =>
                    <div key={i} className="text-xs bg-slate-50 rounded px-2 py-1 flex justify-between">
                          <div>
                            <span className="font-medium">{med.nome}</span>
                            {med.finalidade && <span className="text-slate-500"> - {med.finalidade}</span>}
                          </div>
                          <div className="text-slate-600">
                            {med.quantidade} {med.unidade} {med.custo > 0 && `(R$ ${med.custo.toFixed(2)})`}
                          </div>
                        </div>
                    )}
                    </div>
                  </div>);

            });
          })()}
          </CardContent>
        </Card>
      }

      {/* DIALOG APARTAÇÕES/LOTES */}
      <GerenciarApartacoesDialog
        open={showApartacoesDialog}
        onOpenChange={setShowApartacoesDialog}
        empresaId={empresaSelecionadaId}
        apartacoes={apartacoes}
        lotes={lotesApartacao}
        pesagens={pesagens}
        onRefresh={loadAllData}
        dbReady={dbReady} />


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
                {COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).map((coluna) =>
                <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                    type="checkbox"
                    checked={colunasVisiveis.includes(coluna.id)}
                    onChange={() => toggleColuna(coluna.id)}
                    className="rounded" />

                    <span>{coluna.label}</span>
                  </label>
                )}
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="colunas">
                  {(provided) =>
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((colunaId, index) => {
                      const coluna = COLUNAS_DISPONIVEIS.find((c) => c.id === colunaId);
                      if (!coluna || coluna.fixo) return null;

                      return (
                        <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(provided, snapshot) =>
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`flex items-center gap-2 p-2 border rounded text-xs ${
                            snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'} ${
                            !colunasVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}>

                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasVisiveis.includes(colunaId) &&
                            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">Visível</Badge>
                            }
                              </div>
                          }
                          </Draggable>);

                    })}
                      {provided.placeholder}
                    </div>
                  }
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
        onSyncComplete={loadAllData} />

      <GerenciarEmbarquesDialog
        open={dialogEmbarqueOpen}
        onOpenChange={setDialogEmbarqueOpen}
        empresaId={empresaSelecionadaId}
        embarques={embarques}
        documentos={documentosEmbarque}
        pesagens={pesagens}
        pendingPesagens={pendingPesagensDB}
        onRefresh={loadAllData}
        dbReady={dbReady}
      />


      {/* DIALOG GERENCIAR SANIDADES (CONFIGURAÇÕES) */}
      <GerenciarSanidades
        open={mostrarSanidade}
        onOpenChange={(open) => {
          setMostrarSanidade(open);
          if (!open) {
            loadAllData();
          }
        }}
        empresaId={empresaSelecionadaId}
        sanidadeAtivaId={sanidadeAtivaId}
        onSanidadeChange={(v) => {
          setSanidadeAtivaId(v);
          localStorage.setItem('sanidade_em_uso', v);
        }} />


    </div>);

}