import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CartaoHistorico, { AcaoHistorico, EstadoHistorico, LinhaHistorico, MolduraHistorico, SeloHistorico, useTituloDoHistorico } from "@/components/lotes/CartaoHistorico";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { excluirTransferenciaDeposito } from "@/services/suplementacaoHistoricoService";
import { formatKg } from "./formatters";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO, MENSAGEM_ESTORNO_SUSPENSO } from "@/domain/estornos/politicaEstorno";
import { confirmarExclusao } from "@/lib/maikeConfirmar";

function formatObsKgPtBR(obs) {
  if (!obs) return "";
  return obs.replace(/([\d]+)\.([\d]+)\s*kg/g, (match, intPart, decPart) => {
    const num = parseFloat(`${intPart}.${decPart}`);
    return num.toLocaleString("pt-BR", { minimumFractionDigits: decPart.length, maximumFractionDigits: decPart.length }) + " kg";
  });
}

function getLabelTipoDetalhado(tipo) {
  const map = {
    transferencia_recebida: "Entrada (transferência)",
    transferencia_enviada: "Saída (transferência)",
    suplementacao: "Saída (suplementação)",
  };
  return map[tipo] || tipo || "-";
}

/**
 * Movimentações do histórico do depósito, da mais nova para a mais antiga.
 *
 * Entram as da empresa que tocam o local de estoque do depósito, menos as
 * reversões; cada lado de uma transferência (e a baixa da suplementação) só
 * aparece no depósito certo — a saída na origem, a entrada no destino —,
 * porque o par da transferência grava origem e destino nas DUAS linhas.
 * Ordem: o registro criado por último primeiro (`created_date`); empate, a
 * data da movimentação.
 *
 * Pura, para a linha do tempo do detalhe do depósito (D-PROD-220) mostrar o
 * começo deste mesmo histórico, com a mesma regra.
 *
 * @param {any[] | null | undefined} movimentacoes
 * @param {{ empresaId: string | null | undefined, localEstoqueId: string | null | undefined }} filtro
 * @returns {any[]}
 */
export function movimentacoesDoHistoricoDeposito(movimentacoes, { empresaId, localEstoqueId }) {
  return (Array.isArray(movimentacoes) ? movimentacoes : [])
    .filter((item) => {
      if (item.empresa_id !== empresaId) return false;
      if (item.origem_sistema === "reversao") return false;
      if (item.tipo_detalhado === "ajuste_positivo" && String(item.observacoes || "").includes("Reversão do lançamento do cocho")) return false;

      const isOrigin = item.local_estoque_origem === localEstoqueId;
      const isDestination = item.local_estoque_destino === localEstoqueId;

      if (!isOrigin && !isDestination) return false;

      if (item.tipo_detalhado === "transferencia_enviada" && !isOrigin) return false;
      if (item.tipo_detalhado === "transferencia_recebida" && !isDestination) return false;
      if (item.tipo_detalhado === "suplementacao" && !isOrigin) return false;

      return true;
    })
    .sort((a, b) => {
      const createdDiff = new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime();
      if (createdDiff !== 0) return createdDiff;
      return new Date(b.data_movimentacao || 0).getTime() - new Date(a.data_movimentacao || 0).getTime();
    });
}

/** @param {any} valor */
const moeda = (valor) => (valor != null ? Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "-");

/**
 * Histórico do depósito (movimentações do local de estoque, pela regra de
 * `movimentacoesDoHistoricoDeposito`).
 *
 * D-PROD-222: no desenho do histórico do manejo (o do Histórico de
 * Movimentação): dentro do `LancLoteDialogo` o título com a contagem vai para o
 * cabeçalho do diálogo, sem cartão em volta; cada movimentação é um
 * `CartaoHistorico` (selos de data e tipo, o produto em negrito e as linhas
 * "Rótulo: valor"). Regras, consultas e a política de estorno (D-PROD-94a) não
 * mudam.
 *
 * @param {{ deposito: any }} props
 */
export default function HistoricoDepositoSuplementacao({ deposito }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ["historico-deposito", deposito.id],
    queryFn: async () => {
      const depositoLocalId = deposito.local_estoque_id;

      const applyFilter = (all) => movimentacoesDoHistoricoDeposito(all, { empresaId: empresaSelecionadaId, localEstoqueId: depositoLocalId });

      const cached = await getMapaCachedData('movimentacaoEstoque', empresaSelecionadaId);
      
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('movimentacaoEstoque', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(["historico-deposito", deposito.id], applyFilter(fresh));
          });
          return applyFilter(cached);
        } else {
          const fresh = await refreshMapaCacheEntry('movimentacaoEstoque', empresaSelecionadaId);
          return applyFilter(fresh);
        }
      }
      return applyFilter(cached || []);
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
  });

  const handleDelete = async (movimentacao, index) => {
    // Fail-closed (D-PROD-94a): reversão de transferência em várias chamadas do
    // navegador, sem transação. Nenhuma chamada sai daqui enquanto suspensa.
    if (!CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO) return toast.info(MENSAGEM_ESTORNO_SUSPENSO);
    if (index !== 0) return toast.error("Exclua primeiro o último lançamento.");
    if (!["transferencia_recebida", "transferencia_enviada"].includes(movimentacao.tipo_detalhado)) {
      return toast.error("Lançamento de nutrição não é cancelado pelo histórico do depósito.");
    }
    if (!(await confirmarExclusao("Excluir este lançamento e reverter a transferência?"))) return;

    setDeletingId(movimentacao.id);
    try {
      await excluirTransferenciaDeposito({ movimentacao });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["historico-deposito", "saldo-deposito", "movimentacoes-deposito-detalhe", "estoque-lotes-transferencia", "mapa-estoque-lotes", "movimentacoes"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Transferência excluída.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível excluir."));
    } finally {
      setDeletingId(null);
    }
  };

  const contagem = isLoading ? null : movimentacoes.length;
  const noDialogo = useTituloDoHistorico("Histórico do Depósito", contagem);
  // Fora do diálogo (sem cabeçalho para o título), o título fica na barra.
  const barra = noDialogo ? null : <h3 className="text-sm font-semibold text-slate-900">{`Histórico do Depósito${contagem != null ? ` (${contagem})` : ""}`}</h3>;

  if (isLoading) return <MolduraHistorico barra={barra} estado={<EstadoHistorico tipo="carregando" />} />;

  if (movimentacoes.length === 0) return <MolduraHistorico barra={barra} estado={<EstadoHistorico>Nenhum registro encontrado</EstadoHistorico>} />;

  const aviso = !CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO ? (
    <div role="note" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">{MENSAGEM_ESTORNO_SUSPENSO}</div>
  ) : null;

  return (
    <MolduraHistorico barra={barra} antes={aviso}>
      {movimentacoes.map((movimentacao, index) => {
        const ehNutricao = movimentacao.tipo_detalhado === "suplementacao" || movimentacao.exclusao_somente_em === "cocho";
        const ehMovimentoDeposito = movimentacao.origem_sistema === "deposito" || movimentacao.exclusao_somente_em === "deposito" || ["transferencia_recebida", "transferencia_enviada"].includes(movimentacao.tipo_detalhado);

        const dataRaw = movimentacao.data_movimentacao || "";
        const dataDisplay = dataRaw.includes("T")
          ? dataRaw.split("T")[0].split("-").reverse().join("/")
          : new Date(dataRaw).toLocaleDateString("pt-BR");

        const destinoLabel = movimentacao.tipo_detalhado === "suplementacao"
          ? "Suplementação"
          : (movimentacao.local_destino || "-");

        return (
          <CartaoHistorico
            key={movimentacao.id}
            selos={
              <>
                <SeloHistorico tom="data">{dataDisplay}</SeloHistorico>
                <SeloHistorico>{getLabelTipoDetalhado(movimentacao.tipo_detalhado)}</SeloHistorico>
              </>
            }
            titulo={movimentacao.produto_nome}
            rodape={
              CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO ? (
                <AcaoHistorico destrutiva disabled={index !== 0 || deletingId === movimentacao.id || !ehMovimentoDeposito} onClick={() => handleDelete(movimentacao, index)}>
                  Excluir
                </AcaoHistorico>
              ) : null
            }
          >
            <LinhaHistorico rotulo="Quantidade kg">{formatKg(movimentacao.quantidade || 0)}</LinhaHistorico>
            <LinhaHistorico rotulo="Unidade">{movimentacao.unidade_medida || "KG"}</LinhaHistorico>
            <LinhaHistorico rotulo="Origem">{movimentacao.local_origem || movimentacao.local_estoque_origem || "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Destino">{destinoLabel}</LinhaHistorico>
            <LinhaHistorico rotulo="Saldo antes">{movimentacao.saldo_antes != null ? formatKg(movimentacao.saldo_antes) : "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Saldo depois">{movimentacao.saldo_depois != null ? formatKg(movimentacao.saldo_depois) : "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Valor total">{moeda(movimentacao.valor_total)}</LinhaHistorico>
            <LinhaHistorico rotulo="Custo médio">{moeda(movimentacao.custo_medio_depois)}</LinhaHistorico>
            {movimentacao.observacoes ? <LinhaHistorico rotulo="Observações">{formatObsKgPtBR(movimentacao.observacoes)}</LinhaHistorico> : null}
            {CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO && index !== 0 && <div className="text-[10px] text-slate-400">Somente o último lançamento pode ser excluído.</div>}
            {ehNutricao && <div className="text-[10px] text-slate-400">Lançamento de nutrição: consulta apenas; o cancelamento está temporariamente suspenso.</div>}
          </CartaoHistorico>
        );
      })}
    </MolduraHistorico>
  );
}
