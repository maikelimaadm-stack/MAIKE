import React, { useState } from "react";
import CartaoHistorico, { AcaoHistorico, EstadoHistorico, LinhaHistorico, MolduraHistorico, SeloHistorico, useTituloDoHistorico } from "@/components/lotes/CartaoHistorico";
import { useQueryClient } from "@tanstack/react-query";
import { excluirHistorico } from "@/services/tarefasMapaService";
import { toast } from "sonner";
import { confirmarExclusao } from "@/lib/maikeConfirmar";

const formatDateBR = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
};

const formatDateTimeBR = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
};

/**
 * Histórico completo da tarefa ("Ver histórico" do detalhe da tarefa).
 * D-PROD-222: no desenho do histórico do manejo (o do Histórico de
 * Movimentação): dentro do `LancLoteDialogo` o título com a contagem vai para o
 * cabeçalho (D-PROD-118); cada evento é um `CartaoHistorico` (selos de data e
 * status, a tarefa em negrito, as linhas "Rótulo: valor") com o "Excluir" no
 * rodapé. Só o mais recente (índice 0) é excluível, como antes.
 * `carregando` e `erro` (a consulta é do detalhe da tarefa): os estados do
 * Histórico de Movimentação, em vez de "Nenhum histórico encontrado." — o erro
 * com o motivo (`causaDoErro`) e o "Tentar novamente" (`onTentarDeNovo`).
 * @param {{ tarefaId: any, tarefaTitulo?: string, historico?: any[], carregando?: boolean, erro?: boolean, causaDoErro?: unknown, onTentarDeNovo?: () => void }} props
 */
export default function HistoricoTarefaPanel({ tarefaId, tarefaTitulo, historico = [], carregando = false, erro = false, causaDoErro, onTentarDeNovo }) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);
  const semLista = carregando || (erro && historico.length === 0);
  const contagem = semLista ? null : historico.length;
  // D-PROD-118: no diálogo padrão o título (com a contagem) vai para o cabeçalho.
  const noDialogo = useTituloDoHistorico("Histórico da Tarefa", contagem);
  // Fora do diálogo (sem cabeçalho para o título), o título fica na barra.
  const barra = noDialogo ? null : <h3 className="text-sm font-semibold text-slate-900">{`Histórico da Tarefa${contagem != null ? ` (${contagem})` : ""}`}</h3>;

  const handleDelete = async (item, index) => {
    if (index !== 0) return toast.error("Exclua primeiro o último histórico.");
    if (!(await confirmarExclusao("Excluir este histórico da tarefa?"))) return;

    setDeletingId(item.id);
    try {
      await excluirHistorico(item.id);
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", tarefaId] });
      toast.success("Histórico excluído.");
    } catch (error) {
      toast.error(error.message || "Não foi possível excluir o histórico.");
    } finally {
      setDeletingId(null);
    }
  };

  if (carregando) return <MolduraHistorico barra={barra} estado={<EstadoHistorico tipo="carregando" />} />;
  if (erro && historico.length === 0) {
    return <MolduraHistorico barra={barra} estado={<EstadoHistorico tipo="erro" erro={causaDoErro} onTentarDeNovo={onTentarDeNovo} />} />;
  }
  if (historico.length === 0) return <MolduraHistorico barra={barra} estado={<EstadoHistorico>Nenhum histórico encontrado.</EstadoHistorico>} />;

  return (
    <MolduraHistorico barra={barra}>
      {historico.map((item, index) => {
        const quando = item.data_evento || item.created_date;
        return (
          <CartaoHistorico
            key={item.id}
            selos={
              <>
                <SeloHistorico tom="data">{formatDateBR(quando)}</SeloHistorico>
                {item.status ? <SeloHistorico>{item.status}</SeloHistorico> : null}
              </>
            }
            titulo={tarefaTitulo}
            rodape={
              <AcaoHistorico destrutiva disabled={index !== 0 || deletingId === item.id} onClick={() => handleDelete(item, index)}>
                Excluir
              </AcaoHistorico>
            }
          >
            <LinhaHistorico rotulo="Evento">{item.evento || "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Responsável">{item.responsavel || "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Descrição">{item.descricao || "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Hora">{formatDateTimeBR(quando).split(", ")[1] || "-"}</LinhaHistorico>
            {index !== 0 && <div className="text-[10px] text-slate-400">Somente o último histórico pode ser excluído.</div>}
          </CartaoHistorico>
        );
      })}
    </MolduraHistorico>
  );
}
