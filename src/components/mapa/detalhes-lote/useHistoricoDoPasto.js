import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ESCOPO_AREA } from "@/domain/lotes/historicoMovimentacoes";
import { LIMITE_CACHE_MOVIMENTACOES, usePaginasDoHistorico } from "@/components/lotes/usePaginasDoHistorico";
import { montarHistoricoDoPasto } from "./historicoDoPasto";

/*
 * Dados da aba Histórico do pasto (Detalhes do Lote v12, D-PROD-217): as
 * movimentações da área pela MESMA consulta do Histórico de Movimentação de
 * hoje (servidor paginado em ordem H2, cópia do aparelho sem conexão,
 * reinício do cursor recusado — `usePaginasDoHistorico`) e os eventos de
 * suplementação que a casca já tem (`dados.suplementacao.eventos`, filtrados
 * pela área). Só existe enquanto a aba está aberta (a casca só monta a aba ativa).
 */

/**
 * @typedef {{
 *   falha: string | null,
 *   atualizadoEm: string | null,
 *   quantidade: number,
 *   limiteAtingido: boolean,
 * }} AvisoOffline
 */

/**
 * @param {{
 *   empresaId: string | null | undefined,
 *   areaId: string | null | undefined,
 *   areaNome?: string | null,
 *   eventos?: any[] | null,
 *   filtro: string,
 * }} p
 */
export function useHistoricoDoPasto({ empresaId, areaId, areaNome = null, eventos = null, filtro }) {
  const queryClient = useQueryClient();
  const area = areaId || null;
  const habilitada = Boolean(empresaId && area);
  const contexto = React.useMemo(() => ({ empresaId: empresaId || "", escopo: ESCOPO_AREA, areaId: area, lotes: [] }), [empresaId, area]);
  const { query, primeiraPagina, origem, doServidorH2, movimentacoesCarregadas } = usePaginasDoHistorico({
    empresaId,
    escopo: ESCOPO_AREA,
    areaId: area,
    contexto,
    habilitada,
  });

  // Manejo salvo, exclusão, mapa atualizado: refaz o histórico (como o de hoje).
  React.useEffect(() => {
    const aoAtualizarMapa = () => {
      queryClient.invalidateQueries({ queryKey: ["historico-movimentacoes"] });
    };
    window.addEventListener("atualizar-mapa", aoAtualizarMapa);
    return () => window.removeEventListener("atualizar-mapa", aoAtualizarMapa);
  }, [queryClient]);

  const haMaisPaginas = Boolean(query.hasNextPage);
  const linhaDoTempo = React.useMemo(
    () =>
      montarHistoricoDoPasto({
        movimentacoes: movimentacoesCarregadas,
        eventos: Array.isArray(eventos) ? eventos : [],
        areaId: area,
        areaNome,
        empresaId: empresaId || null,
        doServidor: doServidorH2,
        haMaisPaginas,
        filtro,
      }),
    [movimentacoesCarregadas, eventos, area, areaNome, empresaId, doServidorH2, haMaisPaginas, filtro]
  );

  /** @type {AvisoOffline | null} */
  const offline =
    origem === "cache"
      ? {
          falha: typeof primeiraPagina?.falha === "string" ? primeiraPagina.falha : null,
          atualizadoEm: typeof primeiraPagina?.atualizadoEm === "string" ? primeiraPagina.atualizadoEm : null,
          quantidade: movimentacoesCarregadas.length,
          limiteAtingido: Number(primeiraPagina?.brutos) >= LIMITE_CACHE_MOVIMENTACOES,
        }
      : null;

  return {
    dias: linhaDoTempo.dias,
    adiados: linhaDoTempo.adiados,
    carregando: habilitada && query.isPending,
    /** Primeira página falhou e não há cópia no aparelho: o histórico não abre. */
    erro: query.isError && movimentacoesCarregadas.length === 0 ? query.error : null,
    tentarDeNovo: () => {
      query.refetch();
    },
    origem,
    offline,
    haMaisPaginas,
    carregandoMais: query.isFetchingNextPage,
    erroAoCarregarMais: query.isFetchNextPageError ? query.error : null,
    carregarMais: () => {
      query.fetchNextPage();
    },
    /** Total do servidor (só online). */
    total: origem === "servidor" && typeof primeiraPagina?.total === "number" ? primeiraPagina.total : null,
    carregadas: movimentacoesCarregadas.length,
  };
}
