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
import { listarHistoricoMovimentacoesPagina } from "@/services/loteManejoService";
import { Button } from "@/components/ui/button";
import { normalizeText, getJuncaoLotesSnapshot } from "../utils/pecuariaUtils";
import { ehMovimentoCancelado, motivoSemCancelamento, tipoTemCancelamento } from "@/domain/lotes/situacaoMovimento";
import CancelarMovimentacao from "./CancelarMovimentacao";
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



const getTime = (value) => new Date(value).getTime() || 0;
const normalize = (value) => normalizeText(value);


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
 * Exclusão de lançamento pelo histórico: REMOVIDA (R2A, D-PROD-97). A antiga
 * reversão no navegador (várias chamadas, sem transação) deu lugar ao comando
 * de cancelamento no servidor (`CancelarMovimentacao`). O servidor recusa
 * DELETE/PATCH diretos de movimentação.
 */

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
  cancelado: ehMovimentoCancelado(mov),
  cancelamento: mov.cancelamento || null,
  raw: mov,
});

export default function HistoricoMovimentacoes({ lotes = [], lotesIds = [], areaId }) {
  // Tenant-aware (D-PROD-25): descarta seleção salva de outro tenant.
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const [escopo, setEscopo] = React.useState(areaId ? ESCOPO_AREA : ESCOPO_LOTES);

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
        const snapshot = await getMapaCacheSnapshot('movimentacoesHistorico', empresaSelecionadaId);
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
        if (!pageParam) refreshMapaCacheEntry('movimentacoesHistorico', empresaSelecionadaId).catch(() => {});
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
    }));

    return ordenarItensDoHistorico([...movimentacoes, ...suplementacoes, ...medicamentos, ...sanidades, ...manejosTecnicos]);
  }, [movimentacoesCarregadas, registros, areasRaw, contexto, escopoEfetivo, areaId]);

  const historicoVisivel = historico;

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
              const tipoExibicao = item.tipo_exibicao || item.tipo;

              const tipoFluxo = item.source === 'movimentacao' ? fluxoNaArea(item.raw, escopoEfetivo === ESCOPO_AREA ? areaId : null) : item.sourceLabel;

              return (
                <div key={item.uniqueId} className={`border rounded-lg p-2.5 space-y-1 ${item.cancelado ? 'border-slate-200 bg-slate-50' : 'border-slate-200 hover:bg-gray-50'}`}>
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
                        {item.source === 'movimentacao' && (
                          <Badge variant="outline" className={`text-[10px] ${item.cancelado ? 'text-red-800 border-red-300 bg-red-50' : 'text-emerald-800 border-emerald-300 bg-emerald-50'}`}>
                            {item.cancelado ? 'Cancelado' : 'Ativo'}
                          </Badge>
                        )}
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

                        {item.cancelado && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-800">
                            <strong>Cancelado</strong>
                            {item.cancelamento?.em ? ` em ${formatDateTime(item.cancelamento.em) || '-'}` : ''}
                            {item.cancelamento?.por_login ? ` por ${item.cancelamento.por_login}` : ''}
                            {item.cancelamento?.motivo ? ` — Motivo: ${item.cancelamento.motivo}` : ''}
                          </div>
                        )}
                        {item.source === 'movimentacao' && !item.cancelado && motivoSemCancelamento(item.raw) && (
                          <div className="text-[10px] text-slate-400">{motivoSemCancelamento(item.raw)}</div>
                        )}
                      </div>
                    </div>

                    {item.source === 'movimentacao' && origem === 'servidor' && !item.cancelado && tipoTemCancelamento(item.raw) && (
                      <div className="flex gap-1 shrink-0">
                        <CancelarMovimentacao movimento={item.raw} />
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
        </CardContent>
      </Card>
    </>
  );
}
