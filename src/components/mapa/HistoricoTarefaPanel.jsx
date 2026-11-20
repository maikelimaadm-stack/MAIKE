import React, { useEffect, useState } from "react";
import CartaoHistorico, { AcaoHistorico, EstadoHistorico, LinhaHistorico, MolduraHistorico, SeloHistorico, useTituloDoHistorico } from "@/components/lotes/CartaoHistorico";
import { useQueryClient } from "@tanstack/react-query";
import { excluirHistorico } from "@/services/tarefasMapaService";
import { refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import { invalidarCachesDoMapa } from "@/components/mapa/invalidarCachesMapa";
import { toast } from "sonner";
import { confirmarExclusao } from "@/lib/maikeConfirmar";

const SO_O_ULTIMO = "Somente o último histórico pode ser excluído.";
const SEM_CONEXAO = "Sem conexão: a exclusão só é feita com internet.";

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
 *
 * D-PROD-266 (etapa 1): o "Excluir" só aparece com `podeExcluir` — a guarda do
 * servidor (`GUARDAS.tarefa = porAcessoTotal`: administrador real ou `is_admin`),
 * calculada por quem monta; padrão `false`. Sem conexão o botão fica desligado
 * (exclusão é definitiva: nunca vai para a fila offline). Depois de excluir, o
 * evento sai na hora da lista e o cache do mapa (`historicoTarefa`, de onde o
 * detalhe relê) é corrigido e relido do servidor com `force`, como o resto do
 * mapa — antes ele podia voltar da cópia do aparelho por até 60 s.
 * @param {{ tarefaId: any, empresaId?: string | null, tarefaTitulo?: string, historico?: any[], carregando?: boolean, erro?: boolean, causaDoErro?: unknown, onTentarDeNovo?: () => void, podeExcluir?: boolean }} props
 */
export default function HistoricoTarefaPanel({ tarefaId, empresaId = null, tarefaTitulo, historico = [], carregando = false, erro = false, causaDoErro, onTentarDeNovo, podeExcluir = false }) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);
  const semLista = carregando || (erro && historico.length === 0);
  const contagem = semLista ? null : historico.length;
  // D-PROD-118: no diálogo padrão o título (com a contagem) vai para o cabeçalho.
  const noDialogo = useTituloDoHistorico("Histórico da Tarefa", contagem);
  // Fora do diálogo (sem cabeçalho para o título), o título fica na barra.
  const barra = noDialogo ? null : <h3 className="text-sm font-semibold text-slate-900">{`Histórico da Tarefa${contagem != null ? ` (${contagem})` : ""}`}</h3>;

  /**
   * Tira o evento excluído da lista do detalhe e do cache do mapa e relê o
   * cache do servidor (`force`). Falha de cache/rede aqui não desfaz nada: a
   * exclusão já foi confirmada pelo servidor.
   * @param {any} id
   */
  const aposExcluir = async (id) => {
    /** @param {any} lista */
    const semOExcluido = (lista) => (Array.isArray(lista) ? lista : []).filter((h) => h?.id !== id);
    queryClient.setQueryData(["historico-tarefa-detalhe", tarefaId], semOExcluido);
    if (empresaId) {
      try {
        await updateMapaCachedData("historicoTarefa", empresaId, semOExcluido);
      } catch {
        /* cópia do aparelho: conveniência */
      }
      try {
        await refreshMapaCacheEntry("historicoTarefa", empresaId, { force: true });
      } catch {
        /* sem rede: fica a cópia já corrigida acima */
      }
    }
    await invalidarCachesDoMapa(queryClient, ["historico-tarefa-detalhe"]);
  };

  const semRede = () => typeof navigator !== "undefined" && navigator.onLine === false;

  const handleDelete = async (item, index) => {
    if (!podeExcluir) return;
    if (index !== 0) return toast.error("Exclua primeiro o último histórico.");
    if (semRede()) return toast.error(SEM_CONEXAO);
    if (!(await confirmarExclusao("Excluir este histórico da tarefa?"))) return;
    // A rede pode cair com a confirmação aberta: sem conferir de novo, a porta
    // enfileiraria o DELETE (exclusão definitiva é só online).
    if (semRede()) return toast.error(SEM_CONEXAO);

    setDeletingId(item.id);
    try {
      await excluirHistorico(item.id);
      toast.success("Histórico excluído.");
      // A exclusão já valeu: falha ao reler não vira "não foi possível excluir".
      await aposExcluir(item.id).catch(() => {});
    } catch (error) {
      toast.error(error?.message || "Não foi possível excluir o histórico.");
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
              podeExcluir ? (
                <AcaoHistorico
                  destrutiva
                  // Fora da heurística de texto do Layout: a regra é a do servidor (D-PROD-266).
                  data-permissao-explicita=""
                  disabled={index !== 0 || !online || deletingId != null}
                  title={!online ? SEM_CONEXAO : index !== 0 ? SO_O_ULTIMO : undefined}
                  onClick={() => handleDelete(item, index)}
                >
                  Excluir
                </AcaoHistorico>
              ) : null
            }
          >
            <LinhaHistorico rotulo="Evento">{item.evento || "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Responsável">{item.responsavel || "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Descrição">{item.descricao || "-"}</LinhaHistorico>
            <LinhaHistorico rotulo="Hora">{formatDateTimeBR(quando).split(", ")[1] || "-"}</LinhaHistorico>
            {podeExcluir && index !== 0 && <div className="text-[10px] text-slate-400">{SO_O_ULTIMO}</div>}
            {podeExcluir && index === 0 && !online && <div className="text-[10px] text-slate-400">{SEM_CONEXAO}</div>}
          </CartaoHistorico>
        );
      })}
    </MolduraHistorico>
  );
}
