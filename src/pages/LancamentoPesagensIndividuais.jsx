import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Scale, Save, Trash2, Edit2, RefreshCw, Settings, Plus } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

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
  
  // Refs para navegação
  const numeroInputRef = useRef(null);
  const pesoInputRef = useRef(null);
  const salvarBtnRef = useRef(null);

  // Estado do formulário
  const [editingId, setEditingId] = useState(null);
  const [dataPesagem, setDataPesagem] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [numeroAnimal, setNumeroAnimal] = useState("");
  const [peso, setPeso] = useState("");
  const [sexo, setSexo] = useState("");
  const [raca, setRaca] = useState("");
  const [observacao, setObservacao] = useState("");
  
  // Opções fora do formulário
  const [usarApartacao, setUsarApartacao] = useState(false);
  const [apartacaoSelecionada, setApartacaoSelecionada] = useState("");
  const [loteManual, setLoteManual] = useState("");
  const [sugestaoLote, setSugestaoLote] = useState({ nome: "", cor: "", loteId: null });
  
  const [usarSequencia, setUsarSequencia] = useState(false);
  const [seqInicio, setSeqInicio] = useState("");
  const [seqFinal, setSeqFinal] = useState("");
  
  // Cálculos
  const [calculoGanho, setCalculoGanho] = useState("");
  
  // Dialog
  const [showApartacoesDialog, setShowApartacoesDialog] = useState(false);

  // Fetch apartações
  const { data: apartacoes = [] } = useQuery({
    queryKey: ['apartacoes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Apartacao.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Fetch lotes da apartação selecionada
  const { data: lotesApartacao = [] } = useQuery({
    queryKey: ['lotes-apartacao', apartacaoSelecionada],
    queryFn: async () => {
      if (!apartacaoSelecionada) return [];
      const all = await base44.entities.LoteApartacao.list();
      return all.filter(l => l.apartacao_id === apartacaoSelecionada);
    },
    enabled: !!apartacaoSelecionada,
  });

  // Fetch pesagens do dia
  const { data: pesagensDia = [], isLoading, refetch } = useQuery({
    queryKey: ['pesagens-dia', empresaSelecionadaId, dataPesagem],
    queryFn: async () => {
      const all = await base44.entities.PesagemIndividual.list('-created_date');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.data_pesagem === dataPesagem);
    },
    enabled: !!empresaSelecionadaId && !!dataPesagem,
  });

  // Fetch todas pesagens para histórico
  const { data: todasPesagens = [] } = useQuery({
    queryKey: ['todas-pesagens', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PesagemIndividual.list('-data_pesagem');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Resumo de lotes
  const resumoLotes = useMemo(() => {
    if (!apartacaoSelecionada || lotesApartacao.length === 0) return [];
    const pesagensApartacao = todasPesagens.filter(p => p.apartacao_id === apartacaoSelecionada);
    return lotesApartacao.map(lote => {
      const qtdAnimais = pesagensApartacao.filter(p => p.lote_id === lote.id).length;
      return {
        ...lote,
        quantidade_atual: qtdAnimais,
        status: lote.fechado ? 'Fechado' : (qtdAnimais >= lote.quantidade_maxima ? 'Cheio' : 'Aberto')
      };
    }).sort((a, b) => a.nome_lote.localeCompare(b.nome_lote));
  }, [apartacaoSelecionada, lotesApartacao, todasPesagens]);

  // Buscar dados do animal e calcular ganho
  useEffect(() => {
    if (!numeroAnimal || !dataPesagem) {
      setCalculoGanho("");
      return;
    }

    const historicoAnimal = todasPesagens
      .filter(p => p.numero_animal === numeroAnimal && p.data_pesagem < dataPesagem)
      .sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));

    if (historicoAnimal.length > 0) {
      const ultimo = historicoAnimal[0];
      if (!raca && ultimo.raca) setRaca(ultimo.raca);
      if (!sexo && ultimo.sexo) setSexo(ultimo.sexo);
    }

    if (peso && historicoAnimal.length > 0) {
      const ultimo = historicoAnimal[0];
      if (ultimo.peso) {
        const dias = Math.floor((new Date(dataPesagem) - new Date(ultimo.data_pesagem)) / (1000 * 60 * 60 * 24));
        const ganho = parseFloat(peso) - ultimo.peso;
        const gmd = dias > 0 ? ganho / dias : 0;
        setCalculoGanho(`Dias: ${dias} | Ganho: ${ganho.toFixed(2)} kg | GMD: ${gmd.toFixed(3)}`);
      }
    }
  }, [numeroAnimal, peso, dataPesagem, todasPesagens]);

  // Sugestão de lote
  useEffect(() => {
    if (!usarApartacao || !apartacaoSelecionada || !peso) {
      setSugestaoLote({ nome: "", cor: "", loteId: null });
      return;
    }
    const pesoNum = parseFloat(peso);
    if (isNaN(pesoNum)) return;

    const lotesNaFaixa = lotesApartacao.filter(l => pesoNum >= l.peso_minimo && pesoNum <= l.peso_maximo);
    const loteAberto = lotesNaFaixa.find(l => !l.fechado);
    const loteFechado = lotesNaFaixa.find(l => l.fechado);

    if (loteAberto) {
      setSugestaoLote({ nome: loteAberto.nome_lote, cor: "text-orange-500", loteId: loteAberto.id });
    } else if (loteFechado) {
      setSugestaoLote({ nome: `${loteFechado.nome_lote} (Fechado)`, cor: "text-red-500", loteId: loteFechado.id });
    } else {
      setSugestaoLote({ nome: "! Lote não encontrado", cor: "text-red-500", loteId: null });
    }
  }, [peso, usarApartacao, apartacaoSelecionada, lotesApartacao]);

  // Mutation para salvar
  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingId) {
        return base44.entities.PesagemIndividual.update(editingId, data);
      }
      return base44.entities.PesagemIndividual.create(data);
    },
    onSuccess: () => {
      toast.success(editingId ? 'Atualizado!' : 'Salvo!');
      queryClient.invalidateQueries({ queryKey: ['pesagens-dia'] });
      queryClient.invalidateQueries({ queryKey: ['todas-pesagens'] });
      limparFormulario();
    },
    onError: (error) => toast.error('Erro: ' + error.message),
  });

  // Mutation para excluir
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PesagemIndividual.delete(id),
    onSuccess: () => {
      toast.success('Excluído!');
      queryClient.invalidateQueries({ queryKey: ['pesagens-dia'] });
      queryClient.invalidateQueries({ queryKey: ['todas-pesagens'] });
    },
  });

  const limparFormulario = () => {
    setEditingId(null);
    setPeso("");
    setObservacao("");
    setCalculoGanho("");
    setSugestaoLote({ nome: "", cor: "", loteId: null });
    setLoteManual("");
    // NÃO limpa sexo e raça

    if (usarSequencia && seqInicio && seqFinal) {
      const atual = parseInt(numeroAnimal);
      const proximo = atual + 1;
      if (proximo <= parseInt(seqFinal)) {
        setNumeroAnimal(String(proximo));
        setTimeout(() => pesoInputRef.current?.focus(), 50);
      } else {
        toast.info(`Sequência finalizada!`);
        setNumeroAnimal("");
        setSeqInicio("");
        setSeqFinal("");
        setUsarSequencia(false);
        setTimeout(() => numeroInputRef.current?.focus(), 50);
      }
    } else {
      setNumeroAnimal("");
      setTimeout(() => numeroInputRef.current?.focus(), 50);
    }
  };

  const handleSalvar = async () => {
    if (!dataPesagem) { toast.error("Data obrigatória"); return; }
    if (!numeroAnimal?.trim()) { toast.error("Número obrigatório"); return; }
    if (!peso || isNaN(parseFloat(peso))) { toast.error("Peso inválido"); return; }

    if (!editingId) {
      const duplicado = pesagensDia.find(p => p.numero_animal === numeroAnimal);
      if (duplicado) { toast.error("Animal já pesado hoje"); return; }
    }

    if (usarSequencia && seqInicio && seqFinal) {
      const atual = parseInt(numeroAnimal);
      if (atual < parseInt(seqInicio) || atual > parseInt(seqFinal)) {
        toast.error(`Fora da sequência (${seqInicio}-${seqFinal})`);
        return;
      }
    }

    const pesoNum = parseFloat(peso);
    const historicoAnimal = todasPesagens
      .filter(p => p.numero_animal === numeroAnimal && p.data_pesagem < dataPesagem)
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

    let loteId = null, nomeLote = null, apartacaoId = null, nomeApartacao = null, fixaApartacao = false;

    if (usarApartacao && apartacaoSelecionada) {
      apartacaoId = apartacaoSelecionada;
      const apt = apartacoes.find(a => a.id === apartacaoSelecionada);
      nomeApartacao = apt?.nome_apartacao || "";
      fixaApartacao = apt?.fixa_apartacao || false;

      if (loteManual) {
        const lote = lotesApartacao.find(l => l.id === loteManual);
        if (lote) { loteId = lote.id; nomeLote = lote.nome_lote; }
      } else if (sugestaoLote.loteId) {
        const lote = lotesApartacao.find(l => l.id === sugestaoLote.loteId);
        if (lote) { loteId = lote.id; nomeLote = lote.nome_lote; }
      }
    } else if (!editingId) {
      const regFixo = historicoAnimal.find(p => p.fixa_apartacao);
      if (regFixo) {
        loteId = regFixo.lote_id;
        nomeLote = regFixo.nome_lote;
        apartacaoId = regFixo.apartacao_id;
        nomeApartacao = regFixo.nome_apartacao;
        fixaApartacao = true;
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
      fixa_apartacao: fixaApartacao,
      data_anterior: dataAnterior,
      peso_anterior: pesoAnterior,
      dias, ganho: ganho ? parseFloat(ganho.toFixed(2)) : null, gmd,
    };

    saveMutation.mutate(data);
  };

  const handleKeyDown = (e, nextRef) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (nextRef === 'salvar') {
        handleSalvar();
      } else {
        nextRef?.current?.focus();
      }
    }
  };

  const handleEditar = (p) => {
    setEditingId(p.id);
    setNumeroAnimal(p.numero_animal);
    setPeso(String(p.peso));
    setSexo(p.sexo || "");
    setRaca(p.raca || "");
    setObservacao(p.observacao || "");
    if (p.apartacao_id) {
      setUsarApartacao(true);
      setApartacaoSelecionada(p.apartacao_id);
      setLoteManual(p.lote_id || "");
    }
    numeroInputRef.current?.focus();
  };

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Scale className="w-5 h-5" />
          Lançamento de Pesagens
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowApartacoesDialog(true)} className="h-7 text-xs gap-1">
            <Settings className="w-3 h-3" />
            Apartações/Lotes
          </Button>
          <Link to={createPageUrl("PesagensIndividuais")}>
            <Button variant="outline" size="sm" className="h-7 text-xs">Ver Todos</Button>
          </Link>
        </div>
      </div>

      {/* Opções de Sequência e Apartação - FORA DO FORMULÁRIO */}
      <Card className="bg-slate-50">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-4">
            {/* Data */}
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium whitespace-nowrap">Data:</Label>
              <Input 
                type="date" 
                value={dataPesagem} 
                onChange={(e) => setDataPesagem(e.target.value)} 
                className="h-7 text-xs w-32"
              />
            </div>

            {/* Checkbox Sequência */}
            <div className="flex items-center gap-2">
              <Checkbox 
                id="seq" 
                checked={usarSequencia} 
                onCheckedChange={(c) => { setUsarSequencia(c); if (!c) { setSeqInicio(""); setSeqFinal(""); } }}
              />
              <Label htmlFor="seq" className="text-xs cursor-pointer">Sequência</Label>
              {usarSequencia && (
                <>
                  <Input type="number" value={seqInicio} onChange={(e) => setSeqInicio(e.target.value)} placeholder="Início" className="h-7 text-xs w-20" />
                  <span className="text-xs">a</span>
                  <Input type="number" value={seqFinal} onChange={(e) => setSeqFinal(e.target.value)} placeholder="Final" className="h-7 text-xs w-20" />
                </>
              )}
            </div>

            {/* Checkbox Apartação */}
            <div className="flex items-center gap-2">
              <Checkbox 
                id="apt" 
                checked={usarApartacao} 
                onCheckedChange={(c) => { setUsarApartacao(c); if (!c) { setApartacaoSelecionada(""); setLoteManual(""); } }}
              />
              <Label htmlFor="apt" className="text-xs cursor-pointer">Apartação</Label>
              {usarApartacao && (
                <Select value={apartacaoSelecionada} onValueChange={(v) => { setApartacaoSelecionada(v); setLoteManual(""); }}>
                  <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {apartacoes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome_apartacao}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Formulário de Lançamento - CENTRO/ESQUERDA */}
        <div className="lg:col-span-2 space-y-3">
          <Card>
            <CardHeader className="py-2 px-3 bg-emerald-50 border-b">
              <CardTitle className="text-sm font-semibold">{editingId ? 'Editar' : 'Novo Lançamento'}</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                {/* Número */}
                <div className="space-y-1">
                  <Label className="text-xs">Número *</Label>
                  <Input 
                    ref={numeroInputRef}
                    value={numeroAnimal} 
                    onChange={(e) => setNumeroAnimal(e.target.value)} 
                    onKeyDown={(e) => handleKeyDown(e, pesoInputRef)}
                    className="h-8 text-sm font-semibold"
                    placeholder="Ex: 1234"
                    autoFocus
                  />
                </div>

                {/* Peso */}
                <div className="space-y-1">
                  <Label className="text-xs">Peso (kg) *</Label>
                  <Input 
                    ref={pesoInputRef}
                    type="number"
                    value={peso} 
                    onChange={(e) => setPeso(e.target.value)} 
                    onKeyDown={(e) => handleKeyDown(e, 'salvar')}
                    className="h-8 text-sm font-semibold"
                    placeholder="Ex: 320"
                  />
                </div>

                {/* Sexo */}
                <div className="space-y-1">
                  <Label className="text-xs">Sexo</Label>
                  <Select value={sexo} onValueChange={setSexo}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M">Macho</SelectItem>
                      <SelectItem value="F">Fêmea</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Raça */}
                <div className="space-y-1">
                  <Label className="text-xs">Raça</Label>
                  <Input value={raca} onChange={(e) => setRaca(e.target.value)} className="h-8 text-xs" placeholder="Nelore" />
                </div>

                {/* Botão Salvar */}
                <Button 
                  ref={salvarBtnRef}
                  onClick={handleSalvar} 
                  disabled={saveMutation.isPending}
                  className="h-8 bg-emerald-600 hover:bg-emerald-700 gap-1"
                >
                  <Save className="w-4 h-4" />
                  {saveMutation.isPending ? '...' : 'Salvar'}
                </Button>
              </div>

              {/* Info adicional */}
              <div className="flex gap-4 mt-2 flex-wrap">
                {calculoGanho && (
                  <div className="text-xs text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded">{calculoGanho}</div>
                )}
                {sugestaoLote.nome && usarApartacao && (
                  <div className={`text-xs font-semibold ${sugestaoLote.cor} bg-white px-2 py-1 rounded border`}>
                    Lote: {sugestaoLote.nome}
                  </div>
                )}
                {usarApartacao && apartacaoSelecionada && lotesApartacao.length > 0 && (
                  <Select value={loteManual} onValueChange={setLoteManual}>
                    <SelectTrigger className="h-6 text-xs w-48"><SelectValue placeholder="Lote manual (opcional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>Automático</SelectItem>
                      {lotesApartacao.map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.nome_lote} ({l.peso_minimo}-{l.peso_maximo}kg)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tabela de Pesagens do Dia */}
          <Card>
            <CardHeader className="py-2 px-3 bg-slate-50 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Pesagens do Dia ({formatarData(dataPesagem)})</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{pesagensDia.length}</Badge>
                <Button variant="ghost" size="icon" onClick={() => refetch()} className="h-6 w-6">
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead className="text-xs">Animal</TableHead>
                      <TableHead className="text-xs">Sexo</TableHead>
                      <TableHead className="text-xs">Raça</TableHead>
                      <TableHead className="text-xs text-right">Peso</TableHead>
                      <TableHead className="text-xs">Lote</TableHead>
                      <TableHead className="text-xs text-right">Dias</TableHead>
                      <TableHead className="text-xs text-right">GMD</TableHead>
                      <TableHead className="text-xs w-14"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-4 text-slate-500 text-xs">Carregando...</TableCell></TableRow>
                    ) : pesagensDia.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-4 text-slate-500 text-xs">Nenhuma pesagem</TableCell></TableRow>
                    ) : (
                      pesagensDia.map((p) => (
                        <TableRow key={p.id} className="hover:bg-slate-50">
                          <TableCell className="text-xs font-medium">{p.numero_animal}</TableCell>
                          <TableCell className="text-xs">{p.sexo || '-'}</TableCell>
                          <TableCell className="text-xs">{p.raca || '-'}</TableCell>
                          <TableCell className="text-xs text-right font-mono font-semibold">{p.peso}</TableCell>
                          <TableCell className="text-xs">{p.nome_lote || '-'}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{p.dias || '-'}</TableCell>
                          <TableCell className={`text-xs text-right font-mono ${p.gmd > 0 ? 'text-emerald-600' : p.gmd < 0 ? 'text-red-600' : ''}`}>
                            {p.gmd?.toFixed(3) || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-0.5">
                              <Button variant="ghost" size="icon" onClick={() => handleEditar(p)} className="h-5 w-5">
                                <Edit2 className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(p.id)} className="h-5 w-5 text-red-500">
                                <Trash2 className="w-3 h-3" />
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

        {/* Resumo de Lotes - LADO DIREITO */}
        <div className="lg:col-span-1">
          {usarApartacao && apartacaoSelecionada && resumoLotes.length > 0 ? (
            <Card className="sticky top-16">
              <CardHeader className="py-2 px-3 bg-emerald-50 border-b">
                <CardTitle className="text-sm text-emerald-800">
                  Lotes - {apartacoes.find(a => a.id === apartacaoSelecionada)?.nome_apartacao}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Lote</TableHead>
                      <TableHead className="text-xs text-center">Faixa</TableHead>
                      <TableHead className="text-xs text-center">Qtd</TableHead>
                      <TableHead className="text-xs text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resumoLotes.map((lote) => (
                      <TableRow key={lote.id} className={sugestaoLote.loteId === lote.id ? 'bg-orange-50' : ''}>
                        <TableCell className="text-xs font-medium">{lote.nome_lote}</TableCell>
                        <TableCell className="text-xs text-center">{lote.peso_minimo}-{lote.peso_maximo}</TableCell>
                        <TableCell className="text-xs text-center font-semibold">{lote.quantidade_atual}/{lote.quantidade_maxima}</TableCell>
                        <TableCell className="text-xs text-center">
                          <Badge variant={lote.status === 'Aberto' ? 'default' : 'destructive'} className="text-[9px] px-1">
                            {lote.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-slate-50">
              <CardContent className="p-4 text-center text-slate-500 text-xs">
                {usarApartacao ? 'Selecione uma apartação para ver os lotes' : 'Ative a opção "Apartação" para ver os lotes'}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Dialog Apartações/Lotes */}
      <GerenciarApartacoesDialog 
        open={showApartacoesDialog} 
        onOpenChange={setShowApartacoesDialog}
        empresaId={empresaSelecionadaId}
      />
    </div>
  );
}

function GerenciarApartacoesDialog({ open, onOpenChange, empresaId }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('apartacoes');
  
  const [nomeApartacao, setNomeApartacao] = useState("");
  const [fixaApartacao, setFixaApartacao] = useState(false);
  const [editingApartacaoId, setEditingApartacaoId] = useState(null);
  
  const [apartacaoIdLote, setApartacaoIdLote] = useState("");
  const [nomeLote, setNomeLote] = useState("");
  const [qtdMaxima, setQtdMaxima] = useState("");
  const [pesoMinimo, setPesoMinimo] = useState("");
  const [pesoMaximo, setPesoMaximo] = useState("");
  const [editingLoteId, setEditingLoteId] = useState(null);

  const { data: apartacoes = [], refetch: refetchApartacoes } = useQuery({
    queryKey: ['apartacoes-dialog', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Apartacao.list();
      return all.filter(a => a.empresa_id === empresaId);
    },
    enabled: !!empresaId && open,
  });

  const { data: lotes = [], refetch: refetchLotes } = useQuery({
    queryKey: ['lotes-dialog', empresaId],
    queryFn: async () => {
      const all = await base44.entities.LoteApartacao.list();
      return all.filter(l => l.empresa_id === empresaId);
    },
    enabled: !!empresaId && open,
  });

  const salvarApartacao = async () => {
    if (!nomeApartacao.trim()) { toast.error("Nome obrigatório"); return; }
    const data = { empresa_id: empresaId, nome_apartacao: nomeApartacao.trim(), fixa_apartacao: fixaApartacao };
    if (editingApartacaoId) {
      await base44.entities.Apartacao.update(editingApartacaoId, data);
    } else {
      await base44.entities.Apartacao.create(data);
    }
    toast.success("Salvo!");
    setNomeApartacao(""); setFixaApartacao(false); setEditingApartacaoId(null);
    refetchApartacoes();
    queryClient.invalidateQueries({ queryKey: ['apartacoes'] });
  };

  const salvarLote = async () => {
    if (!apartacaoIdLote) { toast.error("Selecione apartação"); return; }
    if (!nomeLote.trim()) { toast.error("Nome obrigatório"); return; }
    if (!pesoMinimo || !pesoMaximo) { toast.error("Peso obrigatório"); return; }
    
    const apt = apartacoes.find(a => a.id === apartacaoIdLote);
    const data = {
      empresa_id: empresaId,
      apartacao_id: apartacaoIdLote,
      nome_apartacao: apt?.nome_apartacao || "",
      nome_lote: nomeLote.trim(),
      quantidade_maxima: parseInt(qtdMaxima) || 999,
      peso_minimo: parseFloat(pesoMinimo),
      peso_maximo: parseFloat(pesoMaximo),
      fechado: false,
    };

    if (editingLoteId) {
      await base44.entities.LoteApartacao.update(editingLoteId, data);
    } else {
      await base44.entities.LoteApartacao.create(data);
    }
    toast.success("Salvo!");
    setNomeLote(""); setQtdMaxima(""); setPesoMinimo(""); setPesoMaximo(""); setEditingLoteId(null);
    refetchLotes();
    queryClient.invalidateQueries({ queryKey: ['lotes-apartacao'] });
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
              <div className="grid grid-cols-4 gap-2 items-end">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Nome da Apartação</Label>
                  <Input value={nomeApartacao} onChange={(e) => setNomeApartacao(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="fixa" checked={fixaApartacao} onCheckedChange={setFixaApartacao} />
                  <Label htmlFor="fixa" className="text-xs">Fixa</Label>
                </div>
                <Button onClick={salvarApartacao} size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700">
                  {editingApartacaoId ? 'Atualizar' : 'Adicionar'}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nome</TableHead>
                    <TableHead className="text-xs text-center">Fixa</TableHead>
                    <TableHead className="text-xs w-20">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apartacoes.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{a.nome_apartacao}</TableCell>
                      <TableCell className="text-xs text-center">{a.fixa_apartacao ? 'Sim' : 'Não'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                            setNomeApartacao(a.nome_apartacao); setFixaApartacao(a.fixa_apartacao); setEditingApartacaoId(a.id);
                          }}><Edit2 className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={async () => {
                            if (confirm("Excluir?")) { await base44.entities.Apartacao.delete(a.id); refetchApartacoes(); }
                          }}><Trash2 className="w-3 h-3" /></Button>
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
                  <Input value={nomeLote} onChange={(e) => setNomeLote(e.target.value)} className="h-8 text-xs" />
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
                <Button onClick={salvarLote} size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700">
                  {editingLoteId ? 'Atualizar' : 'Adicionar'}
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
                      <TableCell className="text-xs">{l.nome_lote}</TableCell>
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
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={async () => {
                            if (confirm("Excluir?")) { await base44.entities.LoteApartacao.delete(l.id); refetchLotes(); }
                          }}><Trash2 className="w-3 h-3" /></Button>
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