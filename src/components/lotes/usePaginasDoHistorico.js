import React from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { listarHistoricoMovimentacoesPagina } from "@/services/loteManejoService";
import { getMapaCacheSnapshot, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { ESCOPO_AREA, ESCOPO_LOTES, filtrarMovimentacoes } from "@/domain/lotes/historicoMovimentacoes";

/*
 * Movimentações do histórico (D-PROD-94/123): a consulta paginada do servidor
 * (ordem H2 por ocorrência), a cópia do aparelho sem conexão (ou com o
 * servidor fora e cache) e o reinício da paginação quando o servidor recusa o
 * cursor. Saiu de `HistoricoMovimentacoes.jsx` sem mudar nada do que ele faz,
 * para a aba Histórico do pasto (Detalhes do Lote v12, D-PROD-V12) usar a
 * mesma consulta — mesma chave, mesmo cache do React Query.
 */

/** Página do servidor; "Carregar mais" busca a próxima. */
export const TAMANHO_PAGINA = 100;

/** Teto do cache do mapa para movimentações (`listMovimentacoes`). */
export const LIMITE_CACHE_MOVIMENTACOES = 500;

export const estaOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** Cursor recusado pelo servidor (v1, adulterado, de outra consulta): recomeçar do início — D-PROD-123. */
const CODIGO_CURSOR_INVALIDO = "HISTORICO_CURSOR_INVALIDO";
/** @param {any} erro */
const codigoDoServidor = (erro) => (typeof erro?.cause?.code === "string" ? erro.cause.code : null);

/**
 * @param {{
 *   empresaId: string | null | undefined,
 *   escopo: string,
 *   areaId?: string | null,
 *   loteIds?: string[],
 *   loteNomes?: string[],
 *   chaveLotes?: string,
 *   contexto: import("@/domain/lotes/historicoMovimentacoes").ContextoHistorico,
 *   habilitada: boolean,
 * }} p `escopo` já efetivo (`ESCOPO_AREA` só com `areaId`).
 */
export function usePaginasDoHistorico({ empresaId, escopo, areaId = null, loteIds = [], loteNomes = [], chaveLotes = "", contexto, habilitada }) {
  const queryClient = useQueryClient();

  // Movimentações: servidor paginado; offline (ou servidor fora com cache) → cache, dito como cache.
  const chaveDaConsulta = React.useMemo(
    () => [
      "historico-movimentacoes",
      empresaId,
      escopo,
      escopo === ESCOPO_AREA ? areaId : null,
      escopo === ESCOPO_LOTES ? chaveLotes : null,
    ],
    [empresaId, escopo, areaId, chaveLotes]
  );
  const query = useInfiniteQuery({
    queryKey: chaveDaConsulta,
    networkMode: "always",
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      /** @param {string | null} falha */
      const doCache = async (falha) => {
        const snapshot = await getMapaCacheSnapshot("movimentacoesHistorico", empresaId);
        return {
          origem: "cache",
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
          empresaId,
          ...(escopo === ESCOPO_AREA ? { areaId } : { loteIds, loteNomes }),
          cursor: pageParam,
          limit: TAMANHO_PAGINA,
        });
        // Guarda cópia para consulta offline (política do cache: intervalo
        // mínimo e cooldown). Sem await e sem invalidar esta query.
        if (!pageParam) refreshMapaCacheEntry("movimentacoesHistorico", empresaId).catch(() => {});
        return { origem: "servidor", ...pagina };
      } catch (erro) {
        if (pageParam) throw erro;
        const cache = await doCache(getApiErrorMessage(erro, "Servidor indisponível"));
        if (cache.items.length > 0) return cache;
        throw erro;
      }
    },
    getNextPageParam: (ultima) => (ultima?.origem === "servidor" && ultima.has_more ? ultima.next_cursor : undefined),
    enabled: habilitada,
  });

  /** @type {any[]} */
  const paginas = query.data?.pages ?? [];
  /** @type {any} */
  const primeiraPagina = paginas[0] ?? null;
  /** @type {"servidor" | "cache" | null} */
  const origem = primeiraPagina?.origem ?? null;
  // Datas `historico_*` só valem vindas do endpoint H2 (PR191-R2).
  const doServidorH2 = origem === "servidor" && primeiraPagina?.ordem === "ocorrencia_desc_v2";
  const movimentacoesCarregadas = React.useMemo(() => {
    const vistos = new Set();
    /** @type {any[]} */
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

  // Cursor recusado (v1 de antes do H2, adulterado, de outra consulta): o
  // servidor responde 400 HISTORICO_CURSOR_INVALIDO; só nesse código (lido do
  // corpo, em `cause.code`) o histórico recomeça da primeira página. Qualquer
  // outra falha (401, 403, 500, rede, 400 genérico) fica visível.
  //
  // PR191-R2: o reinício vale por INCIDENTE = consulta (chave) + estado da
  // paginação (cursores das páginas carregadas). Muda o filtro, a empresa, o
  // escopo, ou a página 1 recarregada traz outro cursor → incidente novo,
  // reinicia de novo. O MESMO incidente repetido logo após o reinício (o
  // servidor recusa de novo o mesmo cursor) não reinicia: o erro aparece — sem
  // laço. O reset atinge só a consulta atual (`exact`), nunca o cache de outra
  // empresa ou escopo.
  const ultimoIncidente = React.useRef(/** @type {string|null} */ (null));
  const dadosPaginados = /** @type {any} */ (query.data);
  const cursorRecusado = codigoDoServidor(query.error) === CODIGO_CURSOR_INVALIDO;
  React.useEffect(() => {
    if (!cursorRecusado || !query.isError) return;
    const paginasAtuais = dadosPaginados?.pages ?? [];
    const incidente = JSON.stringify([
      chaveDaConsulta,
      dadosPaginados?.pageParams ?? [],
      paginasAtuais[paginasAtuais.length - 1]?.next_cursor ?? null,
    ]);
    if (ultimoIncidente.current === incidente) return;
    ultimoIncidente.current = incidente;
    queryClient.resetQueries({ queryKey: chaveDaConsulta, exact: true });
  }, [cursorRecusado, query.isError, query.errorUpdatedAt, dadosPaginados, chaveDaConsulta, queryClient]);

  return { query, chaveDaConsulta, paginas, primeiraPagina, origem, doServidorH2, movimentacoesCarregadas };
}
