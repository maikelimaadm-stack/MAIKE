import React, { useMemo } from "react";
import CartaoHistorico, { EstadoHistorico, LinhaHistorico, MolduraHistorico, SeloHistorico, useTituloDoHistorico } from "@/components/lotes/CartaoHistorico";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { safeDivide } from "../utils/pecuariaUtils";
import CardMetricaEvento from "./CardMetricaEvento";
import DesvioConsumoTag from "./DesvioConsumoTag";
import { CANCELAMENTO_COCHO_HABILITADO, MENSAGEM_ESTORNO_SUSPENSO } from "@/domain/estornos/politicaEstorno";
import CancelarLancamentoCocho from "./CancelarLancamentoCocho";
import { projecaoDoCartaoDoNivel } from "@/domain/suplementacao/nivelSuplementacao";

/** "2026-11-10" ou ISO → "10/11/2026" (dia civil gravado, sem fuso). @param {any} valor */
const diaDoLancamento = (valor) => {
  if (!valor) return "-";
  const [ano, mes, dia] = String(valor).split("T")[0].split("-");
  return `${dia}/${mes}/${ano}`;
};

/**
 * Histórico de lançamentos do cocho.
 *
 * `nivel` (D-PROD-178): o nível do SSOT que o detalhe do cocho já calculou. O
 * último lançamento sai com a MESMA projeção do detalhe
 * (`projecaoDoCartaoDoNivel`) — inclusive "sem estimativa" quando os cochos
 * dividem os mesmos animais; os outros mostram o que ficou gravado no evento.
 *
 * D-PROD-222: no desenho do histórico do manejo (o do Histórico de
 * Movimentação): dentro do `LancLoteDialogo` o título com a contagem vai para o
 * cabeçalho do diálogo, sem cartão em volta; cada lançamento é um
 * `CartaoHistorico` (selos de data e período, o produto em negrito, as linhas
 * "Rótulo: valor" e as métricas por seção). Regras, consultas e a política de
 * estorno (D-PROD-94a) não mudam.
 *
 * D-PROD-268: "Cancelar lançamento" no pé do cartão (`CancelarLancamentoCocho`: comando do
 * servidor, só para quem tem a permissão, motivo obrigatório, elegibilidade antes de habilitar,
 * só online). A regra local (só o mais recente, sem movimentação de gado depois) é só DICA para
 * esconder a ação; quem decide é o servidor. A reversão antiga pelo navegador saiu daqui.
 *
 * @param {{ pontoId: any, pontoNome?: string, ponto?: any, nivel?: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho|null }} props
 */
export default function HistoricoSuplementacaoPonto({ pontoId, pontoNome, ponto, nivel = null }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();

  const { data: eventos = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["suplementacao-ponto", pontoId],
    queryFn: async () => {
      const cached = await getMapaCachedData('eventosSuplementacao', empresaSelecionadaId);
      
      const applyFilter = (data) => data
        .filter((evento) => evento.empresa_id === empresaSelecionadaId && evento.ponto_suplementacao_id === pontoId)
        .sort((a, b) => new Date(b.created_date || b.data_lancamento || 0) - new Date(a.created_date || a.data_lancamento || 0));

      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('eventosSuplementacao', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(["suplementacao-ponto", pontoId], applyFilter(fresh));
          });
          return applyFilter(cached);
        } else {
          const fresh = await refreshMapaCacheEntry('eventosSuplementacao', empresaSelecionadaId);
          return applyFilter(fresh);
        }
      }
      return applyFilter(cached || []);
    },
    enabled: !!empresaSelecionadaId && !!pontoId
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ["movimentacoes-bloqueio-suplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('movimentacoes', empresaSelecionadaId);
      
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('movimentacoes', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(["movimentacoes-bloqueio-suplementacao", empresaSelecionadaId], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('movimentacoes', empresaSelecionadaId);
      }
      return cached || [];
    },
    enabled: !!empresaSelecionadaId,
  });

  const bloqueiosPorEvento = useMemo(() => {
    const mapa = {};

    eventos.forEach((evento) => {
      const areasEvento = new Set([evento.area_id, ...(Array.isArray(evento.area_ids) ? evento.area_ids : [])].filter(Boolean));
      const sequenciaEvento = new Date(evento.created_date || evento.data_lancamento || 0).getTime();

      mapa[evento.id] = movimentacoes.some((mov) => {
        const sequenciaMov = new Date(mov.created_date || mov.data_movimentacao || 0).getTime();
        if (sequenciaMov <= sequenciaEvento) return false;
        if (areasEvento.size === 0) return false;
        return areasEvento.has(mov.area_origem_id) || areasEvento.has(mov.area_destino_id);
      });
    });

    return mapa;
  }, [eventos, movimentacoes]);

  // Depois do cancelamento: o cartão sai já (o componente relê caches e o mapa).
  const aoCancelar = (id) => queryClient.setQueryData(["suplementacao-ponto", pontoId], (current = []) => current.filter((item) => item.id !== id));

  // Erro sem nada guardado: o estado de erro do Histórico de Movimentação (não "nenhum lançamento").
  const falhou = isError && eventos.length === 0;
  const contagem = isLoading || falhou ? null : eventos.length;
  const noDialogo = useTituloDoHistorico("Histórico do Cocho", contagem);
  // Fora do diálogo (sem cabeçalho para o título), o título fica na barra.
  const barra = noDialogo ? null : <h3 className="text-sm font-semibold text-slate-900">{`Histórico do Cocho${contagem != null ? ` (${contagem})` : ""}`}</h3>;

  if (isLoading) return <MolduraHistorico barra={barra} estado={<EstadoHistorico tipo="carregando" />} />;

  if (falhou) return <MolduraHistorico barra={barra} estado={<EstadoHistorico tipo="erro" erro={error} onTentarDeNovo={() => refetch()} />} />;

  if (eventos.length === 0) return <MolduraHistorico barra={barra} estado={<EstadoHistorico />} />;

  const aviso = !CANCELAMENTO_COCHO_HABILITADO ? (
    <div role="note" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">{MENSAGEM_ESTORNO_SUSPENSO}</div>
  ) : null;

  return (
    <MolduraHistorico barra={barra} antes={aviso}>
      {eventos.map((evento, index) => {
        const periodoFechado = (evento.dias_periodo || 0) > 0;
        const cabecas = evento.total_cabecas_afetadas || 0;
        const consumoDiarioGrupo = evento.consumo_diario_grupo_kg || 0;
        const consumoCabDia = cabecas > 0 ? safeDivide(consumoDiarioGrupo, cabecas) : 0;
        const consumoEsperadoPV = evento.consumo_esperado_pv_kg || 0;
        const consumoEsperadoCabDia = consumoEsperadoPV > 0 && cabecas > 0 ? consumoEsperadoPV / cabecas : 0;
        const areas = Array.isArray(evento.area_nomes) && evento.area_nomes.length > 0 ? evento.area_nomes.join(", ") : evento.area_nome || "-";
        const pesoMedio = evento.peso_medio_lotes_kg
          ? `${Number(evento.peso_medio_lotes_kg).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
          : "-";

        return (
          <CartaoHistorico
            key={evento.id}
            selos={
              <>
                <SeloHistorico tom="data">{diaDoLancamento(evento.data_lancamento)}</SeloHistorico>
                <SeloHistorico>{periodoFechado ? "Fechado" : "Em aberto"}</SeloHistorico>
                {periodoFechado && consumoEsperadoCabDia > 0 ? <DesvioConsumoTag real={consumoCabDia} esperado={consumoEsperadoCabDia} /> : null}
              </>
            }
            titulo={evento.produto}
            rodape={
              CANCELAMENTO_COCHO_HABILITADO && index === 0 && !bloqueiosPorEvento[evento.id] ? (
                <CancelarLancamentoCocho evento={evento} onCancelado={() => aoCancelar(evento.id)} />
              ) : null
            }
          >
            <LinhaHistorico rotulo="Áreas">{areas}</LinhaHistorico>
            <LinhaHistorico rotulo="Cabeças">{evento.total_cabecas_afetadas || 0}</LinhaHistorico>
            <LinhaHistorico rotulo="Peso médio">{pesoMedio}</LinhaHistorico>
            <LinhaHistorico rotulo="Unidade">{evento.unidade_lancamento || "KG"}</LinhaHistorico>

            {/* Métricas por seção, com a projeção do SSOT no último lançamento (D-PROD-178). */}
            <CardMetricaEvento evento={evento} showProjecao={true} {...(nivel?.evento?.id != null && evento.id === nivel.evento.id ? projecaoDoCartaoDoNivel(nivel) : {})} />

            {evento.observacoes ? <LinhaHistorico rotulo="Observações">{evento.observacoes}</LinhaHistorico> : null}
            {CANCELAMENTO_COCHO_HABILITADO && index === 0 && bloqueiosPorEvento[evento.id] && <div className="text-[10px] text-slate-400">O gado foi movimentado nas áreas deste cocho depois deste lançamento: ele não pode ser cancelado.</div>}
          </CartaoHistorico>
        );
      })}
    </MolduraHistorico>
  );
}
