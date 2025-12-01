import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Scale, Save, Trash2, Edit2, RefreshCw, Settings, WifiOff, Wifi, Plus, Download, ChevronRight, Lock, Unlock, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const CACHE_KEYS = {
  PESAGENS: 'offline_pesagens_individuais',
  APARTACOES: 'offline_apartacoes',
  LOTES: 'offline_lotes_apartacao',
  PENDING: 'pending_pesagens_individuais',
  PENDING_APARTACOES: 'pending_apartacoes',
  PENDING_LOTES: 'pending_lotes',
};

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
  
  // Travas para manter valores
  const [travaSexo, setTravaSexo] = useState(true);
  const [travaRaca, setTravaRaca] = useState(true);
  const [travaMarca, setTravaMarca] = useState(false);

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

    // Se online, atualizar do servidor em background
    if (navigator.onLine) {
      try {
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

    // Sincronizar pesagens pendentes
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

  // ========== PESAGENS DO DIA + PENDENTES ==========
  const pesagensDia = useMemo(() => {
    const pendentes = JSON.parse(localStorage.getItem(CACHE_KEYS.PENDING) || '[]')
      .filter(p => p.data_pesagem === dataPesagem && p.empresa_id === empresaSelecionadaId);
    const sincronizadas = pesagens.filter(p => p.data_pesagem === dataPesagem);
    return [...pendentes, ...sincronizadas];
  }, [pesagens, dataPesagem, pendingCount, empresaSelecionadaId]);

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
    if (!dataPesagem) { toast.error("Data obrigatória"); return; }
    if (!numeroAnimal?.trim()) { toast.error("Número obrigatório"); return; }
    if (!peso || isNaN(parseFloat(peso))) { toast.error("Peso inválido"); return; }

    // Verificar duplicado
    if (!editingId) {
      const duplicado = pesagensDia.find(p => p.numero_animal === numeroAnimal.trim());
      if (duplicado) { toast.error("Animal já pesado hoje"); return; }
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
      // Lote manual selecionado
      const lote = lotesApartacaoAtual.find(l => l.id === loteTransferencia);
      if (lote) {
        loteId = lote.id;
        nomeLote = lote.nome_lote;
        apartacaoId = apartacaoSelecionada;
        nomeApartacao = apartacoes.find(a => a.id === apartacaoSelecionada)?.nome_apartacao || "";
      }
    } else if (apartacaoSelecionada) {
      // Lote automático
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
        // Online - salvar direto
        await base44.entities.PesagemIndividual.create(data);
        toast.success('✓ Salvo!');
        await loadAllData();
      } else if (navigator.onLine && editingId) {
        // Online - editar
        await base44.entities.PesagemIndividual.update(editingId, data);
        toast.success('✓ Atualizado!');
        await loadAllData();
      } else {
        // Offline - salvar localmente
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

      // Limpar formulário
      setEditingId(null);
      setNumeroAnimal("");
      setPeso("");
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
      // Pendente offline - remover do localStorage
      const pending = JSON.parse(localStorage.getItem(CACHE_KEYS.PENDING) || '[]');
      const updated = pending.filter(p => p._offlineId !== pesagem._offlineId);
      localStorage.setItem(CACHE_KEYS.PENDING, JSON.stringify(updated));
      updatePendingCount();
      toast.success('Removido');
    } else if (navigator.onLine) {
      // Online - excluir do servidor
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
    const headers = ['Identificação', 'Peso', 'Data', 'Sexo', 'Raça', 'Apartação', 'Lote'];
    const rows = pesagensDia.map(p => [
      p.numero_animal,
      p.peso,
      formatarData(p.data_pesagem),
      p.sexo || '',
      p.raca || '',
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
          <h1 className="text-base font-bold text-slate-800">Lançamento</h1>
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
        <CardContent className="p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data Pesagem</Label>
              <Input type="date" value={dataPesagem} onChange={(e) => setDataPesagem(e.target.value)} className="h-8 text-xs w-32" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sexo</Label>
              <Select value={sexo} onValueChange={setSexo}>
                <SelectTrigger className="h-8 text-xs w-16"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">M</SelectItem>
                  <SelectItem value="F">F</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Raça</Label>
              <Input value={raca} onChange={(e) => setRaca(e.target.value)} className="h-8 text-xs w-24" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº Ident./Nome</Label>
              <Input 
                ref={numeroInputRef}
                value={numeroAnimal} 
                onChange={(e) => setNumeroAnimal(e.target.value)} 
                onKeyDown={(e) => handleKeyDown(e, pesoInputRef)}
                className="h-8 text-xs w-28 font-bold"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Peso</Label>
              <Input 
                ref={pesoInputRef}
                type="number"
                value={peso} 
                onChange={(e) => setPeso(e.target.value)} 
                onKeyDown={(e) => handleKeyDown(e, 'salvar')}
                className="h-8 text-xs w-20 font-bold"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Observação</Label>
              <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} className="h-8 text-xs w-36" />
            </div>
            <Button onClick={handleSalvar} disabled={isSaving} className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700">
              <Save className="w-4 h-4" />
              {isSaving ? '...' : 'Salvar Registro'}
            </Button>
          </div>
          
          {/* Linha 2: Apartação e Transferência de Lote */}
          <div className="flex flex-wrap items-end gap-3 mt-2 pt-2 border-t">
            <div className="space-y-1">
              <Label className="text-xs">Apartação</Label>
              <Select value={apartacaoSelecionada} onValueChange={(v) => { setApartacaoSelecionada(v); setLoteTransferencia(""); }}>
                <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Nenhuma</SelectItem>
                  {apartacoes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome_apartacao}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Transferência de Lote:</Label>
              <Select value={loteTransferencia} onValueChange={setLoteTransferencia} disabled={!apartacaoSelecionada}>
                <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="Automático" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Automático</SelectItem>
                  {lotesApartacaoAtual.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.nome_lote} ({l.peso_minimo}-{l.peso_maximo}kg)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {peso && apartacaoSelecionada && !loteTransferencia && (
              <div className="text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-1 rounded">
                <ChevronRight className="w-3 h-3 inline" />
                {getLoteAutomatico(parseFloat(peso))?.nome_lote || 'Sem lote'}
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
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-100">
                    <TableRow>
                      <TableHead className="text-xs w-16">Ações</TableHead>
                      <TableHead className="text-xs">Identificação</TableHead>
                      <TableHead className="text-xs text-right">Peso</TableHead>
                      <TableHead className="text-xs">Data</TableHead>
                      <TableHead className="text-xs">Sexo</TableHead>
                      <TableHead className="text-xs">Raça</TableHead>
                      <TableHead className="text-xs">Apartação Atual</TableHead>
                      <TableHead className="text-xs">Lote Atual</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-4 text-xs">Carregando...</TableCell></TableRow>
                    ) : pesagensDia.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-4 text-xs text-slate-400">Nenhuma pesagem</TableCell></TableRow>
                    ) : (
                      pesagensDia.map((p, idx) => (
                        <TableRow key={p.id || p._offlineId} className={p._offlineId ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                          <TableCell className="text-xs">
                            <div className="flex gap-0.5">
                              <Button variant="ghost" size="icon" onClick={() => handleEditar(p)} className="h-5 w-5" disabled={!!p._offlineId}>
                                <Edit2 className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleExcluir(p)} className="h-5 w-5 text-red-500">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-bold">
                            {p.numero_animal}
                            {p._offlineId && <Badge variant="outline" className="ml-1 text-[8px] bg-amber-100 text-amber-700">P</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono">{p.peso}</TableCell>
                          <TableCell className="text-xs">{formatarData(p.data_pesagem)}</TableCell>
                          <TableCell className="text-xs">{p.sexo || '-'}</TableCell>
                          <TableCell className="text-xs">{p.raca || '-'}</TableCell>
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
        onRefresh={loadAllData}
      />
    </div>
  );
}

// ========== DIALOG PARA GERENCIAR APARTAÇÕES E LOTES (OFFLINE) ==========
function GerenciarApartacoesDialog({ open, onOpenChange, empresaId, apartacoes, lotes, onRefresh }) {
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

  const salvarApartacao = async () => {
    if (!nomeApartacao.trim()) { toast.error("Nome obrigatório"); return; }
    setIsSaving(true);

    const data = { empresa_id: empresaId, nome_apartacao: nomeApartacao.trim() };

    try {
      if (navigator.onLine) {
        if (editingApartacaoId) {
          await base44.entities.Apartacao.update(editingApartacaoId, data);
        } else {
          await base44.entities.Apartacao.create(data);
        }
        toast.success("Salvo!");
        onRefresh();
      } else {
        // Offline - salvar localmente
        const cached = JSON.parse(localStorage.getItem(CACHE_KEYS.APARTACOES) || '[]');
        cached.push({ ...data, id: `offline_${Date.now()}`, _offlineId: Date.now() });
        localStorage.setItem(CACHE_KEYS.APARTACOES, JSON.stringify(cached));
        toast.success("Salvo offline!");
        onRefresh();
      }
      setNomeApartacao(""); setEditingApartacaoId(null);
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const salvarLote = async () => {
    if (!apartacaoIdLote) { toast.error("Selecione apartação"); return; }
    if (!nomeLote.trim()) { toast.error("Nome obrigatório"); return; }
    if (!pesoMinimo || !pesoMaximo) { toast.error("Peso obrigatório"); return; }
    
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
        } else {
          await base44.entities.LoteApartacao.create(data);
        }
        toast.success("Salvo!");
        onRefresh();
      } else {
        // Offline
        const cached = JSON.parse(localStorage.getItem(CACHE_KEYS.LOTES) || '[]');
        cached.push({ ...data, id: `offline_${Date.now()}`, _offlineId: Date.now() });
        localStorage.setItem(CACHE_KEYS.LOTES, JSON.stringify(cached));
        toast.success("Salvo offline!");
        onRefresh();
      }
      setNomeLote(""); setQtdMaxima("500"); setPesoMinimo(""); setPesoMaximo(""); setEditingLoteId(null);
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const excluirApartacao = async (id) => {
    if (!confirm("Excluir?")) return;
    if (navigator.onLine && !id.toString().startsWith('offline_')) {
      await base44.entities.Apartacao.delete(id);
      toast.success("Excluído!");
      onRefresh();
    } else {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEYS.APARTACOES) || '[]');
      localStorage.setItem(CACHE_KEYS.APARTACOES, JSON.stringify(cached.filter(a => a.id !== id)));
      toast.success("Removido!");
      onRefresh();
    }
  };

  const excluirLote = async (id) => {
    if (!confirm("Excluir?")) return;
    if (navigator.onLine && !id.toString().startsWith('offline_')) {
      await base44.entities.LoteApartacao.delete(id);
      toast.success("Excluído!");
      onRefresh();
    } else {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEYS.LOTES) || '[]');
      localStorage.setItem(CACHE_KEYS.LOTES, JSON.stringify(cached.filter(l => l.id !== id)));
      toast.success("Removido!");
      onRefresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Apartações e Lotes</DialogTitle>
        </DialogHeader>
        
        <div className="flex gap-2 border-b pb-2">
          <Button variant={tab === 'apartacoes' ? 'default' : 'outline'} size="sm" onClick={() => setTab('apartacoes')}>Apartações</Button>
          <Button variant={tab === 'lotes' ? 'default' : 'outline'} size="sm" onClick={() => setTab('lotes')}>Lotes</Button>
        </div>

        <div className="flex-1 overflow-auto">
          {tab === 'apartacoes' ? (
            <div className="space-y-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Nome da Apartação</Label>
                  <Input value={nomeApartacao} onChange={(e) => setNomeApartacao(e.target.value)} className="h-8 text-xs" placeholder="Ex: ROTINA" />
                </div>
                <Button onClick={salvarApartacao} disabled={isSaving} size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-3 h-3 mr-1" />{editingApartacaoId ? 'Atualizar' : 'Adicionar'}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nome</TableHead>
                    <TableHead className="text-xs w-20">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apartacoes.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs font-medium">{a.nome_apartacao}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                            setNomeApartacao(a.nome_apartacao); setEditingApartacaoId(a.id);
                          }}><Edit2 className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => excluirApartacao(a.id)}>
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
              <div className="grid grid-cols-6 gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Apartação</Label>
                  <Select value={apartacaoIdLote} onValueChange={setApartacaoIdLote}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {apartacoes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome_apartacao}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nome Lote</Label>
                  <Input value={nomeLote} onChange={(e) => setNomeLote(e.target.value)} className="h-8 text-xs" placeholder="Ex: BOIADA" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Qtd Máx</Label>
                  <Input type="number" value={qtdMaxima} onChange={(e) => setQtdMaxima(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso Mín</Label>
                  <Input type="number" value={pesoMinimo} onChange={(e) => setPesoMinimo(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso Máx</Label>
                  <Input type="number" value={pesoMaximo} onChange={(e) => setPesoMaximo(e.target.value)} className="h-8 text-xs" />
                </div>
                <Button onClick={salvarLote} disabled={isSaving} size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-3 h-3 mr-1" />{editingLoteId ? 'Atualizar' : 'Adicionar'}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Apartação</TableHead>
                    <TableHead className="text-xs">Lote</TableHead>
                    <TableHead className="text-xs text-center">Qtd Máx</TableHead>
                    <TableHead className="text-xs text-center">Peso Mín</TableHead>
                    <TableHead className="text-xs text-center">Peso Máx</TableHead>
                    <TableHead className="text-xs w-20">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lotes.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{l.nome_apartacao}</TableCell>
                      <TableCell className="text-xs font-medium">{l.nome_lote}</TableCell>
                      <TableCell className="text-xs text-center">{l.quantidade_maxima}</TableCell>
                      <TableCell className="text-xs text-center">{l.peso_minimo}</TableCell>
                      <TableCell className="text-xs text-center">{l.peso_maximo}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                            setApartacaoIdLote(l.apartacao_id); setNomeLote(l.nome_lote);
                            setQtdMaxima(String(l.quantidade_maxima)); setPesoMinimo(String(l.peso_minimo));
                            setPesoMaximo(String(l.peso_maximo)); setEditingLoteId(l.id);
                          }}><Edit2 className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => excluirLote(l.id)}>
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