import React from "react";
import { useQuery } from "@tanstack/react-query";
import { listarTodasMovimentacoes } from "@/services/loteManejoService";
import ExcluirMovimentacao from "@/components/lotes/ExcluirMovimentacao";
import CartaoHistorico, { EstadoHistorico, LinhaHistorico, MolduraHistorico, SeloHistorico } from "@/components/lotes/CartaoHistorico";
import { TituloBloco } from "@/components/mapa/detalhes-lote/blocos";
import { ehMovimentoCancelado, tipoTemExclusao } from "@/domain/lotes/situacaoMovimento";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

function formatDateOnly(value) {
  const raw = String(value || "");
  if (!raw) return "-";
  const datePart = raw.includes("T") ? raw.split("T")[0] : raw;
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return new Date(value).toLocaleDateString("pt-BR");
  return `${day}/${month}/${year}`;
}

/**
 * Histórico de Abate do curral (aba "Abate" do detalhe da área).
 * D-PROD-222: os cartões são os do Histórico de Movimentação do manejo
 * (`CartaoHistorico`): selos de data, tipo e situação, o lote em negrito, as
 * linhas "Rótulo: valor" e o "Excluir movimentação" no rodapé. Sem rolagem
 * própria: o corpo do detalhe é a única área que rola (D-PROD-220).
 * No mapa só existe exclusão: o abate com `situacao: 'cancelado'` (mecanismo
 * antigo R2A, D-PROD-99) não aparece aqui; o dado segue no banco e na auditoria.
 * @param {{ areaId: string }} props
 */
export default function HistoricoAbateCurral({ areaId }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  // A ação do cartão é a exclusão definitiva do servidor (D-PROD-110).
  const { data: historico = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["historico-abate-curral", areaId, empresaSelecionadaId],
    queryFn: async () => {
      const movimentacoes = await listarTodasMovimentacoes();
      return movimentacoes
        .filter((mov) => mov.empresa_id === empresaSelecionadaId)
        .filter((mov) => mov.tipo === "Abate")
        .filter((mov) => mov.area_origem_id === areaId || mov.area_destino_id === areaId)
        // Registro antigo cancelado (R2A) não aparece no mapa: lá só existe exclusão.
        .filter((mov) => !ehMovimentoCancelado(mov))
        .map((mov) => ({
          id: mov.id,
          data: mov.data_movimentacao,
          lote: mov.lote,
          quantidade: mov.quantidade_animais,
          peso_medio: mov.peso_medio,
          destino: mov.destino_venda,
          observacoes: mov.observacoes,
          raw: mov,
        }));
    },
    enabled: !!areaId && !!empresaSelecionadaId,
  });

  const titulo = <TituloBloco>{`Histórico de Abate${!isLoading && historico.length > 0 ? ` (${historico.length})` : ""}`}</TituloBloco>;

  // Erro: o estado de erro do Histórico de Movimentação (não "nenhum abate").
  if (isError && historico.length === 0) {
    return (
      <>
        {titulo}
        <MolduraHistorico estado={<EstadoHistorico tipo="erro" erro={error} onTentarDeNovo={() => refetch()} />} />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        {titulo}
        <MolduraHistorico estado={<EstadoHistorico tipo="carregando" />} />
      </>
    );
  }

  if (historico.length === 0) {
    return (
      <>
        {titulo}
        <MolduraHistorico estado={<EstadoHistorico>Nenhum abate encontrado</EstadoHistorico>} />
      </>
    );
  }

  return (
    <>
      {titulo}
      <MolduraHistorico>
        {historico.map((item) => (
          <CartaoHistorico
            key={item.id}
            selos={
              <>
                <SeloHistorico tom="data">{formatDateOnly(item.data)}</SeloHistorico>
                <SeloHistorico>Abate</SeloHistorico>
              </>
            }
            titulo={item.lote || "Sem lote"}
            // Como no Histórico de Movimentação: o rodapé só existe para o abate que tem exclusão (do
            // ledger). Sem isso, o abate antigo ficava com uma faixa vazia no pé do cartão.
            rodape={tipoTemExclusao(item.raw) ? <ExcluirMovimentacao movimento={item.raw} /> : null}
          >
            {!!item.quantidade && <LinhaHistorico rotulo="Quantidade">{item.quantidade} cab</LinhaHistorico>}
            <LinhaHistorico rotulo="Data">{formatDateOnly(item.data)}</LinhaHistorico>
            {!!item.peso_medio && <LinhaHistorico rotulo="Peso médio">{item.peso_medio} kg</LinhaHistorico>}
            {!!item.destino && <LinhaHistorico rotulo="Destino">{item.destino}</LinhaHistorico>}
            {!!item.observacoes && <LinhaHistorico rotulo="Detalhes">{item.observacoes}</LinhaHistorico>}
          </CartaoHistorico>
        ))}
      </MolduraHistorico>
    </>
  );
}
