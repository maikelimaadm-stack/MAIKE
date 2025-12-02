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
import { Scale, Save, Trash2, Edit2, RefreshCw, WifiOff, Wifi, Plus, ChevronRight, MoreVertical, Search, X, ArrowUpDown, ArrowUp, ArrowDown, Database } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";

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
  clearAllCache,
  deleteItem,
  STORES_NAMES,
} from "../components/offline/IndexedDBManager";
import { syncAll, addSyncListener } from "../components/offline/SyncManager";
import ComboboxComNovo from "../components/pecuaria/ComboboxComNovo";

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const dataStr = dataString.split('T')[0];
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
  } catch { return '--/--/----'; }
};

export default function LancamentoPesagensIndividuais() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // Estado de conexão
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbReady, setDbReady] = useState(false);

  // Refs
  const numeroInputRef = useRef(null);
  const pesoInputRef = useRef(null);

  // Dados
  const [pesagens, setPesagens] = useState([]);
  const [apartacoes, setApartacoes] = useState([]);
  const [lotesApartacao, setLotesApartacao] = useState([]);
  const [pendingPesagensDB, setPendingPesagensDB] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Formulário
  const [editingId, setEditingId] = useState(null);
  const [editingSyncId, setEditingSyncId] = useState(null);
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
  
  // Fixar campos
  const [fixarSexo, setFixarSexo] = useState(true);
  const [fixarRaca, setFixarRaca] = useState(true);
  const [fixarEra, setFixarEra] = useState(false);
  const [fixarMarca, setFixarMarca] = useState(false);

  // Pesquisa e ordenação
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState("created_date");
  const [sortDirection, setSortDirection] = useState("desc");

  // Dialogs
  const [showApartacoesDialog, setShowApartacoesDialog] = useState(false);

  // ========== INICIALIZAÇÃO ==========
  useEffect(() => {
    const init = async () => {
      try {
        await initDB();
        setDbReady(true);
        await loadAllData();
      } catch (error) {
        console.error('Erro IndexedDB:', error);
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
        toast.success(event.message);
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
      if (dbReady) {
        // Carregar do cache
        const [cachedP, cachedA, cachedL] = await Promise.all([
          getCachedPesagens(empresaSelecionadaId),
          getCachedApartacoes(empresaSelecionadaId),
          getCachedLotes(empresaSelecionadaId),
        ]);
        
        setPesagens(cachedP);
        setApartacoes(cachedA);
        setLotesApartacao(cachedL);
        
        // Carregar pendentes
        const pending = await getPendingPesagens(empresaSelecionadaId);
        setPendingPesagensDB(pending);
      }
      
      await updatePendingCount();
      setIsLoading(false);

      // Se online, atualizar do servidor
      if (navigator.onLine) {
        const [allP, allA, allL] = await Promise.all([
          base44.entities.PesagemIndividual.list('-data_pesagem'),
          base44.entities.Apartacao.list(),
          base44.entities.LoteApartacao.list(),
        ]);

        const pesagensE = allP.filter(p => p.empresa_id === empresaSelecionadaId);
        const apartacoesE = allA.filter(a => a.empresa_id === empresaSelecionadaId);
        const lotesE = allL.filter(l => l.empresa_id === empresaSelecionadaId);

        if (dbReady) {
          await Promise.all([
            cachePesagens(pesagensE),
            cacheApartacoes(apartacoesE),
            cacheLotes(lotesE),
          ]);
        }

        setPesagens(pesagensE);
        setApartacoes(apartacoesE);
        setLotesApartacao(lotesE);
        
        // Recarregar pendentes após cache
        if (dbReady) {
          const pending = await getPendingPesagens(empresaSelecionadaId);
          setPendingPesagensDB(pending);
        }
      }
    } catch (error) {
      console.error('Erro carregar:', error);
      setIsLoading(false);
    }
  };

  const updatePendingCount = async () => {
    try {
      if (dbReady) {
        const counts = await getPendingCounts();
        setPendingCount(counts.total);
      }
    } catch (error) {
      console.error('Erro contagem:', error);
    }
  };

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
      }
    } catch (error) {
      toast.error('Erro sync');
    } finally {
      setIsSyncing(false);
    }
  };

  // ========== PESAGENS DO DIA ==========
  const pesagensDia = useMemo(() => {
    const pendentes = pendingPesagensDB
      .filter(p => p.data_pesagem === dataPesagem)
      .map((p, idx) => ({ ...p, _numero_registro: `P${idx + 1}`, _isPending: true }));
    
    const sincronizadas = pesagens
      .filter(p => p.data_pesagem === dataPesagem)
      .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0))
      .map((p, idx) => ({ ...p, _numero_registro: idx + 1 }));
    
    let resultado = [...pendentes, ...sincronizadas];
    
    // Filtrar
    if (searchTerm.trim()) {
      const termo = searchTerm.toLowerCase();
      resultado = resultado.filter(p => 
        p.numero_animal?.toLowerCase().includes(termo) ||
        p.nome_lote?.toLowerCase().includes(termo)
      );
    }

    // Ordenar
    resultado.sort((a, b) => {
      if (sortColumn === 'created_date') {
        return sortDirection === 'desc' 
          ? new Date(b.createdAt || b.created_date || 0) - new Date(a.createdAt || a.created_date || 0)
          : new Date(a.createdAt || a.created_date || 0) - new Date(b.createdAt || b.created_date || 0);
      }
      return 0;
    });
    
    return resultado;
  }, [pesagens, dataPesagem, pendingPesagensDB, searchTerm, sortColumn, sortDirection]);

  // ========== LOTES DA APARTAÇÃO ==========
  const lotesApartacaoAtual = useMemo(() => {
    if (!apartacaoSelecionada) return [];
    return lotesApartacao.filter(l => l.apartacao_id === apartacaoSelecionada);
  }, [apartacaoSelecionada, lotesApartacao]);

  // ========== ESTATÍSTICAS ==========
  const estatisticas = useMemo(() => {
    const total = pesagensDia.length;
    const machos = pesagensDia.filter(p => p.sexo === 'M').length;
    const femeas = pesagensDia.filter(p => p.sexo === 'F').length;
    const pesoMedio = total > 0 ? pesagensDia.reduce((s, p) => s + (p.peso || 0), 0) / total : 0;
    return { total, machos, femeas, pesoMedio };
  }, [pesagensDia]);

  // ========== LOTE AUTOMÁTICO ==========
  const getLoteAutomatico = (pesoNum) => {
    if (!apartacaoSelecionada || !pesoNum) return null;
    return lotesApartacaoAtual.find(l => 
      pesoNum >= l.peso_minimo && pesoNum <= l.peso_maximo && !l.fechado
    );
  };

  // ========== SALVAR PESAGEM ==========
  const handleSalvar = async () => {
    if (isSaving) return;
    
    if (!dataPesagem) { toast.error("Data obrigatória"); return; }
    if (!numeroAnimal?.trim()) { toast.error("Nº Identificação obrigatório"); return; }
    if (!peso || parseFloat(peso) <= 0) { toast.error("Peso obrigatório"); return; }

    // Verificar duplicado
    if (!editingId && !editingSyncId) {
      const duplicado = pesagensDia.find(p => p.numero_animal === numeroAnimal.trim());
      if (duplicado) { 
        toast.error("Animal já pesado hoje!"); 
        return; 
      }
    }

    setIsSaving(true);

    const pesoNum = parseFloat(peso);
    
    // Buscar histórico
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
      era: era || null,
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
      if (navigator.onLine && !editingSyncId) {
        // ONLINE: Salvar direto no servidor
        if (editingId) {
          await base44.entities.PesagemIndividual.update(editingId, data);
          toast.success('Atualizado!');
        } else {
          await base44.entities.PesagemIndividual.create(data);
          toast.success('Salvo!');
        }
        await loadAllData();
      } else {
        // OFFLINE: Salvar no IndexedDB
        if (editingSyncId) {
          await deletePendingPesagem(editingSyncId);
        }
        await savePesagemOffline(data);
        const pending = await getPendingPesagens(empresaSelecionadaId);
        setPendingPesagensDB(pending);
        await updatePendingCount();
        toast.success('💾 Salvo offline');
      }

      // Limpar formulário
      setEditingId(null);
      setEditingSyncId(null);
      setNumeroAnimal("");
      setPeso("");
      if (!fixarSexo) setSexo("M");
      if (!fixarRaca) setRaca("Nelore");
      if (!fixarEra) setEra("");
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

  // ========== EXCLUIR ==========
  const handleExcluir = async (pesagem) => {
    if (pesagem._syncId) {
      await deletePendingPesagem(pesagem._syncId);
      const pending = await getPendingPesagens(empresaSelecionadaId);
      setPendingPesagensDB(pending);
      await updatePendingCount();
      toast.success('Removido');
    } else if (navigator.onLine) {
      await base44.entities.PesagemIndividual.delete(pesagem.id);
      toast.success('Excluído');
      await loadAllData();
    } else {
      toast.error('Exclusão requer conexão');
    }
  };

  // ========== EDITAR ==========
  const handleEditar = (p) => {
    setEditingId(p.id || null);
    setEditingSyncId(p._syncId || null);
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

  // ========== AUTOCOMPLETE ==========
  const marcasExistentes = useMemo(() => [...new Set(pesagens.map(p => p.marca).filter(Boolean))].sort(), [pesagens]);
  const racasExistentes = useMemo(() => [...new Set(pesagens.map(p => p.raca).filter(Boolean))].sort(), [pesagens]);
  const erasExistentes = useMemo(() => [...new Set(pesagens.map(p => p.era).filter(Boolean))].sort(), [pesagens]);

  return (
    <div className="p-3 space-y-2 bg-slate-100 min-h-screen">
      {/* HEADER */}
      <div className="flex justify-between items-center bg-white rounded px-3 py-2 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-900">Lançamento de Pesagens</h1>
          {isOnline ? (
            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
              <Wifi className="w-3 h-3 mr-1" />Online
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700">
              <WifiOff className="w-3 h-3 mr-1" />Offline
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge className="text-[10px] bg-blue-500">{pendingCount} pendente(s)</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {pendingCount > 0 && isOnline && (
            <Button size="sm" onClick={handleSyncAll} disabled={isSyncing} className="h-8 text-xs gap-1 bg-slate-700">
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              Sincronizar
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowApartacoesDialog(true)} className="h-8 text-xs">
            Apartações
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={async () => {
              if (!navigator.onLine) {
                toast.error("Precisa estar online");
                return;
              }
              if (confirm("Limpar tudo e recarregar?")) {
                await clearAllCache();
                setPendingPesagensDB([]);
                setPendingCount(0);
                toast.success("Limpo!");
                await loadAllData();
              }
            }} 
            className="h-8 text-xs text-orange-600 border-orange-300"
          >
            Limpar Cache
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadAllData()} className="h-8 text-xs">
            Atualizar
          </Button>
        </div>
      </div>

      {/* FORMULÁRIO */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Data <span className="text-red-500">*</span></Label>
              <Input type="date" value={dataPesagem} onChange={(e) => setDataPesagem(e.target.value)} className="h-9 text-sm w-40" />
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Sexo</Label>
                <Checkbox checked={fixarSexo} onCheckedChange={setFixarSexo} className="h-3 w-3" />
              </div>
              <Select value={sexo} onValueChange={setSexo}>
                <SelectTrigger className="h-9 text-sm w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">M</SelectItem>
                  <SelectItem value="F">F</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Raça</Label>
                <Checkbox checked={fixarRaca} onCheckedChange={setFixarRaca} className="h-3 w-3" />
              </div>
              <ComboboxComNovo value={raca} onChange={setRaca} options={racasExistentes} placeholder="Nelore" className="w-28" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Era</Label>
                <Checkbox checked={fixarEra} onCheckedChange={setFixarEra} className="h-3 w-3" />
              </div>
              <ComboboxComNovo value={era} onChange={setEra} options={erasExistentes} placeholder="Ex: 2A" className="w-24" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Marca</Label>
                <Checkbox checked={fixarMarca} onCheckedChange={setFixarMarca} className="h-3 w-3" />
              </div>
              <ComboboxComNovo value={marca} onChange={setMarca} options={marcasExistentes} placeholder="Ex: ABC" className="w-24" />
            </div>
            
            <div className="space-y-1">
              <Label className="text-xs">Nº Ident. <span className="text-red-500">*</span></Label>
              <Input 
                ref={numeroInputRef}
                value={numeroAnimal} 
                onChange={(e) => setNumeroAnimal(e.target.value)} 
                className="h-10 w-36 font-bold text-amber-500 text-lg"
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Peso (kg) <span className="text-red-500">*</span></Label>
              <Input 
                ref={pesoInputRef}
                type="number"
                value={peso} 
                onChange={(e) => setPeso(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' && handleSalvar()}
                className="h-10 w-28 font-bold text-amber-500 text-lg"
              />
            </div>
            
            <div className="space-y-1">
              <Label className="text-xs">Obs</Label>
              <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} className="h-9 text-sm w-44" />
            </div>
            
            <Button onClick={handleSalvar} disabled={isSaving} className="h-9 px-4 bg-slate-700">
              {isSaving ? 'Salvando...' : (editingId || editingSyncId ? 'Atualizar' : 'Salvar')}
            </Button>
            {(editingId || editingSyncId) && (
              <Button variant="outline" onClick={() => {
                setEditingId(null);
                setEditingSyncId(null);
                setNumeroAnimal("");
                setPeso("");
                setObservacao("");
              }} className="h-9">
                Cancelar
              </Button>
            )}
          </div>
          
          {/* Apartação e Lote */}
          <div className="flex flex-wrap items-end gap-4 mt-3 pt-3 border-t">
            <div className="space-y-1">
              <Label className="text-xs">Apartação</Label>
              <Select value={apartacaoSelecionada} onValueChange={(v) => { setApartacaoSelecionada(v); setLoteTransferencia(""); }}>
                <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Nenhuma</SelectItem>
                  {apartacoes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome_apartacao}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Transferência de Lote:</Label>
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
              <div className="text-base font-bold text-orange-700 bg-orange-100 px-4 py-2 rounded border-2 border-orange-300">
                <ChevronRight className="w-5 h-5 inline" />
                Lote: {getLoteAutomatico(parseFloat(peso))?.nome_lote || 'Não encontrado'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* TABELA */}
      <Card className="shadow-sm">
        <CardHeader className="py-2 px-3 bg-slate-50 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold">Pesagens do Dia</CardTitle>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-slate-400" />
            <Input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar..."
              className="h-7 text-xs pl-7 w-48"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[400px]">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100">
                <TableRow>
                  <TableHead className="text-xs w-10">Ações</TableHead>
                  <TableHead className="text-xs">Nº</TableHead>
                  <TableHead className="text-xs">Identificação</TableHead>
                  <TableHead className="text-xs text-right">Peso</TableHead>
                  <TableHead className="text-xs">Sexo</TableHead>
                  <TableHead className="text-xs">Raça</TableHead>
                  <TableHead className="text-xs">Lote</TableHead>
                  <TableHead className="text-xs text-right">GMD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-4 text-xs">Carregando...</TableCell></TableRow>
                ) : pesagensDia.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-4 text-xs text-slate-400">Nenhuma pesagem</TableCell></TableRow>
                ) : (
                  pesagensDia.map((p) => (
                    <TableRow key={p.id || p._syncId} className={p._isPending ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                      <TableCell>
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
                      <TableCell className="text-xs font-mono">{p._numero_registro}</TableCell>
                      <TableCell className="text-xs font-bold">
                        {p.numero_animal}
                        {p._isPending && <Badge variant="outline" className="ml-1 text-[8px] bg-amber-100">P</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">{p.peso}</TableCell>
                      <TableCell className="text-xs">{p.sexo || '-'}</TableCell>
                      <TableCell className="text-xs">{p.raca || '-'}</TableCell>
                      <TableCell className="text-xs font-medium">{p.nome_lote || '-'}</TableCell>
                      <TableCell className={`text-xs text-right font-mono ${p.gmd > 0 ? 'text-emerald-600' : p.gmd < 0 ? 'text-red-600' : ''}`}>
                        {p.gmd ? p.gmd.toFixed(3) : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* RODAPÉ */}
      <div className="flex items-center justify-between bg-white rounded px-3 py-2 shadow-sm">
        <div className="flex items-center gap-6 text-xs">
          <div><span className="text-slate-500">Total:</span> <span className="font-bold text-lg">{estatisticas.total}</span></div>
          <div><span className="text-slate-500">Machos:</span> <span className="font-bold">{estatisticas.machos}</span></div>
          <div><span className="text-slate-500">Fêmeas:</span> <span className="font-bold">{estatisticas.femeas}</span></div>
          <div><span className="text-slate-500">Peso Médio:</span> <span className="font-bold">{estatisticas.pesoMedio.toFixed(2)}</span></div>
        </div>
      </div>

      {/* DIALOG APARTAÇÕES */}
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
    </div>
  );
}

// ========== DIALOG APARTAÇÕES ==========
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
    if (isSaving) return;
    if (!nomeApartacao.trim()) { toast.error("Nome obrigatório"); return; }

    // Verificar duplicado
    const duplicado = apartacoes.find(a => 
      a.nome_apartacao.toUpperCase() === nomeApartacao.trim().toUpperCase() && 
      a.id !== editingApartacaoId
    );
    if (duplicado) { toast.error("Já existe!"); return; }

    setIsSaving(true);
    const data = { empresa_id: empresaId, nome_apartacao: nomeApartacao.trim() };

    try {
      if (navigator.onLine) {
        if (editingApartacaoId) {
          await base44.entities.Apartacao.update(editingApartacaoId, data);
          toast.success("Atualizado!");
        } else {
          await base44.entities.Apartacao.create(data);
          toast.success("Criado!");
        }
      } else {
        if (editingApartacaoId) {
          toast.error("Edição requer conexão");
          setIsSaving(false);
          return;
        }
        await saveApartacaoOffline(data);
        toast.success("💾 Salvo offline!");
      }
      setNomeApartacao(""); 
      setEditingApartacaoId(null);
      onRefresh();
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const salvarLote = async () => {
    if (isSaving) return;
    if (!apartacaoIdLote) { toast.error("Selecione apartação"); return; }
    if (!nomeLote.trim()) { toast.error("Nome obrigatório"); return; }
    if (!pesoMinimo || !pesoMaximo) { toast.error("Pesos obrigatórios"); return; }

    // Verificar duplicado
    const duplicado = lotes.find(l => 
      l.apartacao_id === apartacaoIdLote &&
      l.nome_lote.toUpperCase() === nomeLote.trim().toUpperCase() && 
      l.id !== editingLoteId
    );
    if (duplicado) { toast.error("Já existe!"); return; }

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
          toast.success("Atualizado!");
        } else {
          await base44.entities.LoteApartacao.create(data);
          toast.success("Criado!");
        }
      } else {
        if (editingLoteId) {
          toast.error("Edição requer conexão");
          setIsSaving(false);
          return;
        }
        await saveLoteOffline(data);
        toast.success("💾 Salvo offline!");
      }
      setNomeLote(""); setQtdMaxima("500"); setPesoMinimo(""); setPesoMaximo(""); setEditingLoteId(null);
      onRefresh();
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const excluirApartacao = async (id) => {
    const vinculadas = pesagens.filter(p => p.apartacao_id === id);
    if (vinculadas.length > 0) { toast.error(`${vinculadas.length} pesagens vinculadas!`); return; }
    if (!confirm("Excluir?")) return;

    if (id.startsWith('apt_') || id.startsWith('offline_')) {
      await deleteItem(STORES_NAMES.APARTACOES_CACHE, id);
      await deleteItem(STORES_NAMES.PENDING_SYNC, id);
      toast.success("Removido!");
      onRefresh();
    } else if (navigator.onLine) {
      const lotesV = lotes.filter(l => l.apartacao_id === id);
      for (const l of lotesV) {
        await base44.entities.LoteApartacao.delete(l.id);
      }
      await base44.entities.Apartacao.delete(id);
      toast.success("Excluído!");
      onRefresh();
    } else {
      toast.error("Exclusão requer conexão");
    }
  };

  const excluirLote = async (id) => {
    const vinculadas = pesagens.filter(p => p.lote_id === id);
    if (vinculadas.length > 0) { toast.error(`${vinculadas.length} pesagens vinculadas!`); return; }
    if (!confirm("Excluir?")) return;

    if (id.startsWith('lote_') || id.startsWith('offline_')) {
      await deleteItem(STORES_NAMES.LOTES_CACHE, id);
      await deleteItem(STORES_NAMES.PENDING_SYNC, id);
      toast.success("Removido!");
      onRefresh();
    } else if (navigator.onLine) {
      await base44.entities.LoteApartacao.delete(id);
      toast.success("Excluído!");
      onRefresh();
    } else {
      toast.error("Exclusão requer conexão");
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
                  <Input value={nomeApartacao} onChange={(e) => setNomeApartacao(e.target.value)} className="h-9 text-sm" />
                </div>
                <Button onClick={salvarApartacao} disabled={isSaving} size="sm" className="h-9 bg-emerald-600">
                  {isSaving ? '...' : <><Plus className="w-3 h-3 mr-1" />{editingApartacaoId ? 'Atualizar' : 'Adicionar'}</>}
                </Button>
                {editingApartacaoId && (
                  <Button variant="outline" size="sm" className="h-9" onClick={() => { setEditingApartacaoId(null); setNomeApartacao(""); }}>
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nome</TableHead>
                    <TableHead className="text-xs text-center">Lotes</TableHead>
                    <TableHead className="text-xs w-24">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apartacoes.map(a => (
                    <TableRow key={a.id} className={a._isOffline ? 'bg-amber-50' : ''}>
                      <TableCell className="text-xs font-medium">
                        {a.nome_apartacao}
                        {a._isOffline && <Badge variant="outline" className="ml-1 text-[8px] bg-amber-100">Offline</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-center">{lotes.filter(l => l.apartacao_id === a.id).length}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setNomeApartacao(a.nome_apartacao); setEditingApartacaoId(a.id); }}>
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => excluirApartacao(a.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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
                  <Input value={nomeLote} onChange={(e) => setNomeLote(e.target.value)} className="h-9 text-xs" />
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
                  <Button onClick={salvarLote} disabled={isSaving} size="sm" className="h-9 bg-emerald-600">
                    {isSaving ? '...' : <><Plus className="w-3 h-3 mr-1" />{editingLoteId ? 'Atualizar' : 'Adicionar'}</>}
                  </Button>
                  {editingLoteId && (
                    <Button variant="outline" size="sm" className="h-9" onClick={() => { setEditingLoteId(null); setNomeLote(""); setQtdMaxima("500"); setPesoMinimo(""); setPesoMaximo(""); }}>
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
                    <TableHead className="text-xs text-center">Peso Mín</TableHead>
                    <TableHead className="text-xs text-center">Peso Máx</TableHead>
                    <TableHead className="text-xs w-24">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lotesFiltrados.map(l => (
                    <TableRow key={l.id} className={l._isOffline ? 'bg-amber-50' : ''}>
                      <TableCell className="text-xs">{l.nome_apartacao}</TableCell>
                      <TableCell className="text-xs font-medium">
                        {l.nome_lote}
                        {l._isOffline && <Badge variant="outline" className="ml-1 text-[8px] bg-amber-100">Offline</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-center">{l.peso_minimo}</TableCell>
                      <TableCell className="text-xs text-center">{l.peso_maximo}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                            setApartacaoIdLote(l.apartacao_id); setNomeLote(l.nome_lote);
                            setQtdMaxima(String(l.quantidade_maxima)); setPesoMinimo(String(l.peso_minimo));
                            setPesoMaximo(String(l.peso_maximo)); setEditingLoteId(l.id);
                          }}>
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => excluirLote(l.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}