import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WifiOff, Wifi, Scale, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

// IndexedDB imports
import {
  initDB,
  savePesagemOffline,
  getPendingPesagens,
  getCachedPesagens,
  cacheApartacoes,
  getCachedApartacoes,
  cacheLotes,
  getCachedLotes,
  cachePesagens,
} from "../components/offline/IndexedDBManager";

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const dataStr = dataString.split('T')[0];
    const [ano, mes, dia] = dataStr.split('-');
    if (!ano || !mes || !dia) return '--/--/----';
    return `${dia}/${mes}/${ano}`;
  } catch {return '--/--/----';}
};

export default function LancamentoPesagensMobile() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  // Estado de conexão
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [dbReady, setDbReady] = useState(false);

  // Refs para navegação rápida
  const numeroInputRef = useRef(null);
  const pesoInputRef = useRef(null);

  // Dados em cache
  const [pesagens, setPesagens] = useState([]);
  const [apartacoes, setApartacoes] = useState([]);
  const [lotesApartacao, setLotesApartacao] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPesagensDB, setPendingPesagensDB] = useState([]);

  // Estado do formulário
  const [dataPesagem, setDataPesagem] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [numeroAnimal, setNumeroAnimal] = useState("");
  const [peso, setPeso] = useState("");
  const [sexo, setSexo] = useState("M");
  const [raca, setRaca] = useState("Nelore");
  const [era, setEra] = useState("");
  const [marca, setMarca] = useState("");
  const [apartacaoSelecionada, setApartacaoSelecionada] = useState("");
  const [loteTransferencia, setLoteTransferencia] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [tipoManejo, setTipoManejo] = useState('Manejo');

  // Avisos
  const [avisoTela, setAvisoTela] = useState(null);

  // Inicializar
  useEffect(() => {
    const init = async () => {
      try {
        await initDB();
        setDbReady(true);
        await loadAllData();
      } catch (error) {
        console.error('Erro ao inicializar IndexedDB:', error);
        setDbReady(false);
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

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [empresaSelecionadaId]);

  const loadAllData = async () => {
    setIsLoading(true);

    try {
      if (dbReady) {
        const [cachedPesagensDB, cachedApartacoesDB, cachedLotesDB, pending] = await Promise.all([
          getCachedPesagens(empresaSelecionadaId),
          getCachedApartacoes(empresaSelecionadaId),
          getCachedLotes(empresaSelecionadaId),
          getPendingPesagens(empresaSelecionadaId)
        ]);

        setPesagens(cachedPesagensDB);
        setApartacoes(cachedApartacoesDB);
        setLotesApartacao(cachedLotesDB);
        setPendingPesagensDB(pending);
        setPendingCount(pending.length);
      }

      setIsLoading(false);

      // Se online, atualizar do servidor
      if (navigator.onLine) {
        const [allPesagens, allApartacoes, allLotes] = await Promise.all([
          base44.entities.PesagemIndividual.list('-data_pesagem'),
          base44.entities.Apartacao.list(),
          base44.entities.LoteApartacao.list(),
        ]);

        const pesagensEmpresa = allPesagens.filter((p) => p.empresa_id === empresaSelecionadaId);
        const apartacoesEmpresa = allApartacoes.filter((a) => a.empresa_id === empresaSelecionadaId);
        const lotesEmpresa = allLotes.filter((l) => l.empresa_id === empresaSelecionadaId);

        if (dbReady) {
          await Promise.all([
            cachePesagens(pesagensEmpresa),
            cacheApartacoes(apartacoesEmpresa),
            cacheLotes(lotesEmpresa)
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

  // Lotes da apartação selecionada
  const lotesApartacaoAtual = useMemo(() => {
    if (!apartacaoSelecionada) return [];
    return lotesApartacao.filter((l) => l.apartacao_id === apartacaoSelecionada);
  }, [apartacaoSelecionada, lotesApartacao]);

  // Verificar se lote está cheio
  const isLoteCheio = (lote) => {
    if (!lote) return false;
    if (lote.fechado) return true;
    const animaisNoLote = [
      ...pesagens.filter((p) => p.lote_id === lote.id),
      ...pendingPesagensDB.filter((p) => p.lote_id === lote.id)
    ].length;
    return animaisNoLote >= (lote.quantidade_maxima || 999999);
  };

  // Determinar lote automaticamente
  const getLoteAutomatico = (pesoNum) => {
    if (!apartacaoSelecionada || !pesoNum) return null;
    const lote = lotesApartacaoAtual.find((l) =>
      pesoNum >= l.peso_minimo && pesoNum <= l.peso_maximo && !l.fechado && !isLoteCheio(l)
    );
    return lote;
  };

  // Pesagens do dia
  const pesagensDia = useMemo(() => {
    const pendentes = pendingPesagensDB
      .filter((p) => p.data_pesagem === dataPesagem)
      .map((p, idx) => ({ ...p, _numero_registro: `P${idx + 1}` }));

    const sincronizadas = pesagens
      .filter((p) => p.data_pesagem === dataPesagem)
      .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0))
      .map((p, idx) => ({ ...p, _numero_registro: idx + 1 }));

    return [...pendentes, ...sincronizadas];
  }, [pesagens, dataPesagem, pendingPesagensDB]);

  // Estatísticas
  const stats = useMemo(() => {
    const total = pesagensDia.length;
    const pesoMedio = total > 0 ? pesagensDia.reduce((s, p) => s + (p.peso || 0), 0) / total : 0;
    return { total, pesoMedio };
  }, [pesagensDia]);

  // Salvar pesagem
  const handleSalvar = async () => {
    if (isSaving) return;

    if (!dataPesagem) {
      toast.error("⚠️ Informe a data");
      return;
    }
    if (!numeroAnimal?.trim()) {
      toast.error("⚠️ Informe o número do animal");
      numeroInputRef.current?.focus();
      return;
    }
    if (!peso || isNaN(parseFloat(peso)) || parseFloat(peso) <= 0) {
      toast.error("⚠️ Informe um peso válido");
      pesoInputRef.current?.focus();
      return;
    }

    // Verificar duplicado
    const isSN = numeroAnimal.trim().toUpperCase() === 'SN';
    if (!isSN) {
      const duplicado = pesagensDia.find((p) => p.numero_animal === numeroAnimal.trim());
      if (duplicado) {
        setAvisoTela({
          tipo: 'erro',
          mensagem: `⚠️ Animal ${numeroAnimal.trim()} já foi pesado hoje! Peso: ${duplicado.peso}kg`
        });
        return;
      }
    }

    // Verificar cadastro no modo Manejo
    if (tipoManejo === 'Manejo' && !isSN) {
      const animalExiste = pesagens.some((p) => p.numero_animal === numeroAnimal.trim() && p.status_animal === 'Ativo');
      if (!animalExiste) {
        setAvisoTela({
          tipo: 'erro',
          mensagem: `❌ Animal ${numeroAnimal.trim()} não cadastrado! Use "Cadastro" primeiro.`
        });
        return;
      }
    }

    setIsSaving(true);

    const pesoNum = parseFloat(peso);

    // Calcular ganho se for Manejo
    let dataAnterior = null, pesoAnterior = null, dias = null, ganho = null, gmd = null;
    if (!isSN && tipoManejo === 'Manejo') {
      const historicoAnimal = pesagens
        .filter((p) => p.numero_animal === numeroAnimal.trim() && p.data_pesagem < dataPesagem)
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

    const data = {
      empresa_id: empresaSelecionadaId,
      tipo_manejo: tipoManejo,
      status_animal: 'Ativo',
      data_pesagem: dataPesagem,
      numero_animal: numeroAnimal.trim(),
      sexo: sexo || null,
      raca: raca || null,
      era: era || null,
      marca: marca || null,
      peso: pesoNum,
      apartacao_id: apartacaoId,
      nome_apartacao: nomeApartacao,
      lote_id: loteId,
      nome_lote: nomeLote,
      data_anterior: tipoManejo === 'Manejo' ? dataAnterior : null,
      peso_anterior: tipoManejo === 'Manejo' ? pesoAnterior : null,
      dias: tipoManejo === 'Manejo' ? dias : null,
      ganho: tipoManejo === 'Manejo' && ganho ? parseFloat(ganho.toFixed(2)) : null,
      gmd: tipoManejo === 'Manejo' ? gmd : null
    };

    try {
      if (navigator.onLine) {
        await base44.entities.PesagemIndividual.create(data);
        toast.success('✓ Salvo!');
        
        const novasPesagens = await base44.entities.PesagemIndividual.filter({ 
          data_pesagem: dataPesagem, 
          empresa_id: empresaSelecionadaId 
        });
        
        setPesagens(prev => {
          const outrosDias = prev.filter(p => p.data_pesagem !== dataPesagem);
          return [...outrosDias, ...novasPesagens];
        });
      } else {
        if (dbReady) {
          await savePesagemOffline(data);
          const pending = await getPendingPesagens(empresaSelecionadaId);
          setPendingPesagensDB(pending);
          setPendingCount(pending.length);
        }
        toast.success('💾 Salvo offline');
      }

      // Limpar formulário (manter dados cadastrais)
      setNumeroAnimal("");
      setPeso("");
      setLoteTransferencia("");
      setAvisoTela(null);
      numeroInputRef.current?.focus();
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Excluir pesagem
  const handleExcluir = async (pesagem) => {
    if (!confirm(`Excluir pesagem do animal ${pesagem.numero_animal}?`)) return;

    if (pesagem._offlineId && dbReady) {
      await deletePendingPesagem(pesagem._offlineId);
      const pending = await getPendingPesagens(empresaSelecionadaId);
      setPendingPesagensDB(pending);
      setPendingCount(pending.length);
      toast.success('Removido!');
    } else if (navigator.onLine) {
      await base44.entities.PesagemIndividual.delete(pesagem.id);
      toast.success('Excluído!');
      await loadAllData();
    } else {
      toast.error("Exclusão offline não disponível");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* HEADER FIXO */}
      <div className="sticky top-0 z-50 bg-white shadow-sm border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-slate-900">Lançar Pesagens</h1>
            <p className="text-xs text-slate-500">{formatarData(dataPesagem)}</p>
          </div>
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700">
                <Wifi className="w-3 h-3 mr-1" />Online
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700">
                <WifiOff className="w-3 h-3 mr-1" />Offline
              </Badge>
            )}
            {pendingCount > 0 && (
              <Badge className="text-xs bg-blue-600">{pendingCount}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* FORMULÁRIO */}
      <div className="p-4 space-y-3">
        {/* Tipo de Movimentação */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Tipo</Label>
          <Select value={tipoManejo} onValueChange={setTipoManejo}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Cadastro" className="text-base py-3">Cadastro (Novo)</SelectItem>
              <SelectItem value="Manejo" className="text-base py-3">Manejo (Pesagem)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Data */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Data <span className="text-red-500">*</span></Label>
          <Input
            type="date"
            value={dataPesagem}
            onChange={(e) => setDataPesagem(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        {/* Apartação */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Apartação</Label>
          <Select 
            value={apartacaoSelecionada} 
            onValueChange={(v) => {
              setApartacaoSelecionada(v);
              setLoteTransferencia("");
            }}
          >
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Nenhuma</SelectItem>
              {apartacoes.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-base py-3">
                  {a.nome_apartacao}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Lote */}
        {apartacaoSelecionada && (
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Lote</Label>
            <Select 
              value={loteTransferencia} 
              onValueChange={setLoteTransferencia}
            >
              <SelectTrigger className="h-12 text-base">
                <SelectValue placeholder="Automático" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Automático</SelectItem>
                <SelectItem value="NENHUM">Sem Lote</SelectItem>
                {lotesApartacaoAtual.map((l) => {
                  const cheio = isLoteCheio(l);
                  return (
                    <SelectItem 
                      key={l.id} 
                      value={l.id} 
                      className={`text-base py-3 ${cheio ? 'text-red-600' : ''}`}
                    >
                      {l.nome_lote} ({l.peso_minimo}-{l.peso_maximo}kg) {cheio ? ' [CHEIO]' : ''}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Campos de Cadastro */}
        {tipoManejo === 'Cadastro' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Sexo</Label>
                <Select value={sexo} onValueChange={setSexo}>
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M" className="text-base py-3">Macho</SelectItem>
                    <SelectItem value="F" className="text-base py-3">Fêmea</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Raça</Label>
                <Input
                  value={raca}
                  onChange={(e) => setRaca(e.target.value)}
                  className="h-12 text-base"
                  placeholder="Nelore"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Era</Label>
                <Input
                  value={era}
                  onChange={(e) => setEra(e.target.value)}
                  className="h-12 text-base"
                  inputMode="numeric"
                  placeholder="Ex: 14"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Marca</Label>
                <Input
                  value={marca}
                  onChange={(e) => setMarca(e.target.value)}
                  className="h-12 text-base"
                  placeholder="ABC"
                />
              </div>
            </div>
          </>
        )}

        {/* Número do Animal */}
        <div className="space-y-2">
          <Label className="text-lg font-bold text-emerald-700">Nº Animal <span className="text-red-500">*</span></Label>
          <Input
            ref={numeroInputRef}
            value={numeroAnimal}
            onChange={(e) => {
              const valor = e.target.value;
              setNumeroAnimal(valor);
              setAvisoTela(null);

              if (valor.trim() && valor.trim().toUpperCase() !== 'SN') {
                const historicoAnimal = pesagens
                  .filter((p) => p.numero_animal === valor.trim())
                  .sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));

                const pesadoHoje = pesagensDia.find((p) => p.numero_animal === valor.trim());
                if (pesadoHoje) {
                  setAvisoTela({
                    tipo: 'erro',
                    mensagem: `⚠️ Já pesado hoje: ${pesadoHoje.peso}kg`
                  });
                  return;
                }

                if (historicoAnimal.length > 0) {
                  const cadastro = pesagens.find((p) => p.numero_animal === valor.trim() && p.tipo_manejo === 'Cadastro');
                  const ultimo = historicoAnimal[0];
                  const dadosCadastro = cadastro || ultimo;

                  setSexo(dadosCadastro.sexo || "M");
                  setRaca(dadosCadastro.raca || "Nelore");
                  setEra(dadosCadastro.era || "");
                  setMarca(dadosCadastro.marca || "");

                  if (tipoManejo === 'Manejo') {
                    setAvisoTela({
                      tipo: 'info',
                      mensagem: `✓ ${dadosCadastro.raca || '-'} | Última: ${formatarData(ultimo.data_pesagem)} - ${ultimo.peso}kg`
                    });
                  }
                } else if (tipoManejo === 'Manejo') {
                  setAvisoTela({
                    tipo: 'erro',
                    mensagem: `❌ Não cadastrado! Use "Cadastro" primeiro.`
                  });
                }
              }
            }}
            className="h-16 text-2xl font-bold text-emerald-700 text-center"
            inputMode="numeric"
            placeholder="1234"
            autoFocus
          />
        </div>

        {/* Peso */}
        <div className="space-y-2">
          <Label className="text-lg font-bold text-amber-600">Peso (kg) <span className="text-red-500">*</span></Label>
          <Input
            ref={pesoInputRef}
            type="number"
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            className="h-16 text-2xl font-bold text-amber-600 text-center"
            inputMode="decimal"
            placeholder="320"
          />
        </div>

        {/* Lote Automático */}
        {peso && apartacaoSelecionada && !loteTransferencia && (() => {
          const loteAuto = getLoteAutomatico(parseFloat(peso));
          return (
            <div className={`p-4 rounded-lg border-2 text-center ${
              loteAuto 
                ? 'bg-orange-100 border-orange-400 text-orange-800' 
                : 'bg-red-100 border-red-400 text-red-800'
            }`}>
              <div className="flex items-center justify-center gap-2">
                <ChevronRight className="w-6 h-6" />
                <span className="font-bold text-lg">
                  Lote: {loteAuto?.nome_lote || 'Não encontrado'}
                </span>
              </div>
            </div>
          );
        })()}

        {/* Ganho de Peso */}
        {(() => {
          if (!numeroAnimal?.trim() || !peso || numeroAnimal.trim().toUpperCase() === 'SN') return null;
          const historicoAnimal = pesagens
            .filter((p) => p.numero_animal === numeroAnimal.trim() && p.data_pesagem < dataPesagem)
            .sort((a, b) => new Date(b.data_pesagem) - new Date(a.data_pesagem));
          if (historicoAnimal.length === 0 || !historicoAnimal[0].peso) return null;
          const ultimo = historicoAnimal[0];
          const pesoNum = parseFloat(peso);
          const dias = Math.floor((new Date(dataPesagem) - new Date(ultimo.data_pesagem)) / (1000 * 60 * 60 * 24));
          const ganho = pesoNum - ultimo.peso;
          const gmd = dias > 0 ? ganho / dias : 0;
          return (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-emerald-600">Dias</div>
                  <div className="text-xl font-bold text-emerald-800">{dias}</div>
                </div>
                <div>
                  <div className="text-xs text-emerald-600">Ganho</div>
                  <div className="text-xl font-bold text-emerald-800">{ganho.toFixed(1)} kg</div>
                </div>
                <div>
                  <div className="text-xs text-emerald-600">GMD</div>
                  <div className="text-xl font-bold text-emerald-800">{gmd.toFixed(3)}</div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Aviso */}
        {avisoTela && (
          <div className={`p-3 rounded-lg text-sm ${
            avisoTela.tipo === 'erro' ? 'bg-red-100 text-red-800 border border-red-300' :
            avisoTela.tipo === 'alerta' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
            'bg-blue-100 text-blue-800 border border-blue-300'
          }`}>
            {avisoTela.mensagem}
          </div>
        )}

        {/* Botão Salvar */}
        <Button 
          onClick={handleSalvar} 
          disabled={isSaving} 
          className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700"
        >
          {isSaving ? 'Salvando...' : 'SALVAR PESAGEM'}
        </Button>
      </div>

      {/* LISTA DE PESAGENS DO DIA */}
      <div className="px-4">
        <Card>
          <CardHeader className="py-3 px-4 bg-slate-100">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span>Pesagens Hoje ({stats.total})</span>
              <span className="text-emerald-700">{stats.pesoMedio.toFixed(0)} kg</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {pesagensDia.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Scale className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhuma pesagem lançada hoje</p>
              </div>
            ) : (
              <div className="divide-y">
                {pesagensDia.map((p) => (
                  <div key={p.id || p._offlineId} className={`p-3 ${p._offlineId ? 'bg-amber-50' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-bold text-base text-slate-900">
                          {p.numero_animal}
                          {p._offlineId && (
                            <Badge variant="outline" className="ml-2 text-xs bg-amber-100 text-amber-700">
                              Pendente
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {p.sexo} • {p.raca} • {p.era || '-'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold text-amber-600">{p.peso} kg</div>
                        {p.gmd && (
                          <div className={`text-xs font-semibold ${p.gmd > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            GMD: {p.gmd.toFixed(3)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <div>
                        {p.nome_apartacao || '-'} • {p.nome_lote || 'Sem lote'}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleExcluir(p)}
                        className="h-8 text-xs text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}