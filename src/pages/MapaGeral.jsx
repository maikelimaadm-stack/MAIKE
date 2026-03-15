import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle } from
"@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle } from
"@/components/ui/sheet";
import DetalhesLote from "../components/mapa/DetalhesLote";
import DetalhesPontoSuplementacao from "../components/mapa/DetalhesPontoSuplementacao";
import AreaPanel from "../components/mapa/AreaPanel";
import TarefasMapaPanel from "../components/mapa/TarefasMapaPanel";
import MapaInsights from "../components/mapa/MapaInsights";
import MapaControlesMobile from "../components/mapa/MapaControlesMobile";
import MapaFiltrosAvancados, {
  CORES_TIPO_CULTURA, CORES_APROVEITAMENTO, CORES_OCUPACAO, CORES_CATEGORIA_GADO,
  CORES_UA_HA, CORES_SITUACAO_PASTO } from
"../components/mapa/MapaFiltrosAvancados";
import MapaLegenda from "../components/mapa/MapaLegenda";
import useMapRenderer from "../components/mapa/useMapRenderer";
import { getCochoIndicator, getDepositoIndicator, buildProgressIconUrl } from "../components/mapa/pontoStatusUtils";
import { normalizeText } from "../components/suplementacao/estoqueSuplementacaoUtils";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";
let _gmapsPromise = null;
const loadGoogleMapsScript = () => {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (_gmapsPromise) return _gmapsPromise;
  _gmapsPromise = new Promise((resolve, reject) => {
    // Check if script tag already exists
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {existing.addEventListener('load', resolve);existing.addEventListener('error', reject);return;}
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=drawing,geometry`;
    s.async = true;s.defer = true;
    s.onload = resolve;s.onerror = reject;
    document.head.appendChild(s);
  });
  return _gmapsPromise;
};

export default function MapaGeral() {
  // ─── State ───
  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState('satellite');
  const [showAreas, setShowAreas] = useState(true);
  const [showPontos, setShowPontos] = useState(true);
  const [showLinhas, setShowLinhas] = useState(true);
  const [showLotes, setShowLotes] = useState(true);
  const [showPontosSuplementacao, setShowPontosSuplementacao] = useState(true);
  const [showAlertas, setShowAlertas] = useState(true);
  const [showUserLocation, setShowUserLocation] = useState(false);
  const [showNomesAreas, setShowNomesAreas] = useState(true);
  const [userLocation, setUserLocation] = useState(null);

  // Filtros avançados
  const [filtroCategoria, setFiltroCategoria] = useState('todas');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroSistema, setFiltroSistema] = useState('todos');
  const [filtroTipoCultura, setFiltroTipoCultura] = useState('todas');
  const [filtroTipoPastagem, setFiltroTipoPastagem] = useState('todas');
  const [filtroPesoMin, setFiltroPesoMin] = useState(null);
  const [filtroPesoMax, setFiltroPesoMax] = useState(null);
  const [modoColoracao, setModoColoracao] = useState('padrao');

  // Painéis
  const [showDetalhesLote, setShowDetalhesLote] = useState(false);
  const [selectedLote, setSelectedLote] = useState(null);
  const [showDetalhesPontoSupl, setShowDetalhesPontoSupl] = useState(false);
  const [selectedPontoSupl, setSelectedPontoSupl] = useState(null);
  const [showDetalhesArea, setShowDetalhesArea] = useState(false);
  const [selectedArea, setSelectedArea] = useState(null);
  const [showTarefas, setShowTarefas] = useState(false);
  const [tarefasContext, setTarefasContext] = useState({});
  const [showInsights, setShowInsights] = useState(false);
  const [showFiltros, setShowFiltros] = useState(false);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const firstFitDoneRef = useRef(false);
  const renderer = useMapRenderer(mapInstanceRef);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  useEffect(() => {firstFitDoneRef.current = false;}, [empresaSelecionadaId]);

  // ─── Queries ───
  const ST = 2 * 60 * 1000;

  const { data: areas = [], refetch: refetchAreas } = useQuery({
    queryKey: ['mapa-areas', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.AreaPastagem.list();return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);},
    enabled: !!empresaSelecionadaId, staleTime: ST
  });

  const { data: pontos = [], refetch: refetchPontosRef } = useQuery({
    queryKey: ['mapa-pontos', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.PontoReferencia.list();return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.ativo !== false);},
    enabled: !!empresaSelecionadaId, staleTime: ST
  });

  const { data: pontosSuplementacao = [], refetch: refetchPontosSupl } = useQuery({
    queryKey: ['mapa-pontos-supl', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.PontoSuplementacao.list();return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.status === 'Ativo');},
    enabled: !!empresaSelecionadaId, staleTime: ST
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ['mapa-linhas', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.LinhaGeografica.list();return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.ativo !== false);},
    enabled: !!empresaSelecionadaId, staleTime: ST
  });

  const { data: lotes = [], refetch: refetchLotes } = useQuery({
    queryKey: ['mapa-lotes', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.Lote.list();return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');},
    enabled: !!empresaSelecionadaId, staleTime: ST
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['mapa-icones'],
    queryFn: async () => {const all = await base44.entities.ConfiguracaoIcone.list();return all.filter((i) => i.ativo !== false);},
    staleTime: 10 * 60 * 1000
  });

  const { data: eventosSupl = [], refetch: refetchEventosSupl } = useQuery({
    queryKey: ['mapa-eventos-supl', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.SuplementacaoEvento.list();return all.filter((e) => e.empresa_id === empresaSelecionadaId);},
    enabled: !!empresaSelecionadaId, staleTime: ST
  });

  const { data: estoqueLotes = [], refetch: refetchEstoqueLotes } = useQuery({
    queryKey: ['mapa-estoque-lotes', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.EstoqueLoteNota.list();return all.filter((item) => item.empresa_id === empresaSelecionadaId && item.status === 'Disponivel');},
    enabled: !!empresaSelecionadaId, staleTime: ST
  });

  const { data: tarefasMapa = [], refetch: refetchTarefas } = useQuery({
    queryKey: ['mapa-tarefas', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.TarefaMapa.list();return all.filter((t) => t.empresa_id === empresaSelecionadaId && t.coordenadas && (t.status === 'Pendente' || t.status === 'Em Andamento'));},
    enabled: !!empresaSelecionadaId, staleTime: ST
  });

  // Movimentações para calcular situação do pasto
  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['mapa-movimentacoes', empresaSelecionadaId],
    queryFn: async () => {const all = await base44.entities.MovimentacaoMapa.list('-data_movimentacao', 500);return all.filter((m) => m.empresa_id === empresaSelecionadaId);},
    enabled: !!empresaSelecionadaId && modoColoracao === 'situacao_pasto',
    staleTime: ST
  });

  // ─── Dados derivados ───
  const lotesComAlerta = useMemo(() => lotes.map((lote) => {
    const alertas = [];
    const ev = eventosSupl.filter((e) => e.area_id === lote.area_atual_id);
    if (ev.length > 0) {
      const ultimo = ev.sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];
      const d = Math.floor((new Date() - new Date(ultimo.data_lancamento)) / 86400000);
      if (d > 10) alertas.push({ tipo: 'suplementacao', dias: d });
    }
    if (lote.peso_medio_kg && lote.peso_medio_kg < 50 && (lote.categoria?.includes('Bezerr') || lote.categoria?.includes('0 a 12')))
    alertas.push({ tipo: 'peso_baixo', peso: lote.peso_medio_kg });
    return { ...lote, alertas };
  }), [lotes, eventosSupl]);

  const categorias = useMemo(() => [...new Set(lotes.map((l) => l.categoria).filter(Boolean))].sort(), [lotes]);
  const tiposPastagem = useMemo(() => [...new Set(areas.map((a) => a.tipo_pastagem).filter(Boolean))].sort(), [areas]);
  const sistemasProdutivos = useMemo(() => [...new Set(lotes.map((l) => l.sistema_produtivo).filter(Boolean))].sort(), [lotes]);

  const pontosSuplementacaoDecorados = useMemo(() => {
    return pontosSuplementacao.map((ponto) => {
      const referencia = pontos.find((item) => normalizeText(item.nome) === normalizeText(ponto.nome_ponto)) || null;
      const indicador = normalizeText(ponto.categoria_ponto || 'COCHO') === 'DEPOSITO' ?
      getDepositoIndicator(ponto, pontosSuplementacao, lotes, estoqueLotes, []) :
      getCochoIndicator(ponto, eventosSupl);

      return {
        ...ponto,
        indicador_percentual: indicador.percent,
        indicador_helper: indicador.helperLabel,
        ultimo_registro: indicador.latestRecord,
        icone_status_url: referencia?.icone_url ? buildProgressIconUrl(referencia.icone_url, indicador.percent) : null,
        sub_icone_status_url: referencia?.sub_icone_url ? buildProgressIconUrl(referencia.sub_icone_url, indicador.percent, 40) : null
      };
    });
  }, [pontosSuplementacao, pontos, lotes, estoqueLotes, eventosSupl]);

  // Filtrar áreas
  const areasFiltradas = useMemo(() => areas.filter((a) => {
    if (filtroTipoCultura !== 'todas' && a.tipo_cultura !== filtroTipoCultura) return false;
    if (filtroTipoPastagem !== 'todas' && a.tipo_pastagem !== filtroTipoPastagem) return false;
    return true;
  }), [areas, filtroTipoCultura, filtroTipoPastagem]);

  // Filtrar lotes
  const lotesFiltrados = useMemo(() => lotesComAlerta.filter((lote) => {
    if (filtroCategoria !== 'todas' && lote.categoria !== filtroCategoria) return false;
    if (filtroStatus === 'com_alerta' && lote.alertas.length === 0) return false;
    if (filtroStatus === 'sem_alerta' && lote.alertas.length > 0) return false;
    if (filtroSistema !== 'todos' && lote.sistema_produtivo !== filtroSistema) return false;
    if (filtroPesoMin && (!lote.peso_medio_kg || lote.peso_medio_kg < filtroPesoMin)) return false;
    if (filtroPesoMax && lote.peso_medio_kg && lote.peso_medio_kg > filtroPesoMax) return false;
    return true;
  }), [lotesComAlerta, filtroCategoria, filtroStatus, filtroSistema, filtroPesoMin, filtroPesoMax]);

  // Mapa de cores para categorias de manejo e pastagem
  const categoriasGadoCores = useMemo(() => {
    const m = {};
    categorias.forEach((c, i) => {m[c] = CORES_CATEGORIA_GADO[i % CORES_CATEGORIA_GADO.length];});
    return m;
  }, [categorias]);

  const tiposPastagemCores = useMemo(() => {
    const m = {};
    tiposPastagem.forEach((t, i) => {m[t] = CORES_CATEGORIA_GADO[i % CORES_CATEGORIA_GADO.length];});
    return m;
  }, [tiposPastagem]);

  // Calcular UA por área (1 UA = 450 kg PV - padrão Embrapa)
  // Usa ÁREA EFETIVA (area_pastejada) para cálculo de UA/ha, não área total
  const uaPorAreaMap = useMemo(() => {
    const m = {};
    lotes.forEach((l) => {
      if (!l.area_atual_id) return;
      if (!m[l.area_atual_id]) m[l.area_atual_id] = { ua: 0, cabecas: 0 };
      const peso = l.peso_medio_kg || 0;
      const cab = l.quantidade_cabecas || 0;
      m[l.area_atual_id].ua += peso * cab / 450;
      m[l.area_atual_id].cabecas += cab;
    });
    return m;
  }, [lotes]);

  // Helper: retorna área efetiva (pastejada) se disponível, senão área total
  const getAreaEfetiva = useCallback((area) => {
    const pastejada = area.area_pastejada;
    if (pastejada && pastejada > 0) return pastejada;
    return area.tamanho_hectares || 0;
  }, []);

  // Calcular situação do pasto (ocupado com dias, ou vazio em descanso)
  const situacaoPastoMap = useMemo(() => {
    const m = {};
    const agora = new Date();
    areas.forEach((a) => {
      const lotesNaArea = lotes.filter((l) => l.area_atual_id === a.id);
      if (lotesNaArea.length > 0) {
        // Área COM animais: calcular dias desde a data_entrada mais antiga
        const datasEntrada = lotesNaArea.map((l) => l.data_entrada ? new Date(l.data_entrada) : agora).filter((d) => !isNaN(d));
        const maisAntiga = datasEntrada.length > 0 ? new Date(Math.min(...datasEntrada)) : agora;
        const dias = Math.max(0, Math.floor((agora - maisAntiga) / 86400000));
        m[a.id] = { tipo: 'ocupado', dias };
      } else {
        // Área SEM animais: verificar última movimentação de saída desta área
        const movsSaida = movimentacoes.filter((mv) => mv.area_origem_id === a.id && mv.tipo === 'Transferência de Área');
        if (movsSaida.length > 0) {
          const ultimaSaida = new Date(movsSaida[0].data_movimentacao);
          const diasSem = Math.max(0, Math.floor((agora - ultimaSaida) / 86400000));
          m[a.id] = { tipo: 'descanso', dias: diasSem };
        } else {
          m[a.id] = { tipo: 'vazia', dias: null };
        }
      }
    });
    return m;
  }, [areas, lotes, movimentacoes]);

  // Função de cor para áreas baseada no modo de coloração
  const getAreaColor = useCallback((area) => {
    if (modoColoracao === 'tipo_cultura') return CORES_TIPO_CULTURA[area.tipo_cultura] || '#94a3b8';
    if (modoColoracao === 'aproveitamento') return CORES_APROVEITAMENTO[area.aproveitamento_classificacao] || '#94a3b8';
    if (modoColoracao === 'ocupacao') return CORES_OCUPACAO[area.status_ocupacao] || '#94a3b8';
    if (modoColoracao === 'tipo_pastagem') return tiposPastagemCores[area.tipo_pastagem] || '#94a3b8';
    if (modoColoracao === 'categoria_gado') {
      const lotesNaArea = lotes.filter((l) => l.area_atual_id === area.id);
      if (lotesNaArea.length === 0) return '#d1d5db';
      const cat = lotesNaArea[0].categoria;
      return categoriasGadoCores[cat] || '#94a3b8';
    }
    if (modoColoracao === 'ua_ha') {
      const info = uaPorAreaMap[area.id];
      const ha = getAreaEfetiva(area); // Usa área efetiva!
      if (!info || info.ua === 0) return '#d1d5db'; // sem gado
      if (ha <= 0) return '#94a3b8';
      const uaHa = info.ua / ha;
      // Faixas baseadas em Embrapa/Scot (pastagem tropical, ~20% margem)
      if (uaHa < 0.8) return '#86efac'; // sublotação
      if (uaHa < 1.2) return '#22c55e'; // moderada
      if (uaHa < 1.8) return '#3b82f6'; // ideal
      if (uaHa < 2.4) return '#f59e0b'; // alta (até 20% acima)
      return '#ef4444'; // superlotação
    }
    if (modoColoracao === 'situacao_pasto') {
      const info = situacaoPastoMap[area.id];
      if (!info) return '#d1d5db';
      if (info.tipo === 'vazia') return '#d1d5db'; // sem histórico
      if (info.tipo === 'descanso') return '#86efac'; // em descanso
      // Ocupado
      if (info.dias <= 45) return '#3b82f6'; // normal
      if (info.dias <= 90) return '#f59e0b'; // atenção
      return '#ef4444'; // crítico
    }
    return null; // padrao: usar cor da área
  }, [modoColoracao, lotes, categoriasGadoCores, tiposPastagemCores, uaPorAreaMap, situacaoPastoMap, getAreaEfetiva]);

  // ─── Inicializar Mapa ───
  useEffect(() => {
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -15.0067, lng: -59.9533 }, zoom: 15, mapTypeId: mapType,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        gestureHandling: 'greedy',
        zoomControl: !mobile, disableDefaultUI: mobile, clickableIcons: false,
        minZoom: 3, maxZoom: 22
      });
      mapInstanceRef.current = map;
      google.maps.event.addListenerOnce(map, 'tilesloaded', () => setMapReady(true));
    }).catch(() => toast.error('Erro ao carregar mapa.'));
    return () => renderer.clearAll();
  }, []);

  useEffect(() => {if (mapInstanceRef.current) mapInstanceRef.current.setMapTypeId(mapType);}, [mapType]);

  // Fit bounds 1x
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || !areas.length || firstFitDoneRef.current) return;
    const b = new google.maps.LatLngBounds();
    let ok = false;
    areas.forEach((a) => (a.coordenadas?.coords || []).forEach((c) => {
      const lat = c[0] || c.lat,lng = c[1] || c.lng;
      if (typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng)) {b.extend({ lat, lng });ok = true;}
    }));
    if (ok) {mapInstanceRef.current.fitBounds(b, { padding: 50 });firstFitDoneRef.current = true;}
  }, [areas, mapReady]);

  // ─── Handlers ───
  // Clique na área agora abre Dialog (igual ao lote) em vez de Sheet lateral
  const handleClickArea = useCallback((area) => {setSelectedArea(area);setShowDetalhesArea(true);}, []);
  const handleRightClickArea = useCallback((area) => {setSelectedArea(area);setShowDetalhesArea(true);}, []);
  const handleClickPontoSupl = useCallback((p) => {setSelectedPontoSupl(p);setShowDetalhesPontoSupl(true);}, []);
  const handleClickLotes = useCallback((l) => {setSelectedLote(l);setShowDetalhesLote(true);}, []);
  const handleClickTarefa = useCallback((t) => {setTarefasContext({ areaId: t.area_id, areaNome: t.area_nome });setShowTarefas(true);}, []);

  const handleDragLotes = useCallback((newPos, lotesNaArea, areaId, allAreas) => {
    const orig = allAreas.find((a) => a.id === areaId);
    if (orig) {const ps = orig.coordenadas.coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));if (ptInPoly(newPos, ps)) {toast.error('Arraste para outra área');return;}}
    let dest = null;
    for (const a of allAreas) {if (a.id === areaId || !a.coordenadas?.coords || a.coordenadas.coords.length < 3) continue;if (ptInPoly(newPos, a.coordenadas.coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng })))) {dest = a;break;}}
    if (dest) {window.areaDestinoArrastada = dest.id;setSelectedLote(lotesNaArea);setShowDetalhesLote(true);setTimeout(() => window.dispatchEvent(new CustomEvent('open-movimentacao')), 100);} else
    toast.error('Solte sobre outra área');
  }, []);

  const handleRefresh = useCallback(() => {
    refetchLotes();refetchAreas();refetchEventosSupl();refetchPontosSupl();refetchPontosRef();refetchTarefas();refetchEstoqueLotes();
    toast.success('Mapa atualizado');
  }, []);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };setUserLocation(loc);setShowUserLocation(true);if (mapInstanceRef.current) {mapInstanceRef.current.setCenter(loc);mapInstanceRef.current.setZoom(18);}},
      () => toast.error('Erro ao obter localização')
    );
  }, []);

  // ─── Renderização incremental ───
  useEffect(() => {if (mapReady) renderer.syncAreas(areasFiltradas, showAreas, handleClickArea, handleRightClickArea, getAreaColor);}, [areasFiltradas, showAreas, mapReady, getAreaColor]);
  // Função de texto extra para labels (UA/ha ou situação do pasto)
  const getLabelExtraText = useCallback((area) => {
    if (modoColoracao === 'ua_ha') {
      const info = uaPorAreaMap[area.id];
      if (!info || info.ua === 0) return null;
      const ha = getAreaEfetiva(area); // Usa área efetiva!
      const uaStr = info.ua.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      if (ha > 0) {
        const uaHa = (info.ua / ha).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `${uaStr} UA (${uaHa}/ha)`;
      }
      return `${uaStr} UA`;
    }
    if (modoColoracao === 'situacao_pasto') {
      const info = situacaoPastoMap[area.id];
      if (!info) return null;
      if (info.tipo === 'vazia') return 'Sem gado';
      if (info.tipo === 'descanso') return `Descanso ${info.dias}d`;
      return `Ocupado ${info.dias}d`;
    }
    return null;
  }, [modoColoracao, uaPorAreaMap, situacaoPastoMap, getAreaEfetiva]);

  // Quando o modo muda, forçar recriar labels para atualizar texto extra
  useEffect(() => {
    if (mapReady && (modoColoracao === 'ua_ha' || modoColoracao === 'situacao_pasto')) {
      // Limpar labels existentes para forçar recriação com texto extra
      renderer.syncLabels([], false);
      setTimeout(() => {
        renderer.syncLabels(areasFiltradas, showNomesAreas && showAreas, getLabelExtraText);
      }, 50);
    } else if (mapReady) {
      renderer.syncLabels([], false);
      setTimeout(() => {
        renderer.syncLabels(areasFiltradas, showNomesAreas && showAreas, null);
      }, 50);
    }
  }, [areasFiltradas, showNomesAreas, showAreas, mapReady, modoColoracao, getLabelExtraText]);
  // Filtrar pontos de referência: ocultar tipo "Cocho" quando cochos/suplementação estão ocultos
  const pontosFiltrados = useMemo(() => {
    if (showPontosSuplementacao) return pontos;
    return pontos.filter((p) => {
      const tipo = (p.tipo || '').toUpperCase().trim();
      return tipo !== 'COCHO' && tipo !== 'COCHOS';
    });
  }, [pontos, showPontosSuplementacao]);

  useEffect(() => {if (mapReady) renderer.syncPontos(pontosFiltrados, showPontos, iconesConfig);}, [pontosFiltrados, showPontos, iconesConfig, mapReady]);
  useEffect(() => {if (mapReady) renderer.syncLinhas(linhas, showLinhas);}, [linhas, showLinhas, mapReady]);
  useEffect(() => {if (mapReady) renderer.syncPontosSuplementacao(pontosSuplementacaoDecorados, showPontosSuplementacao, iconesConfig, handleClickPontoSupl);}, [pontosSuplementacaoDecorados, showPontosSuplementacao, iconesConfig, mapReady]);
  useEffect(() => {if (mapReady) renderer.syncLotes(lotesFiltrados, areas, showLotes, iconesConfig, handleClickLotes, handleDragLotes);}, [lotesFiltrados, areas, showLotes, iconesConfig, mapReady]);
  useEffect(() => {if (mapReady) renderer.syncTarefas(tarefasMapa, handleClickTarefa);}, [tarefasMapa, mapReady]);
  useEffect(() => {if (mapReady) renderer.syncUserLocation(userLocation, showUserLocation);}, [userLocation, showUserLocation, mapReady]);

  useEffect(() => {
    const h = () => {refetchLotes();refetchAreas();refetchEventosSupl();refetchPontosSupl();refetchPontosRef();refetchEstoqueLotes();};
    window.addEventListener('atualizar-mapa', h);
    return () => window.removeEventListener('atualizar-mapa', h);
  }, []);

  // ─── Render ───
  const totalCabecas = lotes.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
  const areasOcupadas = new Set(lotes.map((l) => l.area_atual_id).filter(Boolean)).size;
  const totalAlertas = lotesComAlerta.filter((l) => l.alertas.length > 0).length;

  return (
    <div className="fixed inset-0 z-50 bg-white" translate="no">
      <div className="w-full h-full relative">
        <div ref={mapRef} style={{ height: '100%', width: '100%', backgroundColor: '#e5e7eb', touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }} />

        {/* Controles Mobile */}
        <MapaControlesMobile
          mapType={mapType} setMapType={setMapType}
          onRefresh={handleRefresh} onLocate={handleLocate}
          onOpenTarefas={() => {setTarefasContext({});setShowTarefas(true);}}
          onOpenInsights={() => setShowInsights(true)}
          onOpenFiltros={() => setShowFiltros(true)} />


        {/* Legenda */}
        <MapaLegenda
          modoColoracao={modoColoracao}
          categoriasGadoCores={categoriasGadoCores}
          tiposPastagemCores={tiposPastagemCores} />


        {/* Barra resumo inferior */}
        <div className="absolute bottom-2 left-2 right-2 z-10">
          <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg px-3 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px]">
              <div className="text-center">
                <div className="font-bold text-emerald-700 text-sm leading-tight">{totalCabecas}</div>
                <div className="text-slate-500">Animais</div>
              </div>
              <div className="w-px h-5 bg-slate-200" />
              <div className="text-center">
                <div className="font-bold text-blue-700 text-sm leading-tight">{areasFiltradas.length}</div>
                <div className="text-slate-500">Áreas</div>
              </div>
              <div className="w-px h-5 bg-slate-200" />
              <div className="text-center">
                <div className="font-bold text-slate-700 text-sm leading-tight">{areasOcupadas}</div>
                <div className="text-slate-500">Ocupadas</div>
              </div>
              <div className="w-px h-5 bg-slate-200" />
              <div className="text-center">
                <div className="font-bold text-amber-700 text-sm leading-tight">{totalAlertas}</div>
                <div className="text-slate-500">Alertas</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowInsights(true)} className="h-6 text-[10px] gap-1 text-emerald-700 px-2">
              <BarChart3 className="w-3 h-3" /> Insights
            </Button>
          </div>
        </div>

        {!mapReady &&
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full" />
              <span className="font-semibold text-slate-700 text-sm">Carregando mapa...</span>
            </div>
          </div>
        }
      </div>

      {/* ─── Sheet Filtros Avançados ─── */}
      <Sheet open={showFiltros} onOpenChange={setShowFiltros}>
        <SheetContent side="left" className="p-1 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left bg-background py-6 fixed z-50 gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out inset-y-0 left-0 h-full border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm w-[300px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-sm">Filtros e Camadas</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <MapaFiltrosAvancados
              showAreas={showAreas} setShowAreas={setShowAreas}
              showPontos={showPontos} setShowPontos={setShowPontos}
              showLinhas={showLinhas} setShowLinhas={setShowLinhas}
              showLotes={showLotes} setShowLotes={setShowLotes}
              showPontosSuplementacao={showPontosSuplementacao} setShowPontosSuplementacao={setShowPontosSuplementacao}
              showAlertas={showAlertas} setShowAlertas={setShowAlertas}
              showUserLocation={showUserLocation} setShowUserLocation={setShowUserLocation}
              showNomesAreas={showNomesAreas} setShowNomesAreas={setShowNomesAreas}
              filtroCategoria={filtroCategoria} setFiltroCategoria={setFiltroCategoria}
              filtroStatus={filtroStatus} setFiltroStatus={setFiltroStatus}
              filtroSistema={filtroSistema} setFiltroSistema={setFiltroSistema}
              filtroTipoCultura={filtroTipoCultura} setFiltroTipoCultura={setFiltroTipoCultura}
              filtroTipoPastagem={filtroTipoPastagem} setFiltroTipoPastagem={setFiltroTipoPastagem}
              filtroPesoMin={filtroPesoMin} setFiltroPesoMin={setFiltroPesoMin}
              filtroPesoMax={filtroPesoMax} setFiltroPesoMax={setFiltroPesoMax}
              modoColoracao={modoColoracao} setModoColoracao={setModoColoracao}
              categorias={categorias}
              tiposPastagem={tiposPastagem}
              sistemasProdutivos={sistemasProdutivos} />

          </div>
        </SheetContent>
      </Sheet>

      {/* ─── Dialogs ─── */}
      <Dialog open={showDetalhesLote} onOpenChange={(open) => {setShowDetalhesLote(open);if (!open) setTimeout(() => refetchLotes(), 300);}}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle translate="no">Detalhes do Lote</DialogTitle></DialogHeader>
          {selectedLote && <DetalhesLote lotes={Array.isArray(selectedLote) ? selectedLote : [selectedLote]} onClose={() => {setShowDetalhesLote(false);setTimeout(() => refetchLotes(), 300);}} />}
        </DialogContent>
      </Dialog>

      <Dialog open={showDetalhesArea} onOpenChange={setShowDetalhesArea}>
        <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="sr-only"><DialogTitle>Detalhes da Área</DialogTitle></DialogHeader>
          {selectedArea && <AreaPanel area={selectedArea} onClose={() => setShowDetalhesArea(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={showDetalhesPontoSupl} onOpenChange={(open) => {setShowDetalhesPontoSupl(open);if (!open) setTimeout(() => {refetchEventosSupl();refetchLotes();refetchPontosSupl();}, 300);}}>
        <DialogContent className="fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-w-[65vw] max-h-[95vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{selectedPontoSupl?.categoria_ponto === 'DEPOSITO' ? 'Depósito de Suplementação' : 'Ponto de Suplementação'}</DialogTitle></DialogHeader>
          {selectedPontoSupl && <DetalhesPontoSuplementacao ponto={selectedPontoSupl} onClose={() => {setShowDetalhesPontoSupl(false);setTimeout(() => {refetchEventosSupl();refetchLotes();refetchPontosSupl();}, 300);}} />}
        </DialogContent>
      </Dialog>

      <Dialog open={showTarefas} onOpenChange={(open) => {setShowTarefas(open);if (!open) refetchTarefas();}}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Tarefas do Mapa</DialogTitle></DialogHeader>
          <TarefasMapaPanel areaId={tarefasContext.areaId} areaNome={tarefasContext.areaNome} loteId={tarefasContext.loteId} loteNome={tarefasContext.loteNome} pontoSuplId={tarefasContext.pontoSuplId} onClose={() => {setShowTarefas(false);refetchTarefas();}} />
        </DialogContent>
      </Dialog>

      <Dialog open={showInsights} onOpenChange={setShowInsights}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-sm"><BarChart3 className="w-4 h-4 text-emerald-600" /> Insights do Mapa</DialogTitle></DialogHeader>
          <MapaInsights lotes={lotesComAlerta} areas={areas} eventosSupl={eventosSupl} pontosSuplementacao={pontosSuplementacaoDecorados} pontosReferencia={pontos} />
        </DialogContent>
      </Dialog>
    </div>);

}

function ptInPoly(latLng, paths) {
  let inside = false;
  const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat;
  const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng;
  for (let i = 0, j = paths.length - 1; i < paths.length; j = i++) {
    const xi = paths[i].lat,yi = paths[i].lng,xj = paths[j].lat,yj = paths[j].lng;
    if (yi > lng !== yj > lng && lat < (xj - xi) * (lng - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}