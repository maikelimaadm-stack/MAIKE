import { getApiErrorMessage } from "@/apis/_core/ApiError";
import React from "react";
import {
  Card as CardUi,
  CardContent as CardContentUi,
  CardHeader as CardHeaderUi,
  CardTitle as CardTitleUi,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  listarHistoricoMovimentacoesPagina,
  listarTodasMovimentacoes,
  listarLotesDaEmpresa,
  atualizarLote,
  excluirMovimentacao,
} from "@/services/loteManejoService";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  normalizeText,
  getLinkedMovementIds,
  getJuncaoLotesSnapshot,
  getMudancaCategoriaSnapshot,
  getPesoAnteriorFromObs,
  getCategoriaAnteriorFromObs,
  getSexoAnteriorFromObs,
} from "../utils/pecuariaUtils";
import { validarSemRegistrosPosteriores } from "./manejoValidations.jsx";
import { reverseMovementOnDelete } from "./movimentacaoReconciliation";
import { getMapaCachedData, getMapaCacheSnapshot, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { nomeDaAreaDoMovimento } from "@/domain/lotes/movimentacaoLote";
import {
  ESCOPO_AREA,
  ESCOPO_LOTES,
  entradasNaArea,
  filtrarMovimentacoes,
  filtrarRegistrosDeLote,
  fluxoNaArea,
  ordenarItensDoHistorico,
} from "@/domain/lotes/historicoMovimentacoes";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

// `ui/card` é forwardRef sem tipos de props: o checkJs não enxerga `children`.
/** @type {React.ComponentType<any>} */ const Card = CardUi;
/** @type {React.ComponentType<any>} */ const CardContent = CardContentUi;
/** @type {React.ComponentType<any>} */ const CardHeader = CardHeaderUi;
/** @type {React.ComponentType<any>} */ const CardTitle = CardTitleUi;

const CORES_TIPO = {
  "Transferência de Área": "bg-slate-100 text-slate-800 border-slate-300",
  "Morte": "bg-slate-100 text-slate-800 border-slate-300",
  "Nascimento": "bg-slate-100 text-slate-800 border-slate-300",
  "Abate": "bg-slate-100 text-slate-800 border-slate-300",
  "Mudança de Categoria": "bg-slate-100 text-slate-800 border-slate-300",
  "Pesagem": "bg-slate-100 text-slate-800 border-slate-300",
  "Renomear Lote": "bg-slate-100 text-slate-800 border-slate-300",
  "Junção de Lotes": "bg-slate-100 text-slate-800 border-slate-300",
  "Nutrição": "bg-slate-100 text-slate-800 border-slate-300",
  "Medicamento": "bg-slate-100 text-slate-800 border-slate-300",
  "Sanidade": "bg-slate-100 text-slate-800 border-slate-300",
  "Vacinação": "bg-slate-100 text-slate-800 border-slate-300",
  "Vermifugação": "bg-slate-100 text-slate-800 border-slate-300",
  "Tratamento": "bg-slate-100 text-slate-800 border-slate-300",
  "Inseminação": "bg-slate-100 text-slate-800 border-slate-300",
  "Exame": "bg-slate-100 text-slate-800 border-slate-300",
};

const TIPOS_EDITAVEIS = new Set([
  "Transferência de Área",
  "Morte",
  "Nascimento",
  "Abate",
  "Mudança de Categoria",
  "Pesagem",
]);

const getTime = (value) => new Date(value).getTime() || 0;
const normalize = (value) => normalizeText(value);
const parseCategoriaNovaFromObs = (observacoes) => {
  const match = String(observacoes || '').match(/De\s+.+?\s+para\s+(.+?)\.\s*Sexo:/i);
  return match ? match[1].trim() : null;
};
const parseCategoriaTransferenciaFromObs = (observacoes) => {
  const match = String(observacoes || '').match(/Movimentação parcial\s*-\s*\d+\s*cabeças\s+de\s+(.+)$/i);
  return match ? match[1].trim() : null;
};
const formatDateOnly = (value) => {
  const raw = String(value || '');
  if (!raw) return '-';
  const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return new Date(value).toLocaleDateString('pt-BR');
  return `${day}/${month}/${year}`;
};

const formatHistoricoObservacoes = (item) => {
  const observacoes = item?.observacoes || '';
  const motivo = item?.raw?.motivo || item?.tipo_exibicao || '';

  if (motivo === 'Junção de Lotes') {
    const snapshot = getJuncaoLotesSnapshot(observacoes);
    if (snapshot?.length) {
      const origens = snapshot.map((lote) => `${lote.nome}(${Number(lote.quantidade_cabecas || 0).toLocaleString('pt-BR')})`).join(' + ');
      const total = snapshot.reduce((sum, lote) => sum + Number(lote.quantidade_cabecas || 0), 0);
      return `[JUNCAO_LOTES] ${origens} => ${item.lote}(${total.toLocaleString('pt-BR')})`;
    }
  }

  return observacoes.replace(/\b\d+\.\d+\b/g, (match) => {
    const number = Number(match);
    return Number.isNaN(number)
      ? match
      : number.toLocaleString('pt-BR', { minimumFractionDigits: match.split('.')[1]?.length || 0, maximumFractionDigits: match.split('.')[1]?.length || 0 });
  });
};

/**
 * Exclusão de lançamento pelo histórico — SUSPENSA (D-PROD-94).
 *
 * O histórico ficou vazio desde a P5.5 (o `empresa_id` não voltava na leitura),
 * então ninguém excluía por aqui. Restaurar a leitura reabriria uma exclusão
 * que reverte saldo no navegador, em várias chamadas, sem transação nem
 * idempotência. Isso é escopo da R2 (estorno seguro no servidor). Até lá a
 * leitura volta e a exclusão não. Para reabrir: `true` aqui, com aprovação.
 */
const EXCLUSAO_NO_HISTORICO_HABILITADA = false;

/** Página do servidor; "Carregar mais" busca a próxima. */
const TAMANHO_PAGINA = 100;

/** Teto do cache do mapa para movimentações (`listMovimentacoes`). */
const LIMITE_CACHE_MOVIMENTACOES = 500;

const estaOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

const formatDateTime = (iso) => {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const movimentoComoItem = (mov, areasRaw) => ({
  uniqueId: `mov-${mov.id}`,
  source: 'movimentacao',
  sourceLabel: 'Movimentação',
  id: mov.id,
  lote: mov.lote,
  lote_key: mov.lote_id || normalize(mov.lote),
  legado: !mov.lote_id,
  data_evento: mov.data_movimentacao,
  created_at: mov.created_date || mov.data_movimentacao,
  tipo: mov.tipo,
  tipo_exibicao: mov.motivo || mov.tipo,
  quantidade: mov.quantidade_animais,
  peso_medio: mov.peso_medio,
  observacoes: mov.observacoes,
  area_origem_nome: nomeDaAreaDoMovimento(mov.area_origem_nome, mov.area_origem_id, areasRaw),
  area_destino_nome: nomeDaAreaDoMovimento(mov.area_destino_nome, mov.area_destino_id, areasRaw),
  area_destino_id: mov.area_destino_id,
  linked_movement_ids: getLinkedMovementIds(mov.observacoes),
  canDelete:
    EXCLUSAO_NO_HISTORICO_HABILITADA &&
    ((mov.tipo === 'Transferência de Área' && !mov.motivo) ||
      (mov.tipo !== 'Transferência de Área' && TIPOS_EDITAVEIS.has(mov.tipo) && !mov.motivo) ||
      mov.motivo === 'Junção de Lotes' ||
      mov.motivo === 'Renomear Lote'),
  hasPesagensFilhas: mov.tipo === 'Transferência de Área',
  raw: mov,
});

export default function HistoricoMovimentacoes({ lotes = [], lotesIds = [], areaId }) {
  // Tenant-aware (D-PROD-25): descarta seleção salva de outro tenant.
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const [escopo, setEscopo] = React.useState(areaId ? ESCOPO_AREA : ESCOPO_LOTES);
  const [deletingId, setDeletingId] = React.useState(null);
  const [hiddenMovementIds, setHiddenMovementIds] = React.useState([]);
  const deleteLockRef = React.useRef(false);

  // Lotes em foco: os registros; ou só nomes, para quem chama sem os objetos.
  const lotesEmFoco = React.useMemo(() => {
    const comObjeto = lotes.filter((item) => item && (item.id || item.nome));
    return comObjeto.length > 0 ? comObjeto : lotesIds.filter(Boolean).map((nome) => ({ nome }));
  }, [lotes, lotesIds]);
  const loteIds = React.useMemo(() => lotesEmFoco.map((l) => l.id).filter(Boolean), [lotesEmFoco]);
  const loteNomes = React.useMemo(() => [...new Set(lotesEmFoco.map((l) => l.nome).filter(Boolean))], [lotesEmFoco]);
  const escopoEfetivo = escopo === ESCOPO_AREA && areaId ? ESCOPO_AREA : ESCOPO_LOTES;
  const chaveLotes = `${loteIds.join('|')}#${loteNomes.join('|')}`;

  const contexto = React.useMemo(
    () => ({ empresaId: empresaSelecionadaId, escopo: escopoEfetivo, areaId: areaId ?? null, lotes: lotesEmFoco }),
    [empresaSelecionadaId, escopoEfetivo, areaId, lotesEmFoco]
  );
  const consultaHabilitada =
    !!empresaSelecionadaId && (escopoEfetivo === ESCOPO_AREA ? !!areaId : loteIds.length > 0 || loteNomes.length > 0);

  // Movimentações: servidor paginado; offline (ou servidor fora com cache) → cache, dito como cache.
  const movimentacoesQuery = useInfiniteQuery({
    queryKey: [
      'historico-movimentacoes',
      empresaSelecionadaId,
      escopoEfetivo,
      escopoEfetivo === ESCOPO_AREA ? areaId : null,
      escopoEfetivo === ESCOPO_LOTES ? chaveLotes : null,
    ],
    networkMode: 'always',
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      const doCache = async (falha) => {
        const snapshot = await getMapaCacheSnapshot('movimentacoes', empresaSelecionadaId);
        return {
          origem: 'cache',
          items: filtrarMovimentacoes(snapshot.items, contexto),
          brutos: snapshot.items.length,
          next_cursor: null,
          has_more: false,
          total: null,
          atualizadoEm: snapshot.atualizadoEm,
          falha,
        };
      };
      if (!estaOnline()) return doCache(null);
      try {
        const pagina = await listarHistoricoMovimentacoesPagina({
          empresaId: empresaSelecionadaId,
          ...(escopoEfetivo === ESCOPO_AREA ? { areaId } : { loteIds, loteNomes }),
          cursor: pageParam,
          limit: TAMANHO_PAGINA,
        });
        // Guarda cópia para consulta offline (política do cache: intervalo
        // mínimo e cooldown). Sem await e sem invalidar esta query.
        if (!pageParam) refreshMapaCacheEntry('movimentacoes', empresaSelecionadaId).catch(() => {});
        return { origem: 'servidor', ...pagina };
      } catch (erro) {
        if (pageParam) throw erro;
        const cache = await doCache(getApiErrorMessage(erro, 'Servidor indisponível'));
        if (cache.items.length > 0) return cache;
        throw erro;
      }
    },
    getNextPageParam: (ultima) => (ultima?.origem === 'servidor' && ultima.has_more ? ultima.next_cursor : undefined),
    enabled: consultaHabilitada,
  });

  // Demais fontes do histórico: cache do mapa, atualizado sob a política dele
  // (intervalo mínimo e cooldown). Sem invalidar a própria query — era o loop.
  const registrosQuery = useQuery({
    queryKey: ['historico-registros-lote', empresaSelecionadaId],
    networkMode: 'always',
    queryFn: async () => {
      const ler = (chave) =>
        estaOnline() ? refreshMapaCacheEntry(chave, empresaSelecionadaId) : getMapaCachedData(chave, empresaSelecionadaId);
      const [suplementacoes, eventosSuplementacao, medicamentos, sanidades, manejosTecnicos, areas] = await Promise.all(
        ['suplementacaoLote', 'eventosSuplementacao', 'aplicacaoMedicamento', 'eventoSanitario', 'manejoTecnico', 'areas'].map(
          async (chave) => (await ler(chave)) || []
        )
      );
      return { suplementacoes, eventosSuplementacao, medicamentos, sanidades, manejosTecnicos, areas };
    },
    enabled: !!empresaSelecionadaId,
  });

  // Operação do mapa (movimentação, pesagem, morte…) avisa por evento: refaz o histórico.
  React.useEffect(() => {
    const aoAtualizarMapa = () => {
      queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['historico-registros-lote'] });
    };
    window.addEventListener('atualizar-mapa', aoAtualizarMapa);
    return () => window.removeEventListener('atualizar-mapa', aoAtualizarMapa);
  }, [queryClient]);

  /** @type {any[]} */
  const paginas = movimentacoesQuery.data?.pages ?? [];
  /** @type {any} */
  const primeiraPagina = paginas[0] ?? null;
  const origem = primeiraPagina?.origem ?? null;
  const movimentacoesCarregadas = React.useMemo(() => {
    const vistos = new Set();
    const saida = [];
    for (const pagina of paginas) {
      for (const mov of pagina.items ?? []) {
        if (!mov?.id || vistos.has(mov.id)) continue;
        vistos.add(mov.id);
        saida.push(mov);
      }
    }
    return saida;
  }, [paginas]);

  const registros = registrosQuery.data;
  const areasRaw = registros?.areas ?? [];
  const areaNome = areaId ? areasRaw.find((a) => a.id === areaId)?.nome || lotesEmFoco[0]?.area_atual_nome || '' : '';

  const historico = React.useMemo(() => {
    const movimentacoes = movimentacoesCarregadas.map((mov) => movimentoComoItem(mov, areasRaw));
    if (!registros) return ordenarItensDoHistorico(movimentacoes);

    const entradas = escopoEfetivo === ESCOPO_AREA ? entradasNaArea(movimentacoesCarregadas, contexto) : undefined;
    const eventosPorId = new Map((registros.eventosSuplementacao || []).map((e) => [e.id, e]));
    const eventoTocaArea = (item) => {
      const evento = eventosPorId.get(item.suplementacao_evento_id);
      if (!evento || (!evento.area_id && !Array.isArray(evento.area_ids))) return null;
      return evento.area_id === areaId || (Array.isArray(evento.area_ids) && evento.area_ids.includes(areaId));
    };
    const comoLegado = (vinculo) => vinculo === 'nome';

    const suplementacoes = filtrarRegistrosDeLote({
      registros: registros.suplementacoes,
      loteId: (r) => r.lote_id,
      loteNome: (r) => r.lote_nome,
      criadoEm: (r) => r.created_date || r.data_lancamento,
      tocaArea: eventoTocaArea,
      contexto,
      entradas,
    }).map(({ registro: item, vinculo }) => ({
      uniqueId: `supl-${item.id}`,
      source: 'suplementacao',
      sourceLabel: 'Nutrição',
      lote: item.lote_nome,
      lote_key: item.lote_id || normalize(item.lote_nome),
      legado: comoLegado(vinculo),
      data_evento: item.data_lancamento,
      created_at: item.created_date || item.data_lancamento,
      tipo: 'Nutrição',
      tipo_exibicao: 'Nutrição',
      quantidade: item.cabecas_na_area,
      observacoes: `${item.produto || 'Produto'} • Consumo período: ${(item.consumo_total_lote_periodo_kg || 0).toFixed(1)} kg • ${(item.consumo_por_cabeca_dia_kg || 0).toFixed(3)} kg/cab/dia${item.dias_periodo ? ` • ${item.dias_periodo} dia(s)` : ' • Em aberto'}`,
      canEdit: false,
      canDelete: false,
    }));

    const medicamentos = filtrarRegistrosDeLote({
      registros: registros.medicamentos,
      loteId: (r) => r.lote_id,
      loteNome: (r) => r.lote_nome,
      criadoEm: (r) => r.created_date || r.data_aplicacao,
      contexto,
      entradas,
    }).map(({ registro: item, vinculo }) => ({
      uniqueId: `med-${item.id}`,
      source: 'medicamento',
      sourceLabel: 'Medicamento',
      lote: item.lote_nome,
      lote_key: item.lote_id || normalize(item.lote_nome),
      legado: comoLegado(vinculo),
      data_evento: item.data_aplicacao,
      created_at: item.created_date || item.data_aplicacao,
      tipo: 'Medicamento',
      tipo_exibicao: 'Medicamento',
      quantidade: item.quantidade_animais,
      observacoes: `${item.produto_nome || 'Medicamento'} • ${item.quantidade_aplicada || 0} ${item.unidade_medida || ''} por animal • Custo total R$ ${(item.custo_total || 0).toFixed(2)}`,
      canEdit: false,
      canDelete: false,
    }));

    const sanidades = filtrarRegistrosDeLote({
      registros: registros.sanidades,
      loteId: (r) => r.lote_id,
      loteNome: (r) => r.lote,
      criadoEm: (r) => r.created_date || r.data_evento,
      contexto,
      entradas,
    }).map(({ registro: item, vinculo }) => ({
      uniqueId: `san-${item.id}`,
      source: 'sanidade',
      sourceLabel: 'Sanidade',
      lote: item.lote,
      lote_key: item.lote_id || normalize(item.lote),
      legado: comoLegado(vinculo),
      data_evento: item.data_evento,
      created_at: item.created_date || item.data_evento,
      tipo: 'Sanidade',
      tipo_exibicao: item.tipo_evento || 'Sanidade',
      observacoes: `${item.produto_usado || 'Sem produto'}${item.dosagem ? ` • ${item.dosagem}` : ''}${item.observacoes ? ` • ${item.observacoes}` : ''}`,
      canEdit: false,
      canDelete: false,
    }));

    const manejosTecnicos = filtrarRegistrosDeLote({
      registros: registros.manejosTecnicos,
      loteId: (r) => r.lote_id,
      loteNome: (r) => r.nome_lote,
      criadoEm: (r) => r.created_date || r.data_evento,
      contexto,
      entradas,
    }).map(({ registro: item, vinculo }) => ({
      uniqueId: `mt-${item.id}`,
      source: 'manejo_tecnico',
      sourceLabel: 'Manejo Técnico',
      lote: item.nome_lote,
      lote_key: item.lote_id || normalize(item.nome_lote),
      legado: comoLegado(vinculo),
      data_evento: item.data_evento,
      created_at: item.created_date || item.data_evento,
      tipo: item.tipo_evento,
      tipo_exibicao: item.subtipo_manejo || item.tipo_evento,
      quantidade: item.quantidade_animais,
      observacoes: item.observacoes,
      canEdit: false,
      canDelete: false,
    }));

    return ordenarItensDoHistorico([...movimentacoes, ...suplementacoes, ...medicamentos, ...sanidades, ...manejosTecnicos]);
  }, [movimentacoesCarregadas, registros, areasRaw, contexto, escopoEfetivo, areaId]);

  // Só a exclusão (suspensa) precisa da visão global de movimentações e lotes.
  const { data: todasMovimentacoesGlobal = [] } = useQuery({
    queryKey: ['todas-movimentacoes-global', empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('movimentacoes', empresaSelecionadaId);
      if (cached?.length) return cached;
      return estaOnline() ? refreshMapaCacheEntry('movimentacoes', empresaSelecionadaId) : [];
    },
    enabled: EXCLUSAO_NO_HISTORICO_HABILITADA && !!empresaSelecionadaId,
  });

  const { data: todosLotesGlobal = [] } = useQuery({
    queryKey: ['todos-lotes-global', empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('lotes', empresaSelecionadaId);
      if (cached?.length) return cached;
      return estaOnline() ? refreshMapaCacheEntry('lotes', empresaSelecionadaId) : [];
    },
    enabled: EXCLUSAO_NO_HISTORICO_HABILITADA && !!empresaSelecionadaId,
  });

  const hasLaterRelatedRecord = React.useCallback((entry) => {
    const loteAtual = entry?.lote_key || normalize(entry?.lote);
    const loteNomeNorm = normalize(entry?.lote);
    const dataAtual = getTime(entry?.data_evento);
    const createdAtual = getTime(entry?.created_at);
    const isTransferencia = entry?.tipo === 'Transferência de Área';

    if (isTransferencia) {
      const loteIdOriginal = entry?.raw?.lote_id;
      const areaDestinoId = entry?.raw?.area_destino_id;
      const areaOrigemId = entry?.raw?.area_origem_id;

      // 1) Verificar se houve evento posterior NA ÁREA DESTINO desta transferência específica
      // Coletar IDs de lotes com mesmo nome QUE ESTÃO NA ÁREA DESTINO desta transferência
      const idsLotesDestinoEstaTransf = new Set(
        todosLotesGlobal
          .filter(l => normalize(l.nome) === loteNomeNorm && l.area_atual_id === areaDestinoId)
          .map(l => l.id)
      );
      if (loteIdOriginal) idsLotesDestinoEstaTransf.add(loteIdOriginal);

      const hasEventoNoDestino = todasMovimentacoesGlobal.some((mov) => {
        if (mov.id === entry.id) return false;
        
        // Outras transferências (ida ou volta) NÃO bloqueiam — são operações independentes
        if (mov.tipo === 'Transferência de Área') return false;
        
        // Só considerar movimentações que ocorreram NA ÁREA DESTINO desta transferência
        const movNaAreaDestino = mov.area_origem_id === areaDestinoId || mov.area_destino_id === areaDestinoId;
        if (!movNaAreaDestino) return false;

        // Match por nome OU por lote_id de lotes na área destino
        const mesmoNome = normalize(mov.lote) === loteNomeNorm;
        const loteIdRelacionado = !!mov.lote_id && idsLotesDestinoEstaTransf.has(mov.lote_id);
        
        if (!mesmoNome && !loteIdRelacionado) return false;
        
        const dataItem = getTime(mov.data_movimentacao);
        const createdItem = getTime(mov.created_date || mov.data_movimentacao);
        return dataItem > dataAtual || (dataItem === dataAtual && createdItem > createdAtual);
      });
      if (hasEventoNoDestino) return true;

      // 2) Verificar se houve evento posterior NA ÁREA ORIGEM (lote que ficou com o saldo)
      // Isso bloqueia se o lote remanescente na origem teve pesagem, morte, etc.
      const idsLotesOrigemEstaTransf = new Set(
        todosLotesGlobal
          .filter(l => normalize(l.nome) === loteNomeNorm && l.area_atual_id === areaOrigemId)
          .map(l => l.id)
      );

      const categoriaTransferenciaAtual = entry?.raw?.categoria_animal || parseCategoriaTransferenciaFromObs(entry?.observacoes) || null;
      const hasEventoNaOrigem = todasMovimentacoesGlobal.some((mov) => {
        if (mov.id === entry.id) return false;
        if (mov.tipo === 'Transferência de Área') return false;

        const movNaAreaOrigem = mov.area_origem_id === areaOrigemId || mov.area_destino_id === areaOrigemId;
        if (!movNaAreaOrigem) return false;

        const mesmoNome = normalize(mov.lote) === loteNomeNorm;
        const loteIdRelacionado = !!mov.lote_id && idsLotesOrigemEstaTransf.has(mov.lote_id);
        if (!mesmoNome && !loteIdRelacionado) return false;

        if (categoriaTransferenciaAtual) {
          const categoriaMovPosterior = mov.categoria_animal || parseCategoriaTransferenciaFromObs(mov.observacoes) || null;
          if (categoriaMovPosterior && normalize(categoriaMovPosterior) !== normalize(categoriaTransferenciaAtual)) {
            return false;
          }
        }

        const dataItem = getTime(mov.data_movimentacao);
        const createdItem = getTime(mov.created_date || mov.data_movimentacao);
        return dataItem > dataAtual || (dataItem === dataAtual && createdItem > createdAtual);
      });
      if (hasEventoNaOrigem) return true;

      // Nutrição posterior também bloqueia exclusão de registros anteriores
      const hasRegistroPosteriorNoHistorico = historico.some((item) => {
        if (item.uniqueId === entry.uniqueId) return false;
        const isRegistroBloqueador = item.source === 'movimentacao' || item.source === 'suplementacao';
        if (!isRegistroBloqueador) return false;
        const sameLote = (item.lote_key || normalize(item.lote)) === loteAtual || normalize(item.lote) === loteNomeNorm;
        if (!sameLote) return false;

        const dataItem = getTime(item.data_evento);
        const createdItem = getTime(item.created_at);
        return dataItem > dataAtual || createdItem > createdAtual;
      });
      if (hasRegistroPosteriorNoHistorico) return true;

      return false;
    }

    // Verificação padrão para outros tipos (não-transferência)
    // Nutrição posterior bloqueia automaticamente qualquer registro anterior do mesmo lote.
    return historico.some((item) => {
      if (item.uniqueId === entry.uniqueId) return false;

      const sameLote = (item.lote_key || normalize(item.lote)) === loteAtual || normalize(item.lote) === loteNomeNorm;
      const childLinked = (item.linked_movement_ids || []).includes(entry.id);
      if (!sameLote && !childLinked) return false;

      const isRegistroBloqueador = item.source === 'movimentacao' || item.source === 'suplementacao';
      if (!isRegistroBloqueador) return false;

      const dataItem = getTime(item.data_evento);
      const createdItem = getTime(item.created_at);
      return childLinked || dataItem > dataAtual || createdItem > createdAtual;
    });
  }, [historico, todasMovimentacoesGlobal, todosLotesGlobal]);

  const getDeleteBlockReason = React.useCallback((entry) => {
    if (!entry?.canDelete) {
      return 'Este registro só pode ser consultado no histórico.';
    }
    if (hasLaterRelatedRecord(entry)) {
      return 'Exclusão bloqueada porque existem registros posteriores vinculados a este lote. Exclua primeiro os lançamentos mais recentes na origem, no destino ou os manejos posteriores do saldo remanescente.';
    }
    return '';
  }, [hasLaterRelatedRecord]);

  const historicoVisivel = React.useMemo(
    () => historico.filter((item) => !(item.source === 'movimentacao' && hiddenMovementIds.includes(item.id))),
    [historico, hiddenMovementIds]
  );

  const handleDelete = async (entry) => {
    if (deletingId || deleteLockRef.current) return;

    deleteLockRef.current = true;
    setDeletingId(entry.id);

    const motivoBloqueio = getDeleteBlockReason(entry);
    if (motivoBloqueio) {
      deleteLockRef.current = false;
      setDeletingId(null);
      alert(motivoBloqueio);
      return;
    }

    const mov = entry.raw;
    if (!confirm('Excluir este lançamento? O lote será revertido automaticamente.')) {
      deleteLockRef.current = false;
      setDeletingId(null);
      return;
    }

    setHiddenMovementIds((prev) => (prev.includes(entry.id) ? prev : [...prev, entry.id]));

    try {
      const movsAll = await listarTodasMovimentacoes();
      const movimentoAtual = movsAll.find((item) => item.id === mov.id);

      if (!movimentoAtual) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] }),
          queryClient.invalidateQueries({ queryKey: ['todas-movimentacoes-global'] }),
          queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] }),
        ]);
        toast.success('Lançamento já estava excluído');
        return;
      }

      const qtd = movimentoAtual.quantidade_animais || 0;

      if (mov.motivo !== 'Renomear Lote' && mov.motivo !== 'Junção de Lotes' && hasLaterRelatedRecord(entry)) {
        throw new Error('Existe lançamento mais recente para este lote. Exclua sempre o registro atual primeiro.');
      }

      if (
        movimentoAtual.lote_id &&
        mov.motivo !== 'Renomear Lote' &&
        mov.motivo !== 'Junção de Lotes' &&
        mov.tipo !== 'Transferência de Área'
      ) {
        await validarSemRegistrosPosteriores({
          empresaId: empresaSelecionadaId,
          loteId: movimentoAtual.lote_id,
          dataReferencia: movimentoAtual.data_movimentacao,
          createdDateReferencia: movimentoAtual.created_date,
          ignorarMovimentacaoId: movimentoAtual.id,
        });
      }

      const lotesEmpresa = await listarLotesDaEmpresa(empresaSelecionadaId);

      const findLoteById = (id) => id ? lotesEmpresa.find(l => l.id === id) : null;
      const findLoteByNome = (nome, apenasAtivo = true) => lotesEmpresa.find(l =>
        normalize(l.nome) === normalize(nome) && (!apenasAtivo || l.status === 'Ativo')
      ) || null;
      const findLoteByNomeArea = (nome, areaId, apenasAtivo = false) => lotesEmpresa.find(l =>
        normalize(l.nome) === normalize(nome) && l.area_atual_id === areaId && (!apenasAtivo || l.status === 'Ativo')
      ) || null;
      const findLoteByNomeAreaCategoria = (nome, areaId, categoria, excludeId = null) => lotesEmpresa.find(l =>
        l.id !== excludeId &&
        normalize(l.nome) === normalize(nome) &&
        l.area_atual_id === areaId &&
        normalize(l.categoria) === normalize(categoria)
      ) || null;

      const resolverLote = () => findLoteById(mov.lote_id) || findLoteByNome(mov.lote);

      // Declarar categoriaMovimento no escopo externo para uso na reversão de transferência
      let categoriaMovimento = null;
      if (mov.tipo === 'Transferência de Área') {
        // Prioridade: 1) campo direto categoria_animal (gravado na transferência)
        // 2) extrair das observações (movimentação parcial)
        // NÃO usar findLoteById(mov.lote_id)?.categoria como fallback pois o lote pode ter
        // mudado de categoria desde a transferência
        categoriaMovimento = mov.categoria_animal || parseCategoriaTransferenciaFromObs(mov.observacoes) || null;
      }

      if (mov.motivo === 'Junção de Lotes') {
        const snapshotLotes = getJuncaoLotesSnapshot(mov.observacoes);
        if (!snapshotLotes || snapshotLotes.length === 0) {
          throw new Error('Não foi possível desfazer a junção: dados originais não encontrados.');
        }
        for (const lo of snapshotLotes) {
          await atualizarLote(lo.id, {
            nome: lo.nome, quantidade_cabecas: lo.quantidade_cabecas, peso_medio_kg: lo.peso_medio_kg,
            status: lo.status, categoria: lo.categoria,
            categoria_manejo_id: lo.categoria_manejo_id || null, categoria_manejo_nome: lo.categoria_manejo_nome || null,
            area_atual_id: lo.area_atual_id, area_atual_nome: lo.area_atual_nome
          });
        }
      }

      if (mov.motivo === 'Renomear Lote') {
        const obsText = mov.observacoes || '';
        const m = obsText.match(/Renomear Lote: "(.+?)" →/);
        if (m && m[1] && mov.lote_id) {
          await atualizarLote(mov.lote_id, { nome: m[1] });
        }
      }

      if (mov.tipo === 'Morte' || mov.tipo === 'Abate') {
        const loteRecord = resolverLote();
        if (loteRecord) {
          await atualizarLote(loteRecord.id, {
            quantidade_cabecas: (loteRecord.quantidade_cabecas || 0) + qtd, status: 'Ativo'
          });
        }
      }

      if (mov.tipo === 'Nascimento') {
        const loteRecord = resolverLote();
        if (loteRecord) {
          const novaQtd = Math.max(0, (loteRecord.quantidade_cabecas || 0) - qtd);
          await atualizarLote(loteRecord.id, {
            quantidade_cabecas: novaQtd, status: novaQtd > 0 ? loteRecord.status : 'Inativo'
          });
        }
      }

      if (mov.tipo === 'Pesagem') {
        const loteRecord = resolverLote();
        if (loteRecord) {
          const pesoAnterior = getPesoAnteriorFromObs(mov.observacoes);
          if (pesoAnterior !== null) {
            await atualizarLote(loteRecord.id, { peso_medio_kg: pesoAnterior });
          }
        }
      }

      if (mov.tipo === 'Mudança de Categoria') {
        const categoriaAnterior = getCategoriaAnteriorFromObs(mov.observacoes);
        const categoriaNova = parseCategoriaNovaFromObs(mov.observacoes);
        const snapshotMudanca = getMudancaCategoriaSnapshot(mov.observacoes);
        const lotePrincipal = resolverLote();
        const qtdMovimento = mov.quantidade_animais || 0;

        if (categoriaAnterior && categoriaNova && lotePrincipal) {
          const loteCategoriaAnterior = snapshotMudanca?.origem_lote_id
            ? findLoteById(snapshotMudanca.origem_lote_id)
            : (findLoteByNomeAreaCategoria(mov.lote, mov.area_origem_id, categoriaAnterior) || lotePrincipal);

          const loteCategoriaNova = snapshotMudanca?.destino_lote_id
            ? findLoteById(snapshotMudanca.destino_lote_id)
            : findLoteByNomeAreaCategoria(
                mov.lote,
                mov.area_origem_id,
                categoriaNova,
                loteCategoriaAnterior?.id
              );

          if (loteCategoriaNova && loteCategoriaAnterior && loteCategoriaNova.id !== loteCategoriaAnterior.id) {
            await atualizarLote(loteCategoriaAnterior.id, {
              quantidade_cabecas: (loteCategoriaAnterior.quantidade_cabecas || 0) + qtdMovimento,
              status: 'Ativo'
            });

            const novaQtdCategoriaNova = Math.max(0, (loteCategoriaNova.quantidade_cabecas || 0) - qtdMovimento);
            await atualizarLote(loteCategoriaNova.id, {
              quantidade_cabecas: novaQtdCategoriaNova,
              status: novaQtdCategoriaNova > 0 ? 'Ativo' : 'Inativo'
            });
          } else {
            const sexoAnterior = getSexoAnteriorFromObs(mov.observacoes);
            const updateData = { categoria: categoriaAnterior };
            if (sexoAnterior) updateData.sexo = sexoAnterior;
            await atualizarLote(lotePrincipal.id, updateData);
          }
        }
      }

      if (mov.tipo === 'Transferência de Área') {
        await reverseMovementOnDelete({
          empresaSelecionadaId,
          movement: movimentoAtual,
        });
      }

      await excluirMovimentacao(mov.id);

      await Promise.all([
        refreshMapaCacheEntry('movimentacoes', empresaSelecionadaId, { force: true }),
        refreshMapaCacheEntry('lotes', empresaSelecionadaId, { force: true }),
        queryClient.invalidateQueries({ queryKey: ['lotes'] }),
        queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] }),
        queryClient.invalidateQueries({ queryKey: ['todas-movimentacoes-global'] }),
        queryClient.invalidateQueries({ queryKey: ['todos-lotes-global'] }),
        queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] }),
        queryClient.invalidateQueries({ queryKey: ['mapa-cache'] }),
      ]);
      try { window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['lotes', 'movimentacoes'] } })); } catch { /* falha ignorada intencionalmente: operação best-effort */ }
      toast.success('Lançamento excluído e saldo revertido');
    } catch (error) {
      console.error('Erro ao excluir lançamento:', error);
      if (error?.status === 404) {
        await Promise.all([
          refreshMapaCacheEntry('movimentacoes', empresaSelecionadaId, { force: true }),
          refreshMapaCacheEntry('lotes', empresaSelecionadaId, { force: true }),
          queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] }),
          queryClient.invalidateQueries({ queryKey: ['todas-movimentacoes-global'] }),
          queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] }),
          queryClient.invalidateQueries({ queryKey: ['mapa-cache'] }),
        ]);
        toast.success('Lançamento já estava excluído');
      } else {
        setHiddenMovementIds((prev) => prev.filter((id) => id !== entry.id));
        toast.error(getApiErrorMessage(error, 'Não foi possível excluir o lançamento'));
      }
    } finally {
      deleteLockRef.current = false;
      setDeletingId(null);
    }
  };

  const totalServidor = origem === 'servidor' ? primeiraPagina?.total ?? null : null;
  const carregando = consultaHabilitada && (movimentacoesQuery.isPending || (registrosQuery.isPending && !!empresaSelecionadaId));
  const titulo =
    escopoEfetivo === ESCOPO_AREA
      ? `Histórico da Área${areaNome ? ` ${areaNome}` : ''}`
      : `Histórico do${loteNomes.length > 1 ? 's' : ''} Lote${loteNomes.length > 1 ? 's' : ''}`;

  const seletorDeEscopo = areaId && lotesEmFoco.length > 0 && (
    <div className="flex gap-1" role="group" aria-label="Escopo do histórico">
      {[
        [ESCOPO_AREA, 'Área'],
        [ESCOPO_LOTES, 'Lotes atuais'],
      ].map(([valor, rotulo]) => (
        <Button
          key={valor}
          type="button"
          size="sm"
          variant={escopoEfetivo === valor ? 'default' : 'outline'}
          className="h-7 px-2.5 text-[11px]"
          aria-pressed={escopoEfetivo === valor}
          onClick={() => setEscopo(valor)}
        >
          {rotulo}
        </Button>
      ))}
    </div>
  );

  const cabecalho = (contagem) => (
    <CardHeader className="bg-slate-50 border-b py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm font-semibold">
          {titulo}
          {contagem !== null ? ` (${contagem})` : ''}
        </CardTitle>
        {seletorDeEscopo}
      </div>
      <p className="text-[11px] text-slate-500">
        {escopoEfetivo === ESCOPO_AREA
          ? 'Entradas, saídas e manejos registrados nesta área, inclusive de lotes que já saíram.'
          : 'Registros dos lotes desta área pelo identificador, em qualquer área por onde passaram.'}
      </p>
    </CardHeader>
  );

  const avisoDeOrigem = origem === 'cache' && (
    <div role="status" className="mx-2 mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
      {primeiraPagina?.falha
        ? `Não foi possível consultar o servidor (${primeiraPagina.falha}). `
        : 'Sem conexão. '}
      Exibindo movimentações salvas neste aparelho
      {formatDateTime(primeiraPagina?.atualizadoEm) ? ` em ${formatDateTime(primeiraPagina.atualizadoEm)}` : ''}; podem estar
      desatualizadas
      {primeiraPagina?.brutos >= LIMITE_CACHE_MOVIMENTACOES
        ? ` e limitadas às ${LIMITE_CACHE_MOVIMENTACOES} mais recentes da conta`
        : ''}
      . A lista será atualizada quando a conexão voltar.
    </div>
  );

  if (carregando) {
    return (
      <Card>
        {cabecalho(null)}
        <CardContent className="p-4">
          <div role="status" className="text-center text-sm text-slate-500">Carregando histórico...</div>
        </CardContent>
      </Card>
    );
  }

  if (movimentacoesQuery.isError && movimentacoesCarregadas.length === 0) {
    return (
      <Card>
        {cabecalho(null)}
        <CardContent className="p-4">
          <div role="alert" className="space-y-2 py-6 text-center text-sm text-slate-600">
            <div>Não foi possível carregar o histórico.</div>
            <div className="text-[11px] text-slate-500">{getApiErrorMessage(movimentacoesQuery.error, 'Tente novamente em instantes.')}</div>
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => movimentacoesQuery.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (historicoVisivel.length === 0) {
    const semCacheNoAparelho = origem === 'cache' && !primeiraPagina?.atualizadoEm;
    return (
      <Card>
        {cabecalho(null)}
        {avisoDeOrigem}
        <CardContent className="p-4">
          <div className="text-center py-8 text-slate-500 text-sm">
            {semCacheNoAparelho
              ? 'Este aparelho ainda não tem movimentações salvas para consulta sem conexão.'
              : 'Nenhum lançamento encontrado'}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        {cabecalho(historicoVisivel.length)}
        {avisoDeOrigem}
        <CardContent className="p-2">
          <div className="max-h-[500px] overflow-y-auto space-y-2">
            {historicoVisivel.map((item) => {
              const motivoBloqueio = item.source === 'movimentacao' && item.canDelete ? getDeleteBlockReason(item) : '';
              const isBloqueado = !!motivoBloqueio;
              const tipoExibicao = item.tipo_exibicao || item.tipo;

              const tipoFluxo = item.source === 'movimentacao' ? fluxoNaArea(item.raw, escopoEfetivo === ESCOPO_AREA ? areaId : null) : item.sourceLabel;

              return (
                <div key={item.uniqueId} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">
                          {formatDateOnly(item.data_evento)}
                        </span>
                        <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
                          {tipoExibicao}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] text-slate-700 border-slate-300 bg-white">
                          {tipoFluxo}
                        </Badge>
                        {item.legado && (
                          <Badge variant="outline" className="text-[10px] text-amber-800 border-amber-300 bg-amber-50" title="Registro antigo sem identificador de lote: vínculo feito pelo nome.">
                            Vínculo pelo nome
                          </Badge>
                        )}
                      </div>

                      <div className="text-xs font-semibold text-slate-900">{item.lote || 'Sem lote'}</div>

                      <div className="space-y-0.5 text-[10px] text-slate-600">
                        {!!item.quantidade && <div><strong>Quantidade:</strong> {item.quantidade} cab</div>}
                        <div><strong>Data:</strong> {formatDateOnly(item.data_evento)}</div>
                        {item.tipo === 'Transferência de Área' && (
                          <div><strong>Trajeto:</strong> {item.area_origem_nome || '-'} → {item.area_destino_nome || '-'}</div>
                        )}
                        {!!item.peso_medio && <div><strong>Peso médio:</strong> {item.peso_medio} kg</div>}
                        <div><strong>Origem:</strong> {item.sourceLabel}</div>
                        {!!item.observacoes && <div className="break-words"><strong>Detalhes:</strong> {formatHistoricoObservacoes(item)}</div>}
                        {item.source === 'suplementacao' && (
                          <div className="text-[10px] text-slate-400">Nutrição: consulta apenas; o cancelamento está temporariamente suspenso.</div>
                        )}

                        {isBloqueado && item.canDelete && (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
                            <strong>Aviso:</strong> {motivoBloqueio}
                          </div>
                        )}
                      </div>
                    </div>

                    {item.source === 'movimentacao' && item.canDelete && !isBloqueado && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-8 text-xs"
                          disabled={!!deletingId || hiddenMovementIds.includes(item.id)}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDelete(item);
                          }}
                        >
                          {deletingId === item.id ? 'Excluindo...' : 'Excluir'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-[11px] text-slate-500">
            <span>
              {origem === 'servidor' && totalServidor !== null
                ? `Movimentações: ${movimentacoesCarregadas.length} de ${totalServidor}`
                : `Movimentações em cache: ${movimentacoesCarregadas.length}`}
            </span>
            {movimentacoesQuery.hasNextPage && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={movimentacoesQuery.isFetchingNextPage}
                onClick={() => movimentacoesQuery.fetchNextPage()}
              >
                {movimentacoesQuery.isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
              </Button>
            )}
          </div>
          {movimentacoesQuery.isFetchNextPageError && (
            <div role="alert" className="px-1 pt-1 text-[11px] text-red-700">
              Não foi possível carregar a próxima página. {getApiErrorMessage(movimentacoesQuery.error, '')}
            </div>
          )}
          {!EXCLUSAO_NO_HISTORICO_HABILITADA && (
            <p className="px-1 pt-1 text-[10px] text-slate-400">
              Exclusão de lançamentos pelo histórico está suspensa até o estorno seguro.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
