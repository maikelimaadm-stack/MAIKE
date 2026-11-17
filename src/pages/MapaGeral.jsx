import { filtroInclui, filtroSemRestricao } from '@/lib/mapaFiltroSelecao';
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { EVENTO_PERMISSOES_ATUALIZADAS, carregarPermissaoEfetiva, ehAdministrador, getCurrentUser } from "@/services/sessionService";
import { listarBebedourosAtivos } from "@/services/mapaService";
import { mapaPrecisaBuscarNoServidor } from "@/components/mapa/invalidarCachesMapa";
import {
  bebedouroDoPonto, calcularSituacaoPasto, filtrarLotesPorArea, filtrarPontosSuplementacaoPorArea,
  filtrarTarefasPorArea, filtroDeAreaAtivo, statusOcupacaoPorArea } from "@/domain/mapa/mapaGeralDerivados";
import { canAccessPage } from "@/lib/permissions";
import { MAPA_GERAL_ACESSO_TOTAL, normalizeMapaGeralPermissions } from "@/lib/mapaGeralPermissions";
import { podeExcluirLancamentoBebedouro, podeLancarNoBebedouro } from "@/lib/bebedouroPermissions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import MapaFiltrosPainel from "@/components/mapa/MapaFiltrosPainel";
import DetalhesLote from "../components/mapa/DetalhesLote";
import PainelResumoRebanho from "@/components/mapa/resumo-rebanho/PainelResumoRebanho";
import DetalhesArea from "../components/mapa/DetalhesArea";
import { acaoDoCliqueNaArea } from "@/domain/mapa/cliqueArea";
import DetalhesPontoSuplementacao from "../components/mapa/DetalhesPontoSuplementacao";
import DetalhesBebedouro from "../components/bebedouros/DetalhesBebedouro";
import TarefasMapaPanel from "../components/mapa/TarefasMapaPanel";
import DetalhesTarefaMapa from "../components/mapa/DetalhesTarefaMapa";
import { LancLoteDialogo } from "../components/lotes/LancamentoLoteUi";
import MapaInsights from "../components/mapa/MapaInsights";
import MapaControlesMobile from "../components/mapa/MapaControlesMobile";
import MapaFiltrosAvancados, {
  CORES_TIPO_CULTURA, CORES_APROVEITAMENTO, CORES_OCUPACAO, CORES_CATEGORIA_GADO,
  CORES_UA_HA, CORES_SITUACAO_PASTO } from
"../components/mapa/MapaFiltrosAvancados";
import MapaVisualizacao from "../components/mapa/MapaVisualizacao";
import MapaLegenda from "../components/mapa/MapaLegenda";
import useMapRenderer from "../components/mapa/useMapRenderer";
import useSetorAreas from "@/hooks/useSetorAreas";
import { useBebedouros } from "@/hooks/useBebedouros";
import { getCochoIndicator, getDepositoIndicator, buildProgressIconUrl } from "../components/mapa/pontoStatusUtils";
import { descreverFarol, farolDoCocho } from "@/domain/suplementacao/leituraCocho";
import { corForragemDaArea, farolForragemComEstimativaPorArea } from "@/domain/pastagem/farolForragem";
import { buildMapaAlertasSuplementacao } from "../components/mapa/mapaAlertasSuplementacaoUtils";
import { normalizeText } from "../components/suplementacao/estoqueSuplementacaoUtils";
import { BASEMAP_IDS, CENTRO_PADRAO } from "@/lib/maplibre/basemap.js";
import { createEditorMap } from "@/lib/maplibre/lifecycle.js";
import { boundsDasAreas, lerVisaoSalva } from "@/lib/maplibre/mapaGeralRender.js";
import { parseVertices } from "@/lib/geografia/coords.js";
import useBasemap from "../components/mapa/useBasemap";
import BasemapAtribuicao from "../components/mapa/BasemapAtribuicao";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { useDiaCivil } from "@/hooks/useDiaCivil";
import { listEmpresas } from "@/services/empresaService";
import { lerFiltrosMapaGeral, salvarFiltrosMapaGeral, normalizarFiltrosMapa, camadasVisiveis, preferenciaAplicada } from "@/lib/mapaGeralFiltrosStorage";
import { camadasDoFoco, focoEmVigor, focosPermitidos } from "@/lib/mapaFoco";
import { useAuth } from "@/lib/AuthContext";
import { mensagemFalhaMapa, navegadorTemWebGL, MENSAGEM_WEBGL_DESLIGADO } from "@/lib/maplibre/falhaWebGL";

export default function MapaGeral() {
  const queryClient = useQueryClient();
  // ─── State ───
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState(null);
  const [mapEpoch, setMapEpoch] = useState(0);
  const [mapInstance, setMapInstance] = useState(null);
  const [mapType, setMapTypeState] = useState('satellite');
  const [prefShowAreas, setShowAreas] = useState(true);
  const [prefShowPontos, setShowPontos] = useState(true);
  const [prefShowLinhas, setShowLinhas] = useState(true);
  const [prefShowLotes, setShowLotes] = useState(true);
  const [prefShowCochos, setShowCochos] = useState(true);
  const [prefShowDepositos, setShowDepositos] = useState(true);
  const [prefShowAlertas, setShowAlertas] = useState(true);
  const [prefShowUserLocation, setShowUserLocation] = useState(false);
  const [prefShowNomesAreas, setShowNomesAreas] = useState(true);
  const [prefShowHectaresAreas, setShowHectaresAreas] = useState(true);
  const [userLocation, setUserLocation] = useState(null);

  // Filtros avançados — preferência (pref*); o valor aplicado é derivado abaixo
  // (`preferenciaAplicada`), conforme a permissão do painel (D-PROD-137).
  const [prefFiltroCategoria, setFiltroCategoria] = useState(/** @type {string | string[]} */ ('todas'));
  const [prefFiltroIdentificador, setFiltroIdentificador] = useState(/** @type {string | string[]} */ ('todos'));
  const [prefFiltroStatus, setFiltroStatus] = useState(/** @type {string | string[]} */ ('todos'));
  const [prefFiltroSistema, setFiltroSistema] = useState(/** @type {string | string[]} */ ('todos'));
  const [prefFiltroAlertaTipo, setFiltroAlertaTipo] = useState(/** @type {string | string[]} */ ('todos'));
  const [prefFiltroTipoCultura, setFiltroTipoCultura] = useState(/** @type {string | string[]} */ ('todas'));
  const [prefFiltroTipoPastagem, setFiltroTipoPastagem] = useState(/** @type {string | string[]} */ ('todas'));
  const [prefFiltroSetor, setFiltroSetor] = useState(/** @type {string | string[]} */ ('todos'));
  const [prefFiltroPesoMin, setFiltroPesoMin] = useState(null);
  const [prefFiltroPesoMax, setFiltroPesoMax] = useState(null);
  const [prefModoColoracao, setModoColoracao] = useState('padrao');
  const [estiloPasto, setEstiloPasto] = useState('cheio');

  // Painéis
  const [showDetalhesLote, setShowDetalhesLote] = useState(false);
  // D-PROD-213: Resumo do Rebanho (abre pelo cartão do resumo inferior).
  const [showResumoRebanho, setShowResumoRebanho] = useState(false);
  const [selectedLote, setSelectedLote] = useState(null);
  const [showDetalhesArea, setShowDetalhesArea] = useState(false);
  const [selectedArea, setSelectedArea] = useState(null);
  const [showDetalhesPontoSupl, setShowDetalhesPontoSupl] = useState(false);
  const [selectedPontoSupl, setSelectedPontoSupl] = useState(null);
  const [showDetalhesBebedouro, setShowDetalhesBebedouro] = useState(false);
  const [selectedBebedouro, setSelectedBebedouro] = useState(null);
  const [showTarefas, setShowTarefas] = useState(false);
  const [tarefasContext, setTarefasContext] = useState({});
  /** Nome do local no subtítulo da Gestão de Tarefas (D-PROD-118). */
  const localDasTarefas = /** @type {{ areaNome?: string, loteNome?: string }} */ (tarefasContext).areaNome || /** @type {{ loteNome?: string }} */ (tarefasContext).loteNome || "";
  const [selectedTarefa, setSelectedTarefa] = useState(null);
  const [showDetalhesTarefa, setShowDetalhesTarefa] = useState(false);
  const [selecionandoLocalTarefa, setSelecionandoLocalTarefa] = useState(false);
  const [rascunhoTarefa, setRascunhoTarefa] = useState(null);
  const [showInsights, setShowInsights] = useState(false);
  const [showFiltros, setShowFiltros] = useState(false);
  const [prefShowTaskIcons, setShowTaskIcons] = useState(true);
  const [prefDragLotesEnabled, setDragLotesEnabled] = useState(false);
  // D-PROD-218 (B3): foco da barra do topo (Lotes · Pastos · Tarefas). Estado
  // da página, NÃO salvo: o mapa abre sempre em Lotes, como no v12.
  const [foco, setFoco] = useState('lotes');

  const empresaSelecionadaId = useEmpresaSelecionadaId();

  // ─── Dia civil da FAZENDA (D-PROD-178) ───
  // O nível do cocho conta dias civis no fuso da fazenda (`Empresa.fuso_horario`)
  // e vira sozinho à meia-noite NAQUELE fuso (um timer de módulo, sem refetch).
  // Mesmo resumo de empresas do Layout (cache compartilhado). Empresa sem fuso
  // configurado: relógio do navegador (`hojeNoFuso(null)`).
  const empresasQuery = useQuery({
    queryKey: ['empresas'],
    queryFn: () => listEmpresas(),
    enabled: Boolean(empresaSelecionadaId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });
  const fusoFazenda = useMemo(() => {
    const lista = Array.isArray(empresasQuery.data) ? empresasQuery.data : [];
    const empresa = lista.find((e) => String(e?.id) === String(empresaSelecionadaId));
    return typeof empresa?.fuso_horario === 'string' && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresasQuery.data, empresaSelecionadaId]);
  const hoje = useDiaCivil(fusoFazenda);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const disposeMapRef = useRef(null);
  const firstFitDoneRef = useRef(false);
  const mapViewRestoredRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const longPressStartRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const ignoreNextMapClickRef = useRef(false);
  const renderer = useMapRenderer(mapInstanceRef);
  const rendererEnsureRef = useRef(renderer.ensureLayers);
  const rendererHitRef = useRef(renderer.hitArea);
  const rendererEstiloRef = useRef(renderer.setEstiloPasto);
  rendererEstiloRef.current = renderer.setEstiloPasto;
  useEffect(() => {
    if (mapReady) rendererEstiloRef.current?.(estiloPasto);
  }, [mapReady, estiloPasto]);
  rendererHitRef.current = renderer.hitArea;
  rendererEnsureRef.current = renderer.ensureLayers;
  const basemap = useBasemap(mapInstance, {
    inicial: BASEMAP_IDS.SATELITE,
    reaplicarCamadas: () => rendererEnsureRef.current?.(),
  });
  const basemapSetRef = useRef(basemap.setBasemap);
  basemapSetRef.current = basemap.setBasemap;
  const setMapType = useCallback((tipo) => {
    setMapTypeState(tipo);
    basemapSetRef.current(tipo === 'satellite' ? BASEMAP_IDS.SATELITE : BASEMAP_IDS.RUAS);
  }, []);
  const mapTypeEfetivo = basemap.basemapId === BASEMAP_IDS.SATELITE ? 'satellite' : 'roadmap';

  const { setores } = useSetorAreas(empresaSelecionadaId);
  useEffect(() => {firstFitDoneRef.current = false;mapViewRestoredRef.current = false;}, [empresaSelecionadaId]);

  const { data: currentUser = null } = useQuery({
    queryKey: ['mapa-geral-user'],
    // Online lê do provider e persiste; offline devolve o último conhecido.
    // A política inteira vive no service (P1.2, seção 10).
    queryFn: () => getCurrentUser(),
    staleTime: 5 * 60 * 1000
  });

  // Permissão EFETIVA da própria conta (mesma regra do servidor): papel real
  // (`administrador_fazenda`) ou a linha da conta pelo login. Revalida no foco e
  // a cada 30 s; sem linha/falha = nada liberado (antes: tudo, por fallback).
  const loginAtual = currentUser?.login || currentUser?.email || null;
  const { data: permissaoAtual = null } = useQuery({
    queryKey: ['permissao-efetiva', loginAtual, currentUser?.administrador_fazenda === true],
    queryFn: () => carregarPermissaoEfetiva(currentUser),
    enabled: Boolean(loginAtual),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true
  });

  useEffect(() => {
    const revalidar = () => queryClient.invalidateQueries({ queryKey: ['permissao-efetiva'] });
    window.addEventListener(EVENTO_PERMISSOES_ATUALIZADAS, revalidar);
    window.addEventListener('online', revalidar);
    return () => {
      window.removeEventListener(EVENTO_PERMISSOES_ATUALIZADAS, revalidar);
      window.removeEventListener('online', revalidar);
    };
  }, [queryClient]);

  const acessoTotalTelas = ehAdministrador(currentUser) || permissaoAtual?.is_admin === true;

  const mapaGeralPermissions = useMemo(() => {
    if (acessoTotalTelas) return { ...MAPA_GERAL_ACESSO_TOTAL };
    return normalizeMapaGeralPermissions(
      permissaoAtual?.mapa_geral_permissoes,
      canAccessPage(permissaoAtual, 'pec-mapa-geral', 'mapa')
    );
  }, [acessoTotalTelas, permissaoAtual]);

  // D-PROD-137 (BEB-01): o histórico do bebedouro não tem chave própria do
  // mapa; o servidor exige concessões de TELA (GUARDAS.bebedouroHistorico).
  // O diálogo só oferece o que essa mesma regra libera.
  const podeLancarBebedouro = useMemo(
    () => acessoTotalTelas || podeLancarNoBebedouro(permissaoAtual),
    [acessoTotalTelas, permissaoAtual]
  );
  const podeExcluirBebedouro = useMemo(
    () => acessoTotalTelas || podeExcluirLancamentoBebedouro(permissaoAtual),
    [acessoTotalTelas, permissaoAtual]
  );

  const podeUsarTarefasMapa = useMemo(() => {
    if (acessoTotalTelas) return mapaGeralPermissions.visualizar_tarefas;
    return mapaGeralPermissions.visualizar_tarefas && canAccessPage(permissaoAtual, 'gt-lancamentos', 'gestao-tarefas');
  }, [acessoTotalTelas, permissaoAtual, mapaGeralPermissions.visualizar_tarefas]);

  // A chave "Tarefas" dos Filtros segue a MESMA regra do desenho e do botão
  // Tarefas (`podeUsarTarefasMapa`, que também pede a tela Gestão de Tarefas):
  // sem ela a chave não teria efeito e só gravaria preferência (PREF-04).
  const permissoesDoPainelFiltros = useMemo(
    () => ({ ...mapaGeralPermissions, visualizar_tarefas: podeUsarTarefasMapa }),
    [mapaGeralPermissions, podeUsarTarefasMapa]
  );

  // ─── Foco do mapa (D-PROD-218, B2/B3) ───
  // Segmentos por permissão: Lotes sempre; Pastos com "Ver áreas"; Tarefas com
  // a mesma regra do antigo botão Tarefas. Perdeu a permissão do foco atual →
  // volta para Lotes (o desenho já usa o foco em vigor; o efeito acerta o estado).
  const focosDoMapa = useMemo(() => focosPermitidos({
    visualizarAreas: mapaGeralPermissions.visualizar_areas === true,
    usarTarefas: podeUsarTarefasMapa === true,
  }), [mapaGeralPermissions.visualizar_areas, podeUsarTarefasMapa]);
  const focoAtivo = focoEmVigor(foco, focosDoMapa);
  useEffect(() => {
    if (focoAtivo !== foco) setFoco(focoAtivo);
  }, [foco, focoAtivo]);
  // Objeto constante por foco: serve de dependência dos `sync*` sem redesenhar à toa.
  const camadasFoco = camadasDoFoco(focoAtivo);

  // ─── Preferências de camadas/filtros POR USUÁRIO (fazenda + conta + empresa) ───
  // O que o usuário escolheu (pref*) fica salvo; o que aparece no mapa é a
  // preferência E a permissão. Antes, a permissão ainda carregando (= nada
  // liberado) DESLIGAVA Áreas/Detalhes/Lotes e isso era gravado por cima da
  // preferência — todo acesso começava "limpo".
  // Fazenda da sessão: a do usuário (/auth/contexto) ou a do AuthContext. Sem
  // ela não há escopo — nada é lido nem gravado (nunca um tenant "-" comum).
  const { clienteId: clienteIdSessao } = useAuth();
  const clienteFiltros = currentUser?.cliente_id || clienteIdSessao || null;
  const escopoFiltros = useMemo(() => {
    if (!clienteFiltros || !loginAtual || !empresaSelecionadaId) return null;
    return { clienteId: clienteFiltros, login: loginAtual, empresaId: empresaSelecionadaId, chave: `${clienteFiltros}:${loginAtual}:${empresaSelecionadaId}` };
  }, [clienteFiltros, loginAtual, empresaSelecionadaId]);
  const [filtrosCarregados, setFiltrosCarregados] = useState(null);
  // Escopo e permissão no momento em que uma resposta assíncrona chega (GPS):
  // a resposta só vale para o escopo em que foi pedida (D-PROD-137, PREF-07).
  const escopoChaveRef = useRef(/** @type {string|null} */ (null));
  escopoChaveRef.current = escopoFiltros?.chave ?? null;
  const podeLocalizarRef = useRef(false);
  podeLocalizarRef.current = mapaGeralPermissions.visualizar_localizacao === true;

  // Sem "Ver filtros e camadas" não há painel para ver nem desfazer o que foi
  // salvo: o mapa mostra o PADRÃO nesses campos, e a preferência fica guardada,
  // intacta, para quando a permissão voltar (D-PROD-137, PREF-02). Colorir
  // também exige ver as áreas (é o mesmo `podeColorir` do painel Visualização).
  const podeFiltrar = mapaGeralPermissions.visualizar_filtros_camadas === true;
  const podeColorir = podeFiltrar && mapaGeralPermissions.visualizar_areas === true;
  const prefAplicada = preferenciaAplicada({
    showAreas: prefShowAreas, showNomesAreas: prefShowNomesAreas, showHectaresAreas: prefShowHectaresAreas,
    showPontos: prefShowPontos, showLinhas: prefShowLinhas, showLotes: prefShowLotes, showCochos: prefShowCochos,
    showDepositos: prefShowDepositos, showAlertas: prefShowAlertas, showTaskIcons: prefShowTaskIcons,
    showUserLocation: prefShowUserLocation, dragLotesEnabled: prefDragLotesEnabled,
    filtroCategoria: prefFiltroCategoria, filtroIdentificador: prefFiltroIdentificador, filtroStatus: prefFiltroStatus,
    filtroSistema: prefFiltroSistema, filtroAlertaTipo: prefFiltroAlertaTipo, filtroTipoCultura: prefFiltroTipoCultura,
    filtroTipoPastagem: prefFiltroTipoPastagem, filtroSetor: prefFiltroSetor,
    filtroPesoMin: prefFiltroPesoMin, filtroPesoMax: prefFiltroPesoMax, modoColoracao: prefModoColoracao,
  }, { podeFiltrar, podeColorir });
  const {
    showHectaresAreas, showTaskIcons,
    filtroCategoria, filtroIdentificador, filtroStatus, filtroSistema, filtroAlertaTipo,
    filtroTipoCultura, filtroTipoPastagem, filtroSetor, filtroPesoMin, filtroPesoMax, modoColoracao,
  } = prefAplicada;

  const {
    showAreas, showNomesAreas, showPontos, showLinhas, showLotes, showCochos, showDepositos, showAlertas,
    showUserLocation, dragLotesEnabled,
  } = camadasVisiveis(prefAplicada, mapaGeralPermissions);

  useEffect(() => {
    if (!escopoFiltros) return;
    // Estado COMPLETO do escopo novo: o salvo dele ou o padrão (Áreas, Detalhes
    // Áreas e Lotes ligados). Nenhum valor do escopo anterior sobrevive; a
    // marca de carregado vai no MESMO lote de atualizações, então a gravação só
    // roda já com os valores deste escopo.
    const st = normalizarFiltrosMapa(lerFiltrosMapaGeral(escopoFiltros));
    setMapTypeState('satellite');
    setShowAreas(st.showAreas);
    setShowNomesAreas(st.showNomesAreas);
    setShowHectaresAreas(st.showHectaresAreas);
    setShowLotes(st.showLotes);
    setShowPontos(st.showPontos);
    setShowLinhas(st.showLinhas);
    setShowCochos(st.showCochos);
    setShowDepositos(st.showDepositos);
    setShowAlertas(st.showAlertas);
    setShowUserLocation(st.showUserLocation);
    setShowTaskIcons(st.showTaskIcons);
    setDragLotesEnabled(st.dragLotesEnabled);
    setFiltroCategoria(st.filtroCategoria);
    setFiltroIdentificador(st.filtroIdentificador);
    setFiltroStatus(st.filtroStatus);
    setFiltroSistema(st.filtroSistema);
    setFiltroAlertaTipo(st.filtroAlertaTipo);
    setFiltroTipoCultura(st.filtroTipoCultura);
    setFiltroTipoPastagem(st.filtroTipoPastagem);
    setFiltroSetor(st.filtroSetor);
    setFiltroPesoMin(st.filtroPesoMin);
    setFiltroPesoMax(st.filtroPesoMax);
    setModoColoracao(st.modoColoracao);
    setEstiloPasto(st.estiloPasto);
    setFiltrosCarregados(escopoFiltros.chave);
  }, [escopoFiltros]);

  useEffect(() => {
    // Só grava depois de a preferência DESTE usuário nesta empresa ter sido
    // aplicada: antes disso o estado ainda é o padrão e apagaria o que ele salvou.
    if (!escopoFiltros || filtrosCarregados !== escopoFiltros.chave) return;
    // Grava SÓ a preferência (pref*), nunca o valor aplicado: o PADRÃO mostrado
    // por falta de permissão não sobrescreve o que o usuário escolheu.
    salvarFiltrosMapaGeral(escopoFiltros, {
      mapType,
      showAreas: prefShowAreas,
      showPontos: prefShowPontos,
      showLinhas: prefShowLinhas,
      showLotes: prefShowLotes,
      showTaskIcons: prefShowTaskIcons,
      dragLotesEnabled: prefDragLotesEnabled,
      showCochos: prefShowCochos,
      showDepositos: prefShowDepositos,
      showAlertas: prefShowAlertas,
      showUserLocation: prefShowUserLocation,
      showNomesAreas: prefShowNomesAreas,
      showHectaresAreas: prefShowHectaresAreas,
      filtroCategoria: prefFiltroCategoria,
      filtroIdentificador: prefFiltroIdentificador,
      filtroStatus: prefFiltroStatus,
      filtroSistema: prefFiltroSistema,
      filtroAlertaTipo: prefFiltroAlertaTipo,
      filtroTipoCultura: prefFiltroTipoCultura,
      filtroTipoPastagem: prefFiltroTipoPastagem,
      filtroSetor: prefFiltroSetor,
      filtroPesoMin: prefFiltroPesoMin,
      filtroPesoMax: prefFiltroPesoMax,
      modoColoracao: prefModoColoracao,
      estiloPasto,
    });
  }, [escopoFiltros, filtrosCarregados, mapType, prefShowAreas, prefShowPontos, prefShowLinhas, prefShowLotes, prefShowTaskIcons, prefDragLotesEnabled, prefShowCochos, prefShowDepositos, prefShowAlertas, prefShowUserLocation, prefShowNomesAreas, prefShowHectaresAreas, prefFiltroCategoria, prefFiltroIdentificador, prefFiltroStatus, prefFiltroSistema, prefFiltroAlertaTipo, prefFiltroTipoCultura, prefFiltroTipoPastagem, prefFiltroSetor, prefFiltroPesoMin, prefFiltroPesoMax, prefModoColoracao, estiloPasto]);

  // ─── Queries ───
  const ST = 5 * 60 * 1000;
  // Primeira leitura de uma chave depois de um cadastro/exclusão que a afeta:
  // o IndexedDB ainda tem a cópia de antes e o refresh sem force devolveria
  // essa cópia dentro da janela de 60 s, então vai ao servidor com force. Sem
  // nada em memória (o mapa voltou depois do gcTime), mostra antes a cópia
  // local e aplica a resposta quando chegar: em rede lenta o mapa não fica
  // vazio esperando o servidor.
  const lerDepoisDeCadastro = async (cacheKey, cacheEmpresa, queryKey) => {
    if (queryClient.getQueryData(queryKey) === undefined) {
      const local = await getMapaCachedData(cacheKey, cacheEmpresa);
      if (local?.length) {
        refreshMapaCacheEntry(cacheKey, cacheEmpresa, { force: true }).then((fresh) => {
          queryClient.setQueryData(queryKey, fresh || []);
        }).catch(() => {});
        return local;
      }
    }
    return await refreshMapaCacheEntry(cacheKey, cacheEmpresa, { force: true });
  };
  const createMapaQuery = (cacheKey, options = {}) => ({
    queryKey: ['mapa-cache', cacheKey, empresaSelecionadaId, options.enabledKey || 'default'],
    queryFn: async () => {
      // Ícones e permissões são do TENANT: o mapaCacheService troca a empresa
      // pelo tenant da sessão (antes iam para `__GLOBAL__`, sem dono; D-PROD-137).
      const cacheEmpresa = empresaSelecionadaId;
      const queryKey = ['mapa-cache', cacheKey, empresaSelecionadaId, options.enabledKey || 'default'];
      // Cadastro/exclusão que afeta ESTA chave (invalidarCachesDoMapa): vai ao servidor com force.
      if (navigator.onLine && mapaPrecisaBuscarNoServidor(cacheKey)) {
        return await lerDepoisDeCadastro(cacheKey, cacheEmpresa, queryKey);
      }
      const cached = await getMapaCachedData(cacheKey, cacheEmpresa);

      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry(cacheKey, cacheEmpresa).then((fresh) => {
            queryClient.setQueryData(queryKey, fresh || []);
          }).catch(() => {});
          return cached;
        }
        return await refreshMapaCacheEntry(cacheKey, cacheEmpresa);
      }

      return cached || [];
    },
    enabled: Boolean(options.enabled ?? !!empresaSelecionadaId),
    staleTime: options.staleTime ?? ST,
    refetchOnWindowFocus: false,
    placeholderData: []
  });

  const { data: areasBase = [], refetch: refetchAreas } = useQuery(createMapaQuery('areas'));
  const { data: pontos = [], refetch: refetchPontosRef } = useQuery(createMapaQuery('pontos'));
  const { data: bebedouros = [] } = useBebedouros(empresaSelecionadaId);
  const { data: pontosSuplementacao = [], refetch: refetchPontosSupl } = useQuery(createMapaQuery('pontosSuplementacao'));
  const { data: linhas = [], refetch: refetchLinhas } = useQuery(createMapaQuery('linhas'));
  const { data: lotesBase = [], refetch: refetchLotes } = useQuery(createMapaQuery('lotes', { staleTime: 60 * 1000 }));
  const { data: iconesConfig = [] } = useQuery(createMapaQuery('icones', { enabled: true, staleTime: 10 * 60 * 1000 }));
  // D-PROD-191: o ícone do lote vem do código, pela faixa de idade da Categoria de
  // Manejo de cada posição; a lista fica no cache do mapa e o ícone sai offline.
  const { data: categoriasManejo = [], refetch: refetchCategoriasManejo } = useQuery(createMapaQuery('categoriasManejo'));

  useEffect(() => {
    iconesConfig.forEach((icone) => {
      // Ícone de Lote por upload não é mais usado no mapa (D-PROD-191): não baixa.
      if (icone.tipo_entidade === 'Lote') return;
      [icone.icone_url, icone.sub_icone_url].filter(Boolean).forEach((url) => {
        const image = new Image();
        image.src = url;
      });
    });
  }, [iconesConfig]);

  const { data: eventosSupl = [], refetch: refetchEventosSupl } = useQuery(createMapaQuery('eventosSuplementacao'));
  // D-PROD-205: leituras de cocho — o farol do cocho (vermelho/verde/azul/cinza).
  const { data: leiturasCocho = [], refetch: refetchLeiturasCocho } = useQuery(createMapaQuery('leiturasCocho'));
  const { data: estoqueLotes = [], refetch: refetchEstoqueLotes } = useQuery(createMapaQuery('estoqueLotes'));
  const { data: produtos = [] } = useQuery(createMapaQuery('produtos'));
  const { data: tarefasMapa = [], refetch: refetchTarefas } = useQuery(createMapaQuery('tarefas', { enabled: !!empresaSelecionadaId && podeUsarTarefasMapa, enabledKey: podeUsarTarefasMapa ? 'on' : 'off' }));

  const areas = useMemo(() => {
    return areasBase.filter((area) => area?.empresa_id === empresaSelecionadaId && area?.ativo !== false);
  }, [areasBase, empresaSelecionadaId]);

  const areaIdsValidos = useMemo(() => new Set(areas.map((area) => area.id)), [areas]);

  // Área do lote aberto no Detalhes do Lote: vai no cabeçalho do diálogo (D-PROD-144).
  const areaDoDetalhe = useMemo(() => {
    const primeiro = Array.isArray(selectedLote) ? selectedLote[0] : selectedLote;
    return areas.find((a) => a.id === primeiro?.area_atual_id)?.nome || primeiro?.area_atual_nome || "";
  }, [selectedLote, areas]);
  // Detalhes do Lote v12 (D-PROD-218): o setor da área é o subtítulo do diálogo e a célula "Setor".
  const setorDoDetalhe = useMemo(() => {
    const primeiro = Array.isArray(selectedLote) ? selectedLote[0] : selectedLote;
    const area = areas.find((a) => a.id === primeiro?.area_atual_id);
    if (!area) return "";
    return setores.find((setor) => setor.id === area.setor_id)?.nome || area.setor_nome || "";
  }, [selectedLote, areas, setores]);

  // D-PROD-220: subtítulo do detalhe do cocho/depósito = áreas vinculadas · setor
  // (o depósito sem área mostra só o setor), como o "Pasto 07 · Retiro" do v12. A
  // mesma regra vale para o cocho que o depósito empilha (`subtituloDoPonto`).
  const localDoPonto = useCallback((p) => {
    if (!p) return "";
    const ids = Array.isArray(p.area_vinculada_ids) && p.area_vinculada_ids.length ? p.area_vinculada_ids : p.area_vinculada_id ? [p.area_vinculada_id] : [];
    const areasDoPonto = ids.map((id) => areas.find((a) => a.id === id)).filter(Boolean);
    const nomes = areasDoPonto.length ? areasDoPonto.map((a) => a.nome).filter(Boolean) : Array.isArray(p.area_vinculada_nomes) && p.area_vinculada_nomes.length ? p.area_vinculada_nomes.filter(Boolean) : p.area_vinculada_nome ? [p.area_vinculada_nome] : [];
    const setorId = areasDoPonto[0]?.setor_id || p.setor_id || null;
    const setor = (setorId && setores.find((s) => s.id === setorId)?.nome) || areasDoPonto[0]?.setor_nome || p.setor_nome || "";
    return [nomes.join(", "), setor].filter(Boolean).join(" · ");
  }, [areas, setores]);
  const localDoPontoSupl = useMemo(() => localDoPonto(selectedPontoSupl), [localDoPonto, selectedPontoSupl]);
  // D-PROD-220: o Histórico da Área (clique no contorno) tem o setor como subtítulo, como o Detalhes do Lote.
  const setorDaAreaSelecionada = useMemo(() => {
    if (!selectedArea) return "";
    return setores.find((setor) => setor.id === selectedArea.setor_id)?.nome || selectedArea.setor_nome || "";
  }, [selectedArea, setores]);

  const lotes = useMemo(() => {
    return lotesBase.filter((lote) =>
    lote?.empresa_id === empresaSelecionadaId &&
    lote?.status === 'Ativo' &&
    lote?.area_atual_id &&
    areaIdsValidos.has(lote.area_atual_id)
    );
  }, [lotesBase, empresaSelecionadaId, areaIdsValidos]);

  // Movimentações para calcular situação do pasto: cor "Situação do Pasto" e os
  // dias de descanso no rótulo do foco Pastos (D-PROD-218). Chave estável
  // on/off: trocar a cor ou o foco não abre outra entrada de cache.
  const precisaMovimentacoes = modoColoracao === 'situacao_pasto' || camadasFoco.lotacaoNoRotulo;
  const { data: movimentacoes = [], refetch: refetchMovimentacoes } = useQuery(createMapaQuery('movimentacoes', { enabled: !!empresaSelecionadaId && precisaMovimentacoes, enabledKey: precisaMovimentacoes ? 'on' : 'off' }));
  // D-PROD-221: medições de forragem só quando o modo "Forragem" está ligado.
  const { data: medicoesForragem = [], refetch: refetchMedicoesForragem } = useQuery(createMapaQuery('medicoesForragem', { enabled: !!empresaSelecionadaId && modoColoracao === 'forragem', enabledKey: modoColoracao }));
  // D-PROD-223: ocupação e última saída de lote por pasto, para o farol estimado pelos dias de descanso.
  const { data: descansoPastos = [], refetch: refetchDescansoPastos } = useQuery(createMapaQuery('descansoPastos', { enabled: !!empresaSelecionadaId && modoColoracao === 'forragem', enabledKey: modoColoracao }));

  // ─── Dados derivados ───
  const alertasMapa = useMemo(() => buildMapaAlertasSuplementacao({
    lotes,
    pontosSuplementacao,
    eventosSupl,
    estoqueLotes,
    produtos,
    hoje
  }), [lotes, pontosSuplementacao, eventosSupl, estoqueLotes, produtos, hoje]);

  const lotesComAlerta = useMemo(() => lotes.map((lote) => {
    const alertas = [...(alertasMapa.alertasLote.get(lote.id) || [])];
    if (lote.peso_medio_kg && lote.peso_medio_kg < 50 && (lote.categoria?.includes('Bezerr') || lote.categoria?.includes('0 a 12')))
    alertas.push({ tipo: 'peso_baixo', peso: lote.peso_medio_kg });
    return { ...lote, alertas };
  }), [lotes, alertasMapa]);

  const categorias = useMemo(() => [...new Set(lotes.map((l) => l.categoria).filter(Boolean))].sort(), [lotes]);
  const identificadores = useMemo(() => [...new Set(lotes.map((l) => l.identificador_nome || l.identificador_sigla).filter(Boolean))].sort(), [lotes]);
  const tiposPastagem = useMemo(() => [...new Set(areas.map((a) => a.tipo_pastagem).filter(Boolean))].sort(), [areas]);
  const sistemasProdutivos = useMemo(() => [...new Set(lotes.map((l) => l.sistema_produtivo).filter(Boolean))].sort(), [lotes]);

  // Nível de cocho/depósito: SÓ o SSOT (D-PROD-178), no mesmo `hoje` dos
  // alertas. `pontosSuplementacao` já são os ativos (detecção de cochos que
  // atendem os mesmos animais). O marcador lê `indicador_*`; o SVG recebe a
  // fração já quantizada em 1% (sem troca de ícone por variação de float).
  const pontosSuplementacaoDecorados = useMemo(() => {
    return pontosSuplementacao.map((ponto) => {
      const indicadorDeposito = normalizeText(ponto.categoria_ponto || 'COCHO') === 'DEPOSITO' ?
      getDepositoIndicator(ponto, [], [], estoqueLotes, [], produtos) :
      null;
      const indicadorBase = indicadorDeposito || getCochoIndicator(ponto, eventosSupl, { hoje, pontos: pontosSuplementacao });
      const nivel = indicadorBase.nivel;
      // D-PROD-205: só cocho tem farol (depósito não tem leitura).
      const farol = indicadorDeposito ? null : farolDoCocho({ leituras: leiturasCocho, pontoId: ponto.id, hoje });
      const alertaInfo = alertasMapa.alertasPonto.get(ponto.id);
      const alertaPrincipal = alertaInfo?.alertas?.[0] || null;

      return {
        ...ponto,
        indicador_percentual: nivel.fracaoParaSvg,
        indicador_neutro: nivel.neutro === true,
        indicador_titulo: nivel.descricao,
        indicador_alerta_excesso: Number(indicadorDeposito?.nivel.excessoKg) > 0,
        indicador_farol: farol ? { cor: farol.cor, hex: farol.hex, rotulo: farol.rotulo, texto: descreverFarol(farol), avisos: farol.avisos.length } : null,
        nivel_suplementacao: nivel,
        indicador_helper: showAlertas ? alertaPrincipal?.descricao || indicadorBase.helperLabel : indicadorBase.helperLabel,
        ultimo_registro: indicadorBase.latestRecord,
        alertas_inteligentes: showAlertas ? alertaInfo?.alertas || [] : []
      };
    });
  }, [pontosSuplementacao, estoqueLotes, produtos, eventosSupl, leiturasCocho, alertasMapa, showAlertas, hoje]);

  // Filtrar áreas
  const areasFiltradas = useMemo(() => areas.filter((a) => {
    if (!filtroInclui(filtroSetor, a.setor_id)) return false;
    if (!filtroInclui(filtroTipoCultura, a.tipo_cultura)) return false;
    if (!filtroInclui(filtroTipoPastagem, a.tipo_pastagem)) return false;
    return true;
  }), [areas, filtroSetor, filtroTipoCultura, filtroTipoPastagem]);

  const areaIdsFiltrados = useMemo(() => new Set(areasFiltradas.map((area) => area.id)), [areasFiltradas]);
  // Setor, tipo de uso ou tipo de pastagem: o que está numa área escondida some junto.
  const filtroAreaAtivo = filtroDeAreaAtivo({ filtroSetor, filtroTipoCultura, filtroTipoPastagem });

  // Filtrar lotes
  const lotesFiltrados = useMemo(() => filtrarLotesPorArea(lotesComAlerta, { filtroAreaAtivo, areaIdsFiltrados }).filter((lote) => {
    if (!filtroInclui(filtroCategoria, lote.categoria)) return false;
    const identificadorLote = lote.identificador_nome || lote.identificador_sigla || '';
    if (!filtroInclui(filtroIdentificador, identificadorLote)) return false;
    if (showAlertas && !filtroInclui(filtroStatus, lote.alertas.length ? 'com_alerta' : 'sem_alerta')) return false;
    if (showAlertas && !filtroSemRestricao(filtroAlertaTipo) && !lote.alertas.some((alerta) => filtroInclui(filtroAlertaTipo, alerta.tipo))) return false;
    if (!filtroInclui(filtroSistema, lote.sistema_produtivo)) return false;
    if (filtroPesoMin && (!lote.peso_medio_kg || lote.peso_medio_kg < filtroPesoMin)) return false;
    if (filtroPesoMax && lote.peso_medio_kg && lote.peso_medio_kg > filtroPesoMax) return false;
    return true;
  }), [lotesComAlerta, filtroAreaAtivo, areaIdsFiltrados, filtroCategoria, filtroIdentificador, filtroStatus, filtroAlertaTipo, filtroSistema, filtroPesoMin, filtroPesoMax, showAlertas]);

  // Depósito não tem área: com filtro de setor vale o setor dele (antes todos sumiam).
  const pontosSuplementacaoFiltrados = useMemo(() => filtrarPontosSuplementacaoPorArea(pontosSuplementacaoDecorados, {
    filtroSetor, filtroAreaAtivo, areaIdsFiltrados
  }), [filtroSetor, filtroAreaAtivo, pontosSuplementacaoDecorados, areaIdsFiltrados]);

  const cochosFiltrados = useMemo(() => {
    return pontosSuplementacaoFiltrados.filter((ponto) => normalizeText(ponto.categoria_ponto || 'COCHO') !== 'DEPOSITO');
  }, [pontosSuplementacaoFiltrados]);

  const depositosFiltrados = useMemo(() => {
    return pontosSuplementacaoFiltrados.filter((ponto) => normalizeText(ponto.categoria_ponto || '') === 'DEPOSITO');
  }, [pontosSuplementacaoFiltrados]);

  const tarefasMapaFiltradas = useMemo(() => {
    const nomesSetores = filtroSemRestricao(filtroSetor) ?
    new Set() :
    new Set(setores.filter((setor) => filtroInclui(filtroSetor, setor.id)).map((setor) => setor.nome));
    return filtrarTarefasPorArea(tarefasMapa, { filtroSetor, filtroTipoCultura, filtroTipoPastagem, areaIdsFiltrados, nomesSetores });
  }, [filtroSetor, filtroTipoCultura, filtroTipoPastagem, tarefasMapa, setores, areaIdsFiltrados]);

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

  // Situação do pasto: dias desde a chegada do lote NAQUELE pasto (transferência
  // mais recente para a área; sem ela, a entrada) e descanso pela saída mais
  // recente por data operacional.
  const situacaoPastoMap = useMemo(
    () => calcularSituacaoPasto({ areas, lotes, movimentacoes, agora: new Date() }),
    [areas, lotes, movimentacoes]
  );

  // Ocupação pelos lotes que o próprio mapa mostra na área (o `status_ocupacao`
  // gravado na área ficava "Disponível" com lote ativo dentro).
  const ocupacaoPorArea = useMemo(() => statusOcupacaoPorArea(areas, lotes), [areas, lotes]);

  // D-PROD-221: farol de forragem de todos os pastos de uma vez (última medição, 15 dias).
  // D-PROD-223: sem medição válida, a estimativa pelos dias de descanso da cultura.
  const faroisForragem = useMemo(
    () => (modoColoracao === 'forragem' ? farolForragemComEstimativaPorArea(areas, medicoesForragem, descansoPastos, hoje) : {}),
    [modoColoracao, areas, medicoesForragem, descansoPastos, hoje]
  );

  // Função de cor para áreas baseada no modo de coloração
  const getAreaColor = useCallback((area) => {
    if (modoColoracao === 'forragem') return corForragemDaArea(area, faroisForragem);
    if (modoColoracao === 'tipo_cultura') return CORES_TIPO_CULTURA[area.tipo_cultura] || '#94a3b8';
    if (modoColoracao === 'aproveitamento') return CORES_APROVEITAMENTO[area.aproveitamento_classificacao] || '#94a3b8';
    if (modoColoracao === 'ocupacao') return CORES_OCUPACAO[ocupacaoPorArea[area.id]] || '#94a3b8';
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
  }, [modoColoracao, lotes, categoriasGadoCores, tiposPastagemCores, uaPorAreaMap, situacaoPastoMap, ocupacaoPorArea, getAreaEfetiva, faroisForragem]);

  const teardownMapInstance = useCallback(() => {
    renderer.clearAll();
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    disposeMapRef.current?.();
    disposeMapRef.current = null;
    mapInstanceRef.current = null;
    setMapInstance(null);
    setMapReady(false);
    // `useMapRenderer` devolve objeto novo a cada render; só `clearAll` é estável.
  }, [renderer.clearAll]);

  // ─── Inicializar Mapa (MapLibre, uma instância; recriada só por retry) ───
  useEffect(() => {
    let cancelled = false;
    setMapLoadError(null);
    const t = window.setTimeout(() => {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return;
      // Sem WebGL (aceleração gráfica desligada no navegador) o MapLibre falha
      // com um JSON técnico: explica o que fazer em vez de mostrá-lo.
      if (!navegadorTemWebGL()) {
        setMapLoadError(MENSAGEM_WEBGL_DESLIGADO);
        return;
      }
      let created;
      try {
        created = createEditorMap(mapRef.current, { center: CENTRO_PADRAO, zoom: 15 });
      } catch (error) {
        setMapLoadError(mensagemFalhaMapa(error));
        return;
      }
      const map = created.map;
      try {
        map.setMinZoom(3);
        map.setMaxZoom(22);
      } catch { /* best-effort */ }
      mapInstanceRef.current = map;
      const onLoad = () => {
        if (cancelled || created.getCancelled()) return;
        rendererEnsureRef.current?.();
        setMapLoadError(null);
        setMapInstance(map);
        setMapReady(true);
      };
      const onError = (e) => {
        if (cancelled) return;
        const msg = String(e?.error?.message || e?.message || '');
        if (e?.sourceId && String(e.sourceId).startsWith('maike-basemap')) return;
        if (!map.isStyleLoaded?.() && /style|fetch|network|xhr|40\d/i.test(msg)) {
          setMapLoadError('Falha ao carregar o estilo ou os tiles do mapa. Verifique a conexão e tente novamente.');
        }
      };
      map.on('load', onLoad);
      map.on('error', onError);
      disposeMapRef.current = () => {
        try {
          map.off('load', onLoad);
          map.off('error', onError);
        } catch { /* ignore */ }
        created.dispose();
      };
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      teardownMapInstance();
    };
  }, [teardownMapInstance, mapEpoch]);

  const retryMapa = useCallback(() => {
    teardownMapInstance();
    setMapLoadError(null);
    setMapEpoch((n) => n + 1);
  }, [teardownMapInstance]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const persistView = () => {
      // Antes de a vista da empresa ATUAL ser restaurada ou enquadrada, o mapa
      // ainda mostra a anterior (troca de empresa não remonta a página): um
      // moveend nessa janela gravaria a fazenda errada nesta chave (D-PROD-137, PREF-06).
      if (!firstFitDoneRef.current) return;
      const center = map.getCenter();
      if (!center) return;
      try {
        localStorage.setItem(`mapa_geral_view_${empresaSelecionadaId || 'default'}`, JSON.stringify({
          center: { lat: center.lat, lng: center.lng },
          zoom: map.getZoom()
        }));
      } catch { /* armazenamento indisponível */ }
    };
    map.on('moveend', persistView);
    return () => map.off('moveend', persistView);
  }, [mapReady, empresaSelecionadaId]);

  // Fit bounds 1x (ou visão salva da empresa)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !areas.length || firstFitDoneRef.current) return;

    if (!mapViewRestoredRef.current) {
      let saved = null;
      try { saved = lerVisaoSalva(localStorage.getItem(`mapa_geral_view_${empresaSelecionadaId || 'default'}`)); } catch { saved = null; }
      if (saved) {
        // Marca ANTES de mover: jumpTo dispara moveend na hora, e esse moveend
        // já é desta empresa (a vista restaurada continua salva).
        firstFitDoneRef.current = true;
        mapViewRestoredRef.current = true;
        map.jumpTo({ center: [saved.center.lng, saved.center.lat], zoom: saved.zoom });
        return;
      }
    }

    const b = boundsDasAreas(areas);
    if (b) {
      firstFitDoneRef.current = true;
      try { map.fitBounds(b, { padding: 50, duration: 0, maxZoom: 18 }); } catch { /* ignore */ }
    }
  }, [areas, mapReady, empresaSelecionadaId]);

  // ─── Handlers ───
  const detectarAreaPorCoordenada = useCallback((coords) => {
    for (const area of areas) {
      const pontosArea = area.coordenadas?.coords || [];
      if (pontosArea.length < 3) continue;
      if (ptInPoly(coords, parseVertices(pontosArea))) return area;
    }
    return null;
  }, [areas]);

  const abrirLancamentoTarefa = useCallback((coords = null, draft = {}) => {
    if (!podeUsarTarefasMapa) return;
    const areaDetectada = coords ? detectarAreaPorCoordenada(coords) : null;
    const draftCompleto = {
      ...draft,
      area_id: areaDetectada?.id || draft.area_id || "",
      area_nome: areaDetectada?.nome || draft.area_nome || "",
      coordenadas: coords || draft.coordenadas || null
    };
    setTarefasContext({
      areaId: draftCompleto.area_id || undefined,
      areaNome: draftCompleto.area_nome || undefined,
      loteId: draftCompleto.lote_id || undefined,
      loteNome: draftCompleto.lote_nome || undefined,
      initialCoordinates: draftCompleto.coordenadas || null,
      initialDraft: draftCompleto,
      openCreateOnMount: true
    });
    setShowTarefas(true);
  }, [detectarAreaPorCoordenada, podeUsarTarefasMapa]);

  const handleSelectTaskLocation = useCallback((coords, area) => {
    setSelecionandoLocalTarefa(false);
    const draft = rascunhoTarefa || {};
    setRascunhoTarefa(null);
    abrirLancamentoTarefa(coords || draft.coordenadas || null, {
      ...draft,
      area_id: area?.id || "",
      area_nome: area?.nome || ""
    });
  }, [rascunhoTarefa, abrirLancamentoTarefa]);

  const handleClickArea = useCallback((area, coords) => {
    // D-PROD-94a: qualquer área (com ou sem lote) abre detalhes com o Histórico
    // da Área; seleção de local de tarefa e toque longo têm precedência.
    const acao = acaoDoCliqueNaArea({
      area,
      selecionandoLocalTarefa,
      toqueLongoAcabouDeDisparar: longPressTriggeredRef.current,
      permissoes: mapaGeralPermissions,
    });
    if (acao === 'selecionar-local') {
      handleSelectTaskLocation(coords, area);
      return;
    }
    if (acao !== 'abrir-detalhes') return;

    setSelectedArea(area);
    setShowDetalhesArea(true);
  }, [selecionandoLocalTarefa, handleSelectTaskLocation, mapaGeralPermissions]);

  const handleRightClickArea = useCallback((area, coords) => {
    if (selecionandoLocalTarefa) {
      handleSelectTaskLocation(coords, area);
    }
  }, [selecionandoLocalTarefa, handleSelectTaskLocation]);

  const handleClickPontoSupl = useCallback((p) => {
    if (!mapaGeralPermissions.visualizar_detalhes_cochos) return;
    setSelectedPontoSupl(p);
    setShowDetalhesPontoSupl(true);
  }, [mapaGeralPermissions.visualizar_detalhes_cochos]);

  const handleClickPontoReferencia = useCallback(async (ponto) => {
    if (!normalizeText(ponto?.tipo).includes("BEBEDOURO")) return;

    // Online busca a lista atual pelo service; offline reaproveita o que
    // `useBebedouros` já carregou. A UI não fala com o provider.
    const bebedourosEmpresa = navigator.onLine
      ? await listarBebedourosAtivos(empresaSelecionadaId)
      : bebedouros.filter((item) => item.empresa_id === empresaSelecionadaId && item.ativo !== false);
    // Só o vínculo por id: nome/sigla/número por "contém" abria (e lançava no)
    // bebedouro errado ("BEB PASTO 12" contém "2").
    const bebedouro = bebedouroDoPonto(ponto, bebedourosEmpresa);

    setSelectedBebedouro(bebedouro || {
      empresa_id: ponto.empresa_id,
      ponto_referencia_id: ponto.id,
      numero_ponto: ponto.numero_ponto,
      nome: ponto.nome,
      codigo_interno: ponto.sigla || ponto.numero_ponto,
      tipo: ponto.tipo,
      coordenadas: ponto.coordenadas,
      origem_agua: ponto.origem_agua || "-",
      status: ponto.status || "Ativo",
      observacoes: ponto.observacoes || "",
      pasto_nome: ponto.area_vinculada_nome || "",
      area_vinculada_nomes: ponto.area_vinculada_nomes || []
    });
    setShowDetalhesBebedouro(true);
  }, [bebedouros, empresaSelecionadaId]);

  const handleClickLotes = useCallback((l) => {
    if (!mapaGeralPermissions.visualizar_detalhes_lotes) return;
    setSelectedLote(l);
    setShowDetalhesLote(true);
  }, [mapaGeralPermissions.visualizar_detalhes_lotes]);

  const handleClickTarefa = useCallback((t) => {setSelectedTarefa(t);setShowDetalhesTarefa(true);}, []);

  const handleDragLotes = useCallback((newPos, lotesNaArea, areaId, allAreas) => {
    if (!mapaGeralPermissions.mover_lotes) return;
    const orig = allAreas.find((a) => a.id === areaId);
    if (orig) {if (ptInPoly(newPos, parseVertices(orig.coordenadas?.coords))) {toast.error('Arraste para outra área');return;}}
    let dest = null;
    for (const a of allAreas) {if (a.id === areaId || !a.coordenadas?.coords || a.coordenadas.coords.length < 3) continue;if (ptInPoly(newPos, parseVertices(a.coordenadas.coords))) {dest = a;break;}}
    if (dest) {setSelectedLote(lotesNaArea);setShowDetalhesLote(true);queueMicrotask(() => window.dispatchEvent(new CustomEvent('open-movimentacao', { detail: { areaDestinoId: dest.id } })));} else
    toast.error('Solte sobre outra área');
  }, [mapaGeralPermissions.mover_lotes, dragLotesEnabled]);

  const executarRefreshMapa = useCallback(async (showToast = true, force = false, cacheKeys = null) => {
    await queryClient.invalidateQueries({ queryKey: ['mapa-cache'] });

    const refreshOptions = force ? { force: true } : {};
    const keysToRefresh = cacheKeys?.length ? cacheKeys : ['lotes', 'areas', 'eventosSuplementacao', 'leiturasCocho', 'pontosSuplementacao', 'pontos', 'linhas', 'estoqueLotes', 'categoriasManejo'];
    const refreshTasks = keysToRefresh.map((key) => refreshMapaCacheEntry(key, empresaSelecionadaId, refreshOptions));

    if (precisaMovimentacoes && !keysToRefresh.includes('movimentacoes')) refreshTasks.push(refreshMapaCacheEntry('movimentacoes', empresaSelecionadaId, refreshOptions));
    if (modoColoracao === 'forragem' && !keysToRefresh.includes('medicoesForragem')) refreshTasks.push(refreshMapaCacheEntry('medicoesForragem', empresaSelecionadaId, refreshOptions));
    if (modoColoracao === 'forragem' && !keysToRefresh.includes('descansoPastos')) refreshTasks.push(refreshMapaCacheEntry('descansoPastos', empresaSelecionadaId, refreshOptions));
    if (podeUsarTarefasMapa && !keysToRefresh.includes('tarefas') && !cacheKeys?.length) refreshTasks.push(refreshMapaCacheEntry('tarefas', empresaSelecionadaId, refreshOptions));
    await Promise.all(refreshTasks);

    const refetchTasks = [];
    if (keysToRefresh.includes('lotes')) refetchTasks.push(refetchLotes());
    if (keysToRefresh.includes('areas')) refetchTasks.push(refetchAreas());
    if (keysToRefresh.includes('eventosSuplementacao')) refetchTasks.push(refetchEventosSupl());
    if (keysToRefresh.includes('leiturasCocho')) refetchTasks.push(refetchLeiturasCocho());
    if (keysToRefresh.includes('pontosSuplementacao')) refetchTasks.push(refetchPontosSupl());
    if (keysToRefresh.includes('pontos')) refetchTasks.push(refetchPontosRef());
    if (keysToRefresh.includes('linhas')) refetchTasks.push(refetchLinhas());
    if (keysToRefresh.includes('estoqueLotes')) refetchTasks.push(refetchEstoqueLotes());
    // D-PROD-191: a faixa da Categoria de Manejo muda o desenho do lote.
    if (keysToRefresh.includes('categoriasManejo')) refetchTasks.push(refetchCategoriasManejo());
    await Promise.all(refetchTasks);
    if (precisaMovimentacoes) await refetchMovimentacoes();
    if (modoColoracao === 'forragem') await Promise.all([refetchMedicoesForragem(), refetchDescansoPastos()]);
    if (podeUsarTarefasMapa && (!cacheKeys?.length || keysToRefresh.includes('tarefas'))) await refetchTarefas();
    if (showToast) toast.success('Mapa atualizado');
  }, [empresaSelecionadaId, modoColoracao, precisaMovimentacoes, podeUsarTarefasMapa, queryClient, refetchAreas, refetchCategoriasManejo, refetchEstoqueLotes, refetchEventosSupl, refetchLeiturasCocho, refetchLinhas, refetchLotes, refetchDescansoPastos, refetchMedicoesForragem, refetchMovimentacoes, refetchPontosRef, refetchPontosSupl, refetchTarefas]);

  const handleRefresh = useCallback(async () => {
    await executarRefreshMapa(true, true);
  }, [executarRefreshMapa]);

  // Permissão e escopo lidos por ref na hora do toque E na hora da resposta: o
  // GPS responde segundos depois, e nesse meio a empresa pode ter mudado ou a
  // permissão ter caído (D-PROD-137, PREF-04/PREF-07).
  const handleLocate = useCallback(() => {
    if (!podeLocalizarRef.current || !navigator.geolocation) return;
    const escopoDoPedido = escopoChaveRef.current;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        // Posição do aparelho não pertence a escopo nenhum.
        setUserLocation(loc);
        // Ligar a camada (preferência gravada) e pular o mapa só no escopo do
        // pedido. Pedido sem escopo (sessão/empresa ainda carregando) não tem
        // preferência de ninguém para vazar: vale para o escopo que entrou.
        const outroEscopo = escopoDoPedido !== null && escopoDoPedido !== escopoChaveRef.current;
        if (outroEscopo || !podeLocalizarRef.current) return;
        setShowUserLocation(true);
        if (mapInstanceRef.current) mapInstanceRef.current.jumpTo({ center: [loc.lng, loc.lat], zoom: 18 });
      },
      () => toast.error('Erro ao obter localização')
    );
  }, []);

  const handleRequestSelectTaskLocation = useCallback((draft) => {
    if (!podeUsarTarefasMapa) return;
    setShowTarefas(false);
    setShowDetalhesTarefa(false);
    setSelecionandoLocalTarefa(true);
    setRascunhoTarefa(draft);
    toast.info('Toque no mapa para marcar o local da tarefa.');
  }, [podeUsarTarefasMapa]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !mapRef.current) return;
    const map = mapInstanceRef.current;
    const mapElement = mapRef.current;

    const clearLongPress = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const getPointFromEvent = (event) => {
      if (event?.touches?.[0]) {
        return { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }
      if (event?.changedTouches?.[0]) {
        return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
      }
      if (typeof event?.clientX === 'number' && typeof event?.clientY === 'number') {
        return { x: event.clientX, y: event.clientY };
      }
      return null;
    };

    const getCoordsFromPoint = (point) => {
      if (!point) return null;
      const rect = mapElement.getBoundingClientRect();
      const ll = map.unproject([point.x - rect.left, point.y - rect.top]);
      return ll ? { lat: ll.lat, lng: ll.lng } : null;
    };

    const handlePressStart = (event) => {
      if (!podeUsarTarefasMapa || selecionandoLocalTarefa) return;
      const point = getPointFromEvent(event);
      if (!point) return;
      longPressStartRef.current = point;
      longPressTriggeredRef.current = false;
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        const coords = getCoordsFromPoint(point);
        if (!coords) return;
        longPressTriggeredRef.current = true;
        ignoreNextMapClickRef.current = true;
        abrirLancamentoTarefa(coords);
      }, 550);
    };

    const handlePressMove = (event) => {
      if (!longPressStartRef.current) return;
      const point = getPointFromEvent(event);
      if (!point) return;
      const moved = Math.abs(point.x - longPressStartRef.current.x) > 10 || Math.abs(point.y - longPressStartRef.current.y) > 10;
      if (moved) clearLongPress();
    };

    const handlePressEnd = () => {
      clearLongPress();
      longPressStartRef.current = null;
      if (longPressTriggeredRef.current) {
        window.setTimeout(() => {
          ignoreNextMapClickRef.current = false;
        }, 350);
      }
    };

    mapElement.addEventListener('mousedown', handlePressStart);
    mapElement.addEventListener('mousemove', handlePressMove);
    mapElement.addEventListener('mouseup', handlePressEnd);
    mapElement.addEventListener('mouseleave', handlePressEnd);
    mapElement.addEventListener('touchstart', handlePressStart, { passive: true });
    mapElement.addEventListener('touchmove', handlePressMove, { passive: true });
    mapElement.addEventListener('touchend', handlePressEnd);
    mapElement.addEventListener('touchcancel', handlePressEnd);

    // Pan/zoom (arraste, pinça) cancela o long-press: nada é criado por navegação.
    const onMoveStart = () => clearLongPress();
    // Clique/menu sobre área é tratado pelo renderer (área) — aqui só o resto do mapa.
    const onContextMenu = (event) => {
      if (!podeUsarTarefasMapa || selecionandoLocalTarefa || !event?.lngLat) return;
      if (rendererHitRef.current?.(event.point)) return;
      abrirLancamentoTarefa({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    };
    const onMapClick = (event) => {
      clearLongPress();
      if (ignoreNextMapClickRef.current) {
        ignoreNextMapClickRef.current = false;
        return;
      }
      if (!selecionandoLocalTarefa || !event?.lngLat) return;
      if (rendererHitRef.current?.(event.point)) return;
      const coords = { lat: event.lngLat.lat, lng: event.lngLat.lng };
      handleSelectTaskLocation(coords, detectarAreaPorCoordenada(coords));
    };
    map.on('movestart', onMoveStart);
    map.on('contextmenu', onContextMenu);
    map.on('click', onMapClick);
    const listeners = [
      { remove: () => map.off('movestart', onMoveStart) },
      { remove: () => map.off('contextmenu', onContextMenu) },
      { remove: () => map.off('click', onMapClick) },
    ];


    return () => {
      handlePressEnd();
      mapElement.removeEventListener('mousedown', handlePressStart);
      mapElement.removeEventListener('mousemove', handlePressMove);
      mapElement.removeEventListener('mouseup', handlePressEnd);
      mapElement.removeEventListener('mouseleave', handlePressEnd);
      mapElement.removeEventListener('touchstart', handlePressStart);
      mapElement.removeEventListener('touchmove', handlePressMove);
      mapElement.removeEventListener('touchend', handlePressEnd);
      mapElement.removeEventListener('touchcancel', handlePressEnd);
      listeners.forEach((listener) => listener?.remove());
    };
  }, [mapReady, selecionandoLocalTarefa, abrirLancamentoTarefa, handleSelectTaskLocation, detectarAreaPorCoordenada, podeUsarTarefasMapa]);

  // ─── Renderização incremental ───
  useEffect(() => {if (mapReady) renderer.syncAreas(areasFiltradas, mapaGeralPermissions.visualizar_areas && showAreas, handleClickArea, handleRightClickArea, getAreaColor);}, [areasFiltradas, showAreas, mapReady, getAreaColor, handleClickArea, handleRightClickArea, mapaGeralPermissions.visualizar_areas]);
  // Função de texto extra para labels (UA/ha ou situação do pasto). No foco
  // Pastos (D-PROD-218) vale sempre a lotação, mesmo com "Situação do Pasto";
  // área sem gado mostra só os dias de descanso, quando está em descanso.
  const getLabelExtraText = useCallback((area) => {
    if (modoColoracao === 'ua_ha' || camadasFoco.lotacaoNoRotulo) {
      const info = uaPorAreaMap[area.id];
      if (!info || info.ua === 0) {
        const situacao = camadasFoco.lotacaoNoRotulo ? situacaoPastoMap[area.id] : null;
        return situacao?.tipo === 'descanso' ? `Descanso ${situacao.dias}d` : null;
      }
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
  }, [modoColoracao, camadasFoco, uaPorAreaMap, situacaoPastoMap, getAreaEfetiva]);

  useEffect(() => {
    if (!mapReady) return;
    renderer.syncLabels(
      areasFiltradas,
      mapaGeralPermissions.visualizar_areas && mapaGeralPermissions.visualizar_nomes_areas && showNomesAreas && showAreas,
      modoColoracao === 'ua_ha' || modoColoracao === 'situacao_pasto' || camadasFoco.lotacaoNoRotulo ? getLabelExtraText : null,
      showHectaresAreas
    );
  }, [areasFiltradas, showNomesAreas, showAreas, showHectaresAreas, mapReady, modoColoracao, camadasFoco, getLabelExtraText, mapaGeralPermissions.visualizar_areas, mapaGeralPermissions.visualizar_nomes_areas]);
  // Filtrar pontos de referência: ocultar tipo "Cocho" quando cochos/suplementação estão ocultos
  const pontosFiltrados = useMemo(() => {
    return pontos.filter((p) => {
      const tipo = (p.tipo || '').toUpperCase().trim();
      return tipo !== 'COCHO' && tipo !== 'COCHOS' && tipo !== 'DEPOSITO' && tipo !== 'DEPÓSITO';
    });
  }, [pontos]);

  useEffect(() => {if (mapReady) renderer.syncPontos(pontosFiltrados, mapaGeralPermissions.visualizar_pontos_referencia && showPontos, iconesConfig, handleClickPontoReferencia);}, [pontosFiltrados, showPontos, iconesConfig, mapReady, mapaGeralPermissions.visualizar_pontos_referencia, handleClickPontoReferencia]);
  useEffect(() => {if (mapReady) renderer.syncLinhas(linhas, mapaGeralPermissions.visualizar_linhas && showLinhas);}, [linhas, showLinhas, mapReady, mapaGeralPermissions.visualizar_linhas]);
  useEffect(() => {
    if (!mapReady) return;
    const pontosVisiveis = [
    ...(showCochos ? cochosFiltrados : []),
    ...(showDepositos ? depositosFiltrados : [])];

    // Foco Tarefas (D-PROD-218): sem cochos e depósitos.
    renderer.syncPontosSuplementacao(pontosVisiveis, mapaGeralPermissions.visualizar_cochos_suplementacao && (showCochos || showDepositos) && camadasFoco.suplementacao, iconesConfig, handleClickPontoSupl);
  }, [cochosFiltrados, depositosFiltrados, showCochos, showDepositos, iconesConfig, mapReady, mapaGeralPermissions.visualizar_cochos_suplementacao, camadasFoco, handleClickPontoSupl]);
  // Lotes só no foco Lotes; tarefas em Lotes e Tarefas (D-PROD-218).
  useEffect(() => {if (mapReady) renderer.syncLotes(lotesFiltrados, areas, mapaGeralPermissions.visualizar_lotes && showLotes && camadasFoco.lotes, categoriasManejo, handleClickLotes, handleDragLotes, mapaGeralPermissions.mover_lotes && dragLotesEnabled, showAlertas && !filtroInclui(filtroStatus, 'sem_alerta'));}, [lotesFiltrados, areas, showLotes, camadasFoco, categoriasManejo, mapReady, mapaGeralPermissions.visualizar_lotes, mapaGeralPermissions.mover_lotes, dragLotesEnabled, showAlertas, filtroStatus, handleClickLotes, handleDragLotes]);
  useEffect(() => {if (mapReady) renderer.syncTarefas(podeUsarTarefasMapa && showTaskIcons && camadasFoco.tarefas ? tarefasMapaFiltradas : [], areas, iconesConfig, handleClickTarefa);}, [tarefasMapaFiltradas, areas, iconesConfig, mapReady, podeUsarTarefasMapa, showTaskIcons, camadasFoco, handleClickTarefa]);
  useEffect(() => {if (mapReady) renderer.syncUserLocation(userLocation, mapaGeralPermissions.visualizar_localizacao && showUserLocation);}, [userLocation, showUserLocation, mapReady, mapaGeralPermissions.visualizar_localizacao]);

  useEffect(() => {
    const h = async (event) => {
      await executarRefreshMapa(false, true, event?.detail?.cacheKeys || null);
    };
    window.addEventListener('atualizar-mapa', h);
    return () => window.removeEventListener('atualizar-mapa', h);
  }, [executarRefreshMapa]);

  useEffect(() => {
    if (!empresaSelecionadaId) return;
    const hasAreasCache = !!queryClient.getQueryData(['mapa-cache', 'areas', empresaSelecionadaId, 'default']);
    const hasLotesCache = !!queryClient.getQueryData(['mapa-cache', 'lotes', empresaSelecionadaId, 'default']);
    if (!hasAreasCache && !hasLotesCache) {
      executarRefreshMapa(false);
    }
  }, [empresaSelecionadaId, executarRefreshMapa, queryClient]);

  useEffect(() => {
    if (!mapaGeralPermissions.visualizar_filtros_camadas) setShowFiltros(false);
    if (!mapaGeralPermissions.visualizar_insights) setShowInsights(false);
  }, [mapaGeralPermissions]);

  useEffect(() => {
    if (podeUsarTarefasMapa) return;
    setShowTarefas(false);
    setShowDetalhesTarefa(false);
    setSelecionandoLocalTarefa(false);
    setRascunhoTarefa(null);
    setTarefasContext({});
  }, [podeUsarTarefasMapa]);

  // ─── Render ───
  const totalCabecas = lotesFiltrados.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
  const pesoTotalFiltrado = lotesFiltrados.reduce((s, l) => s + (Number(l.peso_medio_kg) || 0) * (Number(l.quantidade_cabecas) || 0), 0);
  const pesoMedioGeral = totalCabecas > 0 && pesoTotalFiltrado > 0 ? Math.round(pesoTotalFiltrado / totalCabecas) : 0;
  const areasOcupadas = new Set(lotesFiltrados.map((l) => l.area_atual_id).filter(Boolean)).size;
  const totalAlertas = lotesFiltrados.filter((l) => l.alertas.length > 0).length;

  return (
    <div className="mk-mapa relative h-full min-h-0 w-full overflow-hidden bg-white" translate="no">
      <div className="w-full h-full relative">
        {/* `isolation: isolate` confina o z-index dos marcadores (até 10000) ao
            mapa: sem isso eles atravessavam janelas e pop-ups abertos por cima. */}
        <div ref={mapRef} data-testid="mapa-geral-maplibre" style={{ height: '100%', width: '100%', backgroundColor: 'var(--mk-sup-fundo)', touchAction: 'none', isolation: 'isolate' }} />

        <BasemapAtribuicao atribuicao={basemap.atribuicao} status={basemap.status} mensagem={basemap.mensagem} onRetry={basemap.retry} />

        {/* Controles Mobile */}
        <MapaControlesMobile
          mapType={mapTypeEfetivo} setMapType={setMapType}
          onRefresh={handleRefresh} onLocate={handleLocate}
          /* Mover e Localizar só com a permissão que os faz funcionar: sem ela o
             toque só mudaria uma preferência gravada que o usuário não vê (PREF-04). */
          showLocalizarButton={mapaGeralPermissions.visualizar_localizacao}
          showMoverButton={mapaGeralPermissions.mover_lotes}
          dragEnabled={dragLotesEnabled}
          onToggleDrag={() => {if (!mapaGeralPermissions.mover_lotes) return;setDragLotesEnabled((prev) => !prev);}}
          /* D-PROD-218: barra do topo ⚙ · Lotes · Pastos · Tarefas no lugar dos
             botões Tarefas e Filtros; o ⚙ abre o mesmo painel Filtro de hoje. */
          foco={focoAtivo}
          onFoco={setFoco}
          focosPermitidos={focosDoMapa}
          showFiltrosButton={mapaGeralPermissions.visualizar_filtros_camadas}
          onOpenTarefas={() => {if (!podeUsarTarefasMapa) return;setTarefasContext({});setShowTarefas(true);}}
          onOpenFiltros={() => {if (!mapaGeralPermissions.visualizar_filtros_camadas) return;setShowFiltros(true);}}
          painel={
          <MapaVisualizacao
            mapType={mapTypeEfetivo} setMapType={setMapType}
            estiloPasto={estiloPasto} setEstiloPasto={setEstiloPasto}
            modoColoracao={modoColoracao} setModoColoracao={setModoColoracao}
            podeColorir={podeColorir} />
          } />


        {/* Legenda */}
        <MapaLegenda
          modoColoracao={modoColoracao}
          categoriasGadoCores={categoriasGadoCores}
          tiposPastagemCores={tiposPastagemCores} />


        {/* Resumo inferior (D-PROD-131): cartão único, números grandes e rótulos discretos */}
        {/* D-PROD-213: com permissão de ver lotes, o cartão abre o Resumo do Rebanho. */}
        <div className="mk-mapa-resumo mk-mapa-card" aria-label="Resumo do mapa"
          {...(mapaGeralPermissions.visualizar_lotes ? {
            role: 'button', tabIndex: 0, title: 'Abrir o Resumo do Rebanho', 'data-mk-resumo-rebanho': '',
            onClick: () => setShowResumoRebanho(true),
            onKeyDown: (/** @type {React.KeyboardEvent} */ e) => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault();setShowResumoRebanho(true);}}
          } : {})}>
          <div className="mk-mapa-resumo__item">
            <span className="mk-mapa-resumo__num mk-mapa-resumo__num--verde">{totalCabecas}</span>
            <span className="mk-mapa-resumo__rot">Animais</span>
          </div>
          {pesoMedioGeral > 0 &&
          <div className="mk-mapa-resumo__item">
              <span className="mk-mapa-resumo__num">{pesoMedioGeral}<small> kg</small></span>
              <span className="mk-mapa-resumo__rot">Peso méd.</span>
            </div>
          }
          <div className="mk-mapa-resumo__item">
            <span className="mk-mapa-resumo__num">{areasFiltradas.length}</span>
            <span className="mk-mapa-resumo__rot">Áreas</span>
          </div>
          {mapaGeralPermissions.visualizar_lotes &&
          <span className="mk-mapa-resumo__abrir" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
            </span>
          }
        </div>

        {!mapReady && mapLoadError &&
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 max-w-md bg-white px-6 py-4 rounded-lg shadow-2xl border border-amber-300">
            <div className="font-semibold text-slate-800 text-sm mb-1">Mapa indisponível</div>
            <p className="text-xs text-slate-600">{mapLoadError}</p>
            <Button data-mk-map-action="" type="button" size="sm" className="mt-2 h-8 bg-emerald-600 hover:bg-emerald-700" onClick={retryMapa}>Tentar novamente</Button>
          </div>
        }

        {!mapReady && !mapLoadError &&
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full" />
              <span className="font-semibold text-slate-700 text-sm">Carregando mapa salvo...</span>
            </div>
          </div>
        }
      </div>

      {/* ─── Sheet Filtros Avançados ─── */}
      <MapaFiltrosPainel open={showFiltros} onOpenChange={setShowFiltros}>
            <MapaFiltrosAvancados
              showAreas={showAreas} setShowAreas={setShowAreas}
              showPontos={showPontos} setShowPontos={setShowPontos}
              showLinhas={showLinhas} setShowLinhas={setShowLinhas}
              showLotes={showLotes} setShowLotes={setShowLotes}
              showTarefas={showTaskIcons} setShowTarefas={setShowTaskIcons}
              showCochos={showCochos} setShowCochos={setShowCochos}
              showDepositos={showDepositos} setShowDepositos={setShowDepositos}
              showHectaresAreas={showHectaresAreas} setShowHectaresAreas={setShowHectaresAreas}
              showAlertas={showAlertas} setShowAlertas={setShowAlertas}
              showUserLocation={showUserLocation} setShowUserLocation={setShowUserLocation}
              showNomesAreas={showNomesAreas} setShowNomesAreas={setShowNomesAreas}
              filtroCategoria={filtroCategoria} setFiltroCategoria={setFiltroCategoria}
              filtroIdentificador={filtroIdentificador} setFiltroIdentificador={setFiltroIdentificador}
              filtroStatus={filtroStatus} setFiltroStatus={setFiltroStatus}
              filtroSistema={filtroSistema} setFiltroSistema={setFiltroSistema}
              filtroAlertaTipo={filtroAlertaTipo} setFiltroAlertaTipo={setFiltroAlertaTipo}
              filtroSetor={filtroSetor} setFiltroSetor={setFiltroSetor}
              filtroTipoCultura={filtroTipoCultura} setFiltroTipoCultura={setFiltroTipoCultura}
              filtroTipoPastagem={filtroTipoPastagem} setFiltroTipoPastagem={setFiltroTipoPastagem}
              filtroPesoMin={filtroPesoMin} setFiltroPesoMin={setFiltroPesoMin}
              filtroPesoMax={filtroPesoMax} setFiltroPesoMax={setFiltroPesoMax}
              modoColoracao={modoColoracao} setModoColoracao={setModoColoracao}
              categorias={categorias}
              identificadores={identificadores}
              tiposPastagem={tiposPastagem}
              setores={setores}
              sistemasProdutivos={sistemasProdutivos}
              permissions={permissoesDoPainelFiltros}
              mostrarCores={false} />

      </MapaFiltrosPainel>

      {/* ─── Dialogs ─── */}
      <LancLoteDialogo open={showDetalhesLote} onOpenChange={(open) => {setShowDetalhesLote(open);if (!open) refetchLotes();}} titulo={areaDoDetalhe || "Detalhes do Lote"} lotes={setorDoDetalhe ? [{ nome: setorDoDetalhe }] : undefined} largo somenteLeitura popupDesde="tablet">
          {selectedLote && <DetalhesLote lotes={Array.isArray(selectedLote) ? selectedLote : [selectedLote]} permissions={mapaGeralPermissions} setorNome={setorDoDetalhe} suplementacao={{ pontos: pontosSuplementacaoDecorados, eventos: eventosSupl, hoje }} onAbrirCocho={handleClickPontoSupl} onClose={() => {setShowDetalhesLote(false);refetchLotes();}} />}
      </LancLoteDialogo>

      <LancLoteDialogo open={showResumoRebanho && mapaGeralPermissions.visualizar_lotes} onOpenChange={setShowResumoRebanho} titulo="Resumo do Rebanho" lotes={hoje ? [{ nome: `Posição em ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}` }] : undefined} largo somenteLeitura>
          <PainelResumoRebanho posicoes={lotes} areas={areas} categoriasManejo={categoriasManejo} hoje={hoje} />
      </LancLoteDialogo>

      <LancLoteDialogo open={showDetalhesArea} onOpenChange={setShowDetalhesArea} titulo={mapaGeralPermissions.medir_forragem === true && selectedArea?.tipo_cultura !== "Infraestrutura" ? "Pasto" : "Histórico da Área"} lotes={mapaGeralPermissions.medir_forragem === true && selectedArea?.nome ? [{ nome: selectedArea.nome }] : undefined} largo somenteLeitura popupDesde="tablet">

          {selectedArea && <DetalhesArea area={selectedArea} permissions={mapaGeralPermissions} setorNome={setorDaAreaSelecionada} eventosSuplementacao={eventosSupl} areas={areas} />}
        </LancLoteDialogo>

      <LancLoteDialogo open={showDetalhesBebedouro} onOpenChange={setShowDetalhesBebedouro} titulo="Bebedouro" largo somenteLeitura popupDesde="tablet">

          {selectedBebedouro && <DetalhesBebedouro bebedouro={selectedBebedouro} podeLancar={podeLancarBebedouro} podeExcluir={podeExcluirBebedouro} />}
        </LancLoteDialogo>

      <LancLoteDialogo open={showDetalhesPontoSupl} onOpenChange={(open) => {setShowDetalhesPontoSupl(open);if (!open) {refetchEventosSupl();refetchLotes();refetchPontosSupl();}}} titulo={selectedPontoSupl?.categoria_ponto === 'DEPOSITO' ? 'Depósito de Suplementação' : 'Ponto de Suplementação'} largo somenteLeitura popupDesde="tablet">

          {selectedPontoSupl && <DetalhesPontoSuplementacao ponto={selectedPontoSupl} permissions={mapaGeralPermissions} subtitulo={localDoPontoSupl} subtituloDoPonto={localDoPonto} onClose={() => {setShowDetalhesPontoSupl(false);refetchEventosSupl();refetchLotes();refetchPontosSupl();}} />}
        </LancLoteDialogo>

      <LancLoteDialogo open={showTarefas} onOpenChange={(open) => {setShowTarefas(open);if (!open && podeUsarTarefasMapa) refetchTarefas();}} titulo="Gestão de Tarefas" lotes={localDasTarefas ? [{ nome: localDasTarefas }] : []} amplo somenteLeitura>
          <TarefasMapaPanel areaId={tarefasContext.areaId} areaNome={tarefasContext.areaNome} loteId={tarefasContext.loteId} loteNome={tarefasContext.loteNome} pontoSuplId={tarefasContext.pontoSuplId} initialCoordinates={tarefasContext.initialCoordinates} initialDraft={tarefasContext.initialDraft} openCreateOnMount={tarefasContext.openCreateOnMount} onRequestSelectLocation={handleRequestSelectTaskLocation} onClose={() => {setShowTarefas(false);setTarefasContext({});if (podeUsarTarefasMapa) refetchTarefas();}} />
      </LancLoteDialogo>

      <LancLoteDialogo open={showDetalhesTarefa} onOpenChange={(open) => {setShowDetalhesTarefa(open);if (!open && podeUsarTarefasMapa) refetchTarefas();}} titulo="Detalhes da tarefa" largo somenteLeitura popupDesde="tablet">
          {selectedTarefa && <DetalhesTarefaMapa tarefa={selectedTarefa} hoje={hoje} onRequestSelectLocation={handleRequestSelectTaskLocation} onSaved={(updated) => {if (updated) setSelectedTarefa(updated);if (podeUsarTarefasMapa) refetchTarefas();}} />}
      </LancLoteDialogo>

      <LancLoteDialogo open={showInsights} onOpenChange={setShowInsights} titulo="Insights do Mapa" largo somenteLeitura>

          <MapaInsights lotes={lotesFiltrados} areas={areasFiltradas} eventosSupl={eventosSupl} pontosSuplementacao={pontosSuplementacaoDecorados} pontosReferencia={pontos} />
        </LancLoteDialogo>
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
