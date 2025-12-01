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
  saveApartacaoOffline,
  getPendingApartacoes,
  deletePendingApartacao,
  cacheApartacoes,
  getCachedApartacoes,
  saveLoteOffline,
  getPendingLotes,
  deletePendingLote,
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

export default function LancamentoPesagensIndividuais() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // Estado de conexão
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

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
  const [dataPesagem, setDataPesagem] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [numeroAnimal, setNumeroAnimal] = useState("");
  const [peso, setPeso] = useState("");
  const [sexo, setSexo] = useState("M");
  const [raca, setRaca] = useState("Nelore");
  const [marca, setMarca] = useState("");
  const [observacao, setObservacao] = useState("");
  const [apartacaoSelecionada, setApartacaoSelecionada] = useState("");
  const [loteTransferencia, setLoteTransferencia] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  
  // Checkboxes para fixar valores (quando marcado, campo fica desabilitado)
  const [fixarSexo, setFixarSexo] = useState(true);
  const [fixarRaca, setFixarRaca] = useState(true);
  const [fixarMarca, setFixarMarca] = useState(false);

  // Campo de pesquisa
  const [searchTerm, setSearchTerm] = useState("");

  // Ordenação
  const [sortColumn, setSortColumn] = useState("created_date");
  const [sortDirection, setSortDirection] = useState("desc");

  // Dialog
  const [showApartacoesDialog, setShowApartacoesDialog] = useState(false);

  // ========== OFFLINE FIRST - CARREGAR DADOS ==========
  useEffect(() => {
    loadAllData();
    
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

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [empresaSelecionadaId]);

  const loadAllData = async () => {
    setIsLoading(true);
    
    // Carregar do cache primeiro
    const cachedPesagens = JSON.parse(localStorage.getItem(CACHE_KEYS.PESAGENS) || '[]');
    const cachedApartacoes = JSON.parse(localStorage.getItem(CACHE_KEYS.APARTACOES) || '[]');
    const cachedLotes = JSON.parse(localStorage.getItem(CACHE_KEYS.LOTES) || '[]');
    
    setPesagens(cachedPesagens.filter(p => p.empresa_id === empresaSelecionadaId));
    setApartacoes(cachedApartacoes.filter(a => a.empresa_id === empresaSelecionadaId));
    setLotesApartacao(cachedLotes.filter(l => l.empresa_id === empresaSelecionadaId));
    
    updatePendingCount();
    setIsLoading(false);

    // Se online, sincronizar pendentes e atualizar do servidor
    if (navigator.onLine) {
      try {
        // Sincronizar apartações pendentes
        await syncPendingApartacoesLotes();
        
        const [allPesagens, allApartacoes, allLotes] = await Promise.all([
          base44.entities.PesagemIndividual.list('-data_pesagem'),
          base44.entities.Apartacao.list(),
          base44.entities.LoteApartacao.list(),
        ]);

        const pesagensEmpresa = allPesagens.filter(p => p.empresa_id === empresaSelecionadaId);
        const apartacoesEmpresa = allApartacoes.filter(a => a.empresa_id === empresaSelecionadaId);
        const lotesEmpresa = allLotes.filter(l => l.empresa_id === empresaSelecionadaId);

        localStorage.setItem(CACHE_KEYS.PESAGENS, JSON.stringify(pesagensEmpresa));
        localStorage.setItem(CACHE_KEYS.APARTACOES, JSON.stringify(apartacoesEmpresa));
        localStorage.setItem(CACHE_KEYS.LOTES, JSON.stringify(lotesEmpresa));

        setPesagens(pesagensEmpresa);
        setApartacoes(apartacoesEmpresa);
        setLotesApartacao(lotesEmpresa);
      } catch (error) {
        console.error('Erro ao carregar dados online:', error);
      }
    }
  };

  // Sincronizar apartações e lotes pendentes
  const syncPendingApartacoesLotes = async () => {
    const pendingApartacoes = JSON.parse(localStorage.getItem('pending_apartacoes') || '[]');
    const pendingLotes = JSON.parse(localStorage.getItem('pending_lotes') || '[]');
    
    // Sincronizar apartações
    for (const item of pendingApartacoes) {
      try {
        if (item.action === 'create') {
          const { _offlineId, id, created_date, ...data } = item.data;
          await base44.entities.Apartacao.create(data);
        } else if (item.action === 'update') {
          await base44.entities.Apartacao.update(item.id, item.data);
        } else if (item.action === 'delete') {
          await base44.entities.Apartacao.delete(item.id);
        }
      } catch (error) {
        console.error('Erro ao sincronizar apartação:', error);
      }
    }
    
    // Sincronizar lotes
    for (const item of pendingLotes) {
      try {
        if (item.action === 'create') {
          const { _offlineId, id, created_date, ...data } = item.data;
          // Verificar se apartacao_id era offline e buscar o novo ID
          if (data.apartacao_id?.startsWith('offline_')) {
            const apartacoesAtuais = await base44.entities.Apartacao.list();
            const apt = apartacoesAtuais.find(a => a.nome_apartacao === data.nome_apartacao && a.empresa_id === data.empresa_id);
            if (apt) data.apartacao_id = apt.id;
          }
          await base44.entities.LoteApartacao.create(data);
        } else if (item.action === 'update') {
          await base44.entities.LoteApartacao.update(item.id, item.data);
        } else if (item.action === 'delete') {
          await base44.entities.LoteApartacao.delete(item.id);
        }
      } catch (error) {
        console.error('Erro ao sincronizar lote:', error);
      }
    }
    
    // Limpar pendentes
    if (pendingApartacoes.length > 0 || pendingLotes.length > 0) {
      localStorage.setItem('pending_apartacoes', '[]');
      localStorage.setItem('pending_lotes', '[]');
      toast.success('Apartações/Lotes sincronizados!');
    }
  };

  const updatePendingCount = () => {
    const pending = JSON.parse(localStorage.getItem(CACHE_KEYS.PENDING) || '[]');
    setPendingCount(pending.length);
  };

  // ========== SINCRONIZAÇÃO ==========
  const syncAll = async () => {
    if (!navigator.onLine) {
      toast.error("Sem conexão");
      return;
    }

    setIsSyncing(true);
    let successCount = 0;

    const pendingPesagens = JSON.parse(localStorage.getItem(CACHE_KEYS.PENDING) || '[]');
    const failedPesagens = [];

    for (const pesagem of pendingPesagens) {
      try {
        const { _offlineId, _offlineTimestamp, ...data } = pesagem;
        await base44.entities.PesagemIndividual.create(data);
        successCount++;
      } catch (error) {
        console.error('Erro ao sincronizar pesagem:', error);
        failedPesagens.push(pesagem);
      }
    }

    localStorage.setItem(CACHE_KEYS.PENDING, JSON.stringify(failedPesagens));
    updatePendingCount();

    if (successCount > 0) {
      toast.success(`✅ ${successCount} registro(s) sincronizado(s)!`);
      await loadAllData();
    }

    setIsSyncing(false);
  };

  // ========== PESAGENS DO DIA + PENDENTES + FILTRO + ORDENAÇÃO ==========
  const pesagensDia = useMemo(() => {
    const pendentes = JSON.parse(localStorage.getItem(CACHE_KEYS.PENDING) || '[]')
      .filter(p => p.data_pesagem === dataPesagem && p.empresa_id === empresaSelecionadaId)
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
  }, [pesagens, dataPesagem, pendingCount, empresaSelecionadaId, searchTerm, sortColumn, sortDirection]);

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

  // ========== LOTES DA APARTAÇÃO SELECIONADA ==========
  const lotesApartacaoAtual = useMemo(() => {
    if (!apartacaoSelecionada) return [];
    return lotesApartacao.filter(l => l.apartacao_id === apartacaoSelecionada);
  }, [apartacaoSelecionada, lotesApartacao]);

  // ========== RESUMO DE LOTES COM CONTAGEM ==========
  const resumoLotes = useMemo(() => {
    if (!apartacaoSelecionada) return [];
    
    const todasPesagensApartacao = [
      ...pesagens.filter(p => p.apartacao_id === apartacaoSelecionada),
      ...JSON.parse(localStorage.getItem(CACHE_KEYS.PENDING) || '[]')
        .filter(p => p.apartacao_id === apartacaoSelecionada)
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
  }, [apartacaoSelecionada, lotesApartacaoAtual, pesagens, pendingCount]);

  // ========== ESTATÍSTICAS DO DIA ==========
  const estatisticas = useMemo(() => {
    const total = pesagensDia.length;
    const machos = pesagensDia.filter(p => p.sexo === 'M').length;
    const femeas = pesagensDia.filter(p => p.sexo === 'F').length;
    const pesoMedio = total > 0 ? pesagensDia.reduce((s, p) => s + (p.peso || 0), 0) / total : 0;
    return { total, machos, femeas, pesoMedio };
  }, [pesagensDia]);

  // ========== DETERMINAR LOTE AUTOMATICAMENTE ==========
  const getLoteAutomatico = (pesoNum) => {
    if (!apartacaoSelecionada || !pesoNum) return null;
    const lote = lotesApartacaoAtual.find(l => 
      pesoNum >= l.peso_minimo && pesoNum <= l.peso_maximo && !l.fechado
    );
    return lote;
  };

  // ========== SALVAR PESAGEM ==========
  const handleSalvar = async () => {
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

    // Verificar duplicado
    if (!editingId) {
      const duplicado = pesagensDia.find(p => p.numero_animal === numeroAnimal.trim());
      if (duplicado) { 
        toast.error("⚠️ Animal já pesado hoje! Nº: " + numeroAnimal); 
        return; 
      }
    }

    setIsSaving(true);

    const pesoNum = parseFloat(peso);
    
    // Buscar histórico para cálculo de ganho
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

    // Determinar lote
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
      empresa_id: empresaSelecionadaId,
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
      if (navigator.onLine && !editingId) {
        await base44.entities.PesagemIndividual.create(data);
        toast.success('✓ Salvo!');
        await loadAllData();
      } else if (navigator.onLine && editingId) {
        await base44.entities.PesagemIndividual.update(editingId, data);
        toast.success('✓ Atualizado!');
        await loadAllData();
      } else {
        const pending = JSON.parse(localStorage.getItem(CACHE_KEYS.PENDING) || '[]');
        pending.push({
          ...data,
          _offlineId: Date.now(),
          _offlineTimestamp: new Date().toISOString()
        });
        localStorage.setItem(CACHE_KEYS.PENDING, JSON.stringify(pending));
        updatePendingCount();
        toast.success('💾 Salvo offline');
      }

      // Limpar formulário (mantém campos fixados)
      setEditingId(null);
      setNumeroAnimal("");
      setPeso("");
      if (!fixarSexo) setSexo("");
      if (!fixarRaca) setRaca("");
      if (!fixarMarca) setMarca("");
      setObservacao("");
      setLoteTransferencia("");
      setTimeout(() => numeroInputRef.current?.focus(), 50);
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // ========== EXCLUIR PESAGEM ==========
  const handleExcluir = async (pesagem) => {
    if (pesagem._offlineId) {
      const pending = JSON.parse(localStorage.getItem(CACHE_KEYS.PENDING) || '[]');
      const updated = pending.filter(p => p._offlineId !== pesagem._offlineId);
      localStorage.setItem(CACHE_KEYS.PENDING, JSON.stringify(updated));
      updatePendingCount();
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
    setEditingId(p.id);
    setNumeroAnimal(p.numero_animal);
    setPeso(String(p.peso));
    setSexo(p.sexo || "M");
    setRaca(p.raca || "Nelore");
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
    const headers = ['Identificação', 'Peso', 'Data', 'Sexo', 'Raça', 'Marca', 'Apartação', 'Lote'];
    const rows = pesagensDia.map(p => [
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
    a.download = `pesagens_${dataPesagem}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exportado!');
  };

  return (
    <div className="p-3 space-y-2 bg-slate-100 min-h-screen">
      {/* HEADER */}
      <div className="flex justify-between items-center bg-white rounded px-3 py-2 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-slate-800">Lançamento de Pesagens</h1>
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
          {pendingCount > 0 && isOnline && (
            <Button variant="outline" size="sm" onClick={syncAll} disabled={isSyncing} className="h-7 text-xs gap-1">
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              Sincronizar
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowApartacoesDialog(true)} className="h-7 text-xs gap-1">
            <Settings className="w-3 h-3" />Apartações
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadAllData()} className="h-7 text-xs gap-1">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* FORMULÁRIO DE LANÇAMENTO */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
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
              <Select value={sexo} onValueChange={setSexo} disabled={fixarSexo && sexo}>
                <SelectTrigger className={`h-9 text-sm w-20 ${fixarSexo ? 'bg-slate-100' : ''}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">M</SelectItem>
                  <SelectItem value="F">F</SelectItem>
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
              <Input 
                value={raca} 
                onChange={(e) => setRaca(e.target.value)} 
                className={`h-9 text-sm w-28 ${fixarRaca ? 'bg-slate-100' : ''}`}
                placeholder="Nelore"
                disabled={fixarRaca && raca}
              />
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
              <Input 
                value={marca} 
                onChange={(e) => setMarca(e.target.value)} 
                className={`h-9 text-sm w-24 ${fixarMarca ? 'bg-slate-100' : ''}`}
                placeholder="Ex: ABC"
                disabled={fixarMarca && marca}
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
                className="h-9 text-sm w-32 font-bold border-2 border-slate-300 focus:border-emerald-500"
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
                className="h-9 text-sm w-24 font-bold border-2 border-slate-300 focus:border-emerald-500"
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
            <Button onClick={handleSalvar} disabled={isSaving} className="h-9 gap-2 bg-emerald-600 hover:bg-emerald-700 px-4">
              <Save className="w-4 h-4" />
              {isSaving ? 'Salvando...' : (editingId ? 'Atualizar' : 'Salvar Registro')}
            </Button>
            {editingId && (
              <Button 
                variant="outline" 
                onClick={() => {
                  setEditingId(null);
                  setNumeroAnimal("");
                  setPeso("");
                  setObservacao("");
                  setLoteTransferencia("");
                  if (!fixarSexo) setSexo("M");
                  if (!fixarRaca) setRaca("Nelore");
                  if (!fixarMarca) setMarca("");
                  setTimeout(() => numeroInputRef.current?.focus(), 50);
                }} 
                className="h-9 gap-2 px-4"
              >
                <X className="w-4 h-4" />
                Cancelar Edição
              </Button>
            )}
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
                  {lotesApartacaoAtual.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.nome_lote} ({l.peso_minimo}-{l.peso_maximo}kg)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {peso && apartacaoSelecionada && !loteTransferencia && (
              <div className="text-sm font-semibold text-orange-600 bg-orange-50 px-3 py-1.5 rounded border border-orange-200">
                <ChevronRight className="w-4 h-4 inline" />
                Lote: {getLoteAutomatico(parseFloat(peso))?.nome_lote || 'Não encontrado'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ÁREA PRINCIPAL: TABELA + RESUMO DE LOTES */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
        {/* TABELA DE PESAGENS */}
        <div className="lg:col-span-3">
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
                      <TableHead className="text-xs w-10">Ações</TableHead>
                      <TableHead 
                        className="text-xs w-16 cursor-pointer hover:bg-slate-200 select-none"
                        onClick={() => handleSort('numero_registro')}
                      >
                        <div className="flex items-center">Nº <SortIcon column="numero_registro" /></div>
                      </TableHead>
                      <TableHead 
                        className="text-xs cursor-pointer hover:bg-slate-200 select-none"
                        onClick={() => handleSort('numero_animal')}
                      >
                        <div className="flex items-center">Identificação <SortIcon column="numero_animal" /></div>
                      </TableHead>
                      <TableHead 
                        className="text-xs text-right cursor-pointer hover:bg-slate-200 select-none"
                        onClick={() => handleSort('peso')}
                      >
                        <div className="flex items-center justify-end">Peso <SortIcon column="peso" /></div>
                      </TableHead>
                      <TableHead className="text-xs">Data</TableHead>
                      <TableHead 
                        className="text-xs cursor-pointer hover:bg-slate-200 select-none"
                        onClick={() => handleSort('sexo')}
                      >
                        <div className="flex items-center">Sexo <SortIcon column="sexo" /></div>
                      </TableHead>
                      <TableHead 
                        className="text-xs cursor-pointer hover:bg-slate-200 select-none"
                        onClick={() => handleSort('raca')}
                      >
                        <div className="flex items-center">Raça <SortIcon column="raca" /></div>
                      </TableHead>
                      <TableHead 
                        className="text-xs cursor-pointer hover:bg-slate-200 select-none"
                        onClick={() => handleSort('marca')}
                      >
                        <div className="flex items-center">Marca <SortIcon column="marca" /></div>
                      </TableHead>
                      <TableHead 
                        className="text-xs cursor-pointer hover:bg-slate-200 select-none"
                        onClick={() => handleSort('nome_apartacao')}
                      >
                        <div className="flex items-center">Apartação <SortIcon column="nome_apartacao" /></div>
                      </TableHead>
                      <TableHead 
                        className="text-xs cursor-pointer hover:bg-slate-200 select-none"
                        onClick={() => handleSort('nome_lote')}
                      >
                        <div className="flex items-center">Lote <SortIcon column="nome_lote" /></div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-4 text-xs">Carregando...</TableCell></TableRow>
                    ) : pesagensDia.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-4 text-xs text-slate-400">Nenhuma pesagem</TableCell></TableRow>
                    ) : (
                      pesagensDia.map((p, idx) => (
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
                          <TableCell className="text-xs font-mono text-slate-500">
                            {p._numero_registro}
                          </TableCell>
                          <TableCell className="text-xs font-bold">
                            {p.numero_animal}
                            {p._offlineId && <Badge variant="outline" className="ml-1 text-[8px] bg-amber-100 text-amber-700">P</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono">{p.peso}</TableCell>
                          <TableCell className="text-xs">{formatarData(p.data_pesagem)}</TableCell>
                          <TableCell className="text-xs">{p.sexo || '-'}</TableCell>
                          <TableCell className="text-xs">{p.raca || '-'}</TableCell>
                          <TableCell className="text-xs">{p.marca || '-'}</TableCell>
                          <TableCell className="text-xs">{p.nome_apartacao || '-'}</TableCell>
                          <TableCell className="text-xs font-medium">{p.nome_lote || '-'}</TableCell>
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
            <Button variant="outline" size="sm" onClick={exportarExcel} className="h-7 text-xs gap-1">
              <Download className="w-3 h-3" />Exportar
            </Button>
          </div>
        </div>

        {/* RESUMO DE LOTES */}
        <div className="lg:col-span-1">
          <Card className="shadow-sm sticky top-2">
            <CardHeader className="py-2 px-3 bg-slate-200 border-b">
              <CardTitle className="text-xs font-semibold">Distribuição de Lotes</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {apartacaoSelecionada && resumoLotes.length > 0 ? (
                <>
                  <div className="text-center mb-2 py-2 bg-emerald-50 rounded">
                    <span className="text-lg font-bold text-emerald-800">
                      {apartacoes.find(a => a.id === apartacaoSelecionada)?.nome_apartacao}
                    </span>
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
                      {resumoLotes.map(lote => (
                        <TableRow key={lote.id}>
                          <TableCell className="text-xs font-medium">{lote.nome_lote}</TableCell>
                          <TableCell className="text-xs text-right">{lote.quantidade_atual}/{lote.quantidade_maxima}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{lote.peso_medio.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-2 pt-2 border-t text-xs text-center text-slate-500">
                    Qtd. Lançada: {resumoLotes.reduce((s, l) => s + l.quantidade_atual, 0)}
                  </div>
                </>
              ) : (
                <div className="text-center py-6 text-slate-400 text-xs">
                  Selecione uma apartação para ver os lotes
                </div>
              )}
            </CardContent>
          </Card>
        </div>
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
      />
    </div>
  );
}

// ========== DIALOG PARA GERENCIAR APARTAÇÕES E LOTES ==========
function GerenciarApartacoesDialog({ open, onOpenChange, empresaId, apartacoes, lotes, pesagens, onRefresh }) {
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

  const salvarApartacao = async () => {
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
            if (editingApartacaoId) {
              await base44.entities.Apartacao.update(editingApartacaoId, data);

              const pesagensVinculadas = pesagens.filter(p => p.apartacao_id === editingApartacaoId);
              for (const p of pesagensVinculadas) {
                await base44.entities.PesagemIndividual.update(p.id, { nome_apartacao: nomeApartacao.trim() });
              }

              const lotesVinculados = lotes.filter(l => l.apartacao_id === editingApartacaoId);
              for (const l of lotesVinculados) {
                await base44.entities.LoteApartacao.update(l.id, { nome_apartacao: nomeApartacao.trim() });
              }

              toast.success("Apartação atualizada!");
            } else {
              await base44.entities.Apartacao.create(data);
              toast.success("Apartação criada!");
            }
            onRefresh();
          } else {
            // OFFLINE: Salvar localmente
            const cachedApartacoes = JSON.parse(localStorage.getItem(CACHE_KEYS.APARTACOES) || '[]');

            if (editingApartacaoId) {
              const idx = cachedApartacoes.findIndex(a => a.id === editingApartacaoId);
              if (idx !== -1) {
                cachedApartacoes[idx] = { ...cachedApartacoes[idx], ...data };
                localStorage.setItem(CACHE_KEYS.APARTACOES, JSON.stringify(cachedApartacoes));

                // Salvar ação pendente para sincronizar depois
                const pending = JSON.parse(localStorage.getItem('pending_apartacoes') || '[]');
                pending.push({ action: 'update', id: editingApartacaoId, data, timestamp: Date.now() });
                localStorage.setItem('pending_apartacoes', JSON.stringify(pending));

                toast.success("Apartação atualizada offline!");
              }
            } else {
              const novaApartacao = { 
                ...data, 
                id: `offline_${Date.now()}`, 
                _offlineId: Date.now(),
                created_date: new Date().toISOString() 
              };
              cachedApartacoes.push(novaApartacao);
              localStorage.setItem(CACHE_KEYS.APARTACOES, JSON.stringify(cachedApartacoes));

              const pending = JSON.parse(localStorage.getItem('pending_apartacoes') || '[]');
              pending.push({ action: 'create', data: novaApartacao, timestamp: Date.now() });
              localStorage.setItem('pending_apartacoes', JSON.stringify(pending));

              toast.success("Apartação criada offline!");
            }
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
            if (editingLoteId) {
              await base44.entities.LoteApartacao.update(editingLoteId, data);

              const pesagensVinculadas = pesagens.filter(p => p.lote_id === editingLoteId);
              for (const p of pesagensVinculadas) {
                await base44.entities.PesagemIndividual.update(p.id, { nome_lote: nomeLote.trim() });
              }

              toast.success("Lote atualizado!");
            } else {
              await base44.entities.LoteApartacao.create(data);
              toast.success("Lote criado!");
            }
            onRefresh();
          } else {
            // OFFLINE: Salvar localmente
            const cachedLotes = JSON.parse(localStorage.getItem(CACHE_KEYS.LOTES) || '[]');

            if (editingLoteId) {
              const idx = cachedLotes.findIndex(l => l.id === editingLoteId);
              if (idx !== -1) {
                cachedLotes[idx] = { ...cachedLotes[idx], ...data };
                localStorage.setItem(CACHE_KEYS.LOTES, JSON.stringify(cachedLotes));

                const pending = JSON.parse(localStorage.getItem('pending_lotes') || '[]');
                pending.push({ action: 'update', id: editingLoteId, data, timestamp: Date.now() });
                localStorage.setItem('pending_lotes', JSON.stringify(pending));

                toast.success("Lote atualizado offline!");
              }
            } else {
              const novoLote = { 
                ...data, 
                id: `offline_${Date.now()}`, 
                _offlineId: Date.now(),
                created_date: new Date().toISOString() 
              };
              cachedLotes.push(novoLote);
              localStorage.setItem(CACHE_KEYS.LOTES, JSON.stringify(cachedLotes));

              const pending = JSON.parse(localStorage.getItem('pending_lotes') || '[]');
              pending.push({ action: 'create', data: novoLote, timestamp: Date.now() });
              localStorage.setItem('pending_lotes', JSON.stringify(pending));

              toast.success("Lote criado offline!");
            }
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
          toast.error(`Não é possível excluir! Existem ${pesagensVinculadas.length} pesagens vinculadas a esta apartação.`);
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
          // OFFLINE: Excluir localmente
          const cachedApartacoes = JSON.parse(localStorage.getItem(CACHE_KEYS.APARTACOES) || '[]');
          const cachedLotes = JSON.parse(localStorage.getItem(CACHE_KEYS.LOTES) || '[]');

          // Remover lotes vinculados
          const lotesAtualizados = cachedLotes.filter(l => l.apartacao_id !== id);
          localStorage.setItem(CACHE_KEYS.LOTES, JSON.stringify(lotesAtualizados));

          // Remover apartação
          const apartacoesAtualizadas = cachedApartacoes.filter(a => a.id !== id);
          localStorage.setItem(CACHE_KEYS.APARTACOES, JSON.stringify(apartacoesAtualizadas));

          // Registrar exclusão pendente (se não for item criado offline)
          if (!id.startsWith('offline_')) {
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
          toast.error(`Não é possível excluir! Existem ${pesagensVinculadas.length} pesagens vinculadas a este lote.`);
          return;
        }

        if (!confirm("Excluir lote?")) return;

        if (navigator.onLine) {
          await base44.entities.LoteApartacao.delete(id);
          toast.success("Lote excluído!");
          onRefresh();
        } else {
          // OFFLINE: Excluir localmente
          const cachedLotes = JSON.parse(localStorage.getItem(CACHE_KEYS.LOTES) || '[]');
          const lotesAtualizados = cachedLotes.filter(l => l.id !== id);
          localStorage.setItem(CACHE_KEYS.LOTES, JSON.stringify(lotesAtualizados));

          if (!id.startsWith('offline_')) {
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
                <Button onClick={salvarApartacao} disabled={isSaving} size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-3 h-3 mr-1" />{editingApartacaoId ? 'Atualizar' : 'Adicionar'}
                </Button>
                {editingApartacaoId && (
                  <Button variant="outline" size="sm" className="h-9" onClick={() => { setEditingApartacaoId(null); setNomeApartacao(""); }}>
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
                  <Button onClick={salvarLote} disabled={isSaving} size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="w-3 h-3 mr-1" />{editingLoteId ? 'Atualizar' : 'Adicionar'}
                  </Button>
                  {editingLoteId && (
                    <Button variant="outline" size="sm" className="h-9" onClick={() => { 
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