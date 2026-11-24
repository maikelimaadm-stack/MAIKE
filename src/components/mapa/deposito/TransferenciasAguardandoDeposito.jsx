import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Acao, Cartao, Linha, SecaoDetalhe } from "@/components/mapa/detalhes-lote/blocos";
import { notifyError, notifySuccess } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import { eventosDaFilaDeEnvio } from "@/services/sincronizacaoService";
import {
  descartarTransferenciaAguardando,
  transferenciaAguardandoPodeEditar,
  transferenciasAguardandoDoLocal,
} from "@/services/suplementacaoEstoqueService";

const kg = (n) => `${Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;

/**
 * D-PROD-298 — as entradas e saídas deste depósito feitas sem internet que ainda não subiram,
 * com "Editar" (abre o formulário preenchido) e "Excluir" (sai só do aparelho). Subindo
 * ("confirmando envio") ou recusada ("precisa de atenção"), só mostra a situação.
 *
 * @param {{ deposito: any, produtos: any[], onEditar: (item: any) => void }} props
 */
export default function TransferenciasAguardandoDeposito({ deposito, produtos, onEditar }) {
  const queryClient = useQueryClient();
  const localId = deposito?.local_estoque_id;
  const chave = React.useMemo(() => ["transferencias-aguardando", localId], [localId]);
  const { data: itens = [] } = useQuery({ queryKey: chave, queryFn: () => transferenciasAguardandoDoLocal(localId), enabled: !!localId });

  React.useEffect(() => {
    const recarregar = () => queryClient.invalidateQueries({ queryKey: chave });
    const eventos = eventosDaFilaDeEnvio();
    eventos.forEach((e) => window.addEventListener(e, recarregar));
    return () => eventos.forEach((e) => window.removeEventListener(e, recarregar));
  }, [queryClient, chave]);

  if (!itens.length) return null;

  const nomeDoProduto = (id) => produtos?.find((p) => p.id === id)?.nome_produto || "Produto";

  const atualizar = () => {
    queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && ["transferencias-aguardando", "saldo-deposito", "estoque-lotes-transferencia", "lotes-nota-suplementacao"].includes(q.queryKey[0]),
    });
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["estoqueLotes"] } }));
  };

  const editar = async (item) => {
    try {
      await transferenciaAguardandoPodeEditar(item.operationId);
      onEditar(item);
    } catch (erro) {
      notifyError("Não dá para editar", /** @type {any} */ (erro)?.message);
    }
  };

  const excluir = async (item) => {
    const ok = await confirmar({
      titulo: "Excluir esta transferência?",
      descricao: "Ela ainda não chegou ao sistema e sai só deste celular. Nada vai para o banco.",
      textoConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    try {
      await descartarTransferenciaAguardando(item.operationId);
      atualizar();
      notifySuccess("Transferência excluída");
    } catch (erro) {
      notifyError("Não foi possível excluir", /** @type {any} */ (erro)?.message);
    }
  };

  return (
    <SecaoDetalhe titulo="Aguardando envio" className="mk-dp-deposito__aguardando">
      <Cartao data-testid="transferencias-aguardando">
        {itens.map((item) => (
          <Linha
            key={item.operationId}
            rotulo={`${item.direcao === "entrada" ? "Entrada" : "Saída"} · ${nomeDoProduto(item.produto_id)}`}
            sub={`${kg(item.quantidade)} · ${item.direcao === "entrada" ? `de ${item.local_origem_nome || "outro local"}` : `para ${item.local_destino_nome || "outro local"}`}`}
            valor={
              item.confirmando ? (
                <span className="mk-dp-c13-chip">confirmando envio</span>
              ) : item.atencao ? (
                <span className="mk-dp-c13-chip">precisa de atenção</span>
              ) : (
                <>
                  <Acao onClick={() => editar(item)} aria-label="Editar a transferência que aguarda envio">Editar</Acao>
                  <Acao tom="perigo" onClick={() => excluir(item)} aria-label="Excluir a transferência que aguarda envio">Excluir</Acao>
                </>
              )
            }
          />
        ))}
      </Cartao>
    </SecaoDetalhe>
  );
}
