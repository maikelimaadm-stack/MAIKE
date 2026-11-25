import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Acao } from "@/components/mapa/detalhes-lote/blocos";
import { notifyError, notifySuccess } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import {
  dependentesDoLancamentoAguardando,
  excluirLancamentoAguardando,
  lancamentoAguardandoParaEditar,
} from "@/services/suplementacaoService";
import { updateMapaCachedData } from "@/services/mapaCacheService";

/**
 * D-PROD-298 — o lançamento feito sem internet que ainda não subiu: "Editar" (abre o formulário
 * preenchido; salvar o substitui na fila, na mesma posição) e "Excluir" (sai só do aparelho; a baixa
 * do depósito vai junto, porque ainda não foi feita). Nada disso vai ao servidor nem deixa rastro.
 *
 * @param {{ evento: any, onEditar: (edicao: { operationId: string, payload: any }) => void }} props
 */
export default function AcoesDoLancamentoAguardando({ evento, onEditar }) {
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = React.useState(false);

  const editar = async () => {
    setOcupado(true);
    try {
      onEditar(await lancamentoAguardandoParaEditar(evento));
    } catch (erro) {
      notifyError("Não dá para editar", /** @type {any} */ (erro)?.message);
    } finally {
      setOcupado(false);
    }
  };

  const excluir = async () => {
    // D-PROD-311: só o último lançamento do cocho sai. Com um seguinte (que depende deste),
    // a pessoa exclui primeiro o mais recente — senão ele ficaria órfão ao voltar a internet.
    const dependentes = await dependentesDoLancamentoAguardando(evento);
    if (dependentes.length) {
      notifyError(
        "Exclua primeiro o lançamento mais recente",
        `Só o último lançamento deste cocho pode ser excluído. Exclua antes: ${dependentes.map((d) => d.rotulo).join("; ")}.`
      );
      return;
    }
    const ok = await confirmar({
      titulo: "Excluir este lançamento?",
      descricao: "Ele ainda não chegou ao sistema e sai só deste celular. Nada vai para o banco.",
      textoConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    setOcupado(true);
    try {
      await excluirLancamentoAguardando(evento);
      await updateMapaCachedData("eventosSuplementacao", evento.empresa_id, (itens) => (itens || []).filter((i) => i?.id !== evento.id));
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (["ultimo-evento-ponto", "eventos-recentes-ponto", "eventos-ponto", "lotes-nota-suplementacao", "saldo-deposito", "mapa-eventosSuplementacao"].includes(q.queryKey[0]) ||
            (q.queryKey[0] === "mapa-cache" && ["eventosSuplementacao", "estoqueLotes"].includes(q.queryKey[1]))),
      });
      window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["eventosSuplementacao", "estoqueLotes"] } }));
      notifySuccess("Lançamento excluído");
    } catch (erro) {
      notifyError("Não foi possível excluir", /** @type {any} */ (erro)?.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <span className="mk-dp-c13-chip" data-testid="lancamento-aguardando-envio">aguardando envio</span>
      <Acao onClick={editar} disabled={ocupado} aria-label="Editar o lançamento que aguarda envio">
        Editar
      </Acao>
      <Acao tom="perigo" onClick={excluir} disabled={ocupado} aria-label="Excluir o lançamento que aguarda envio">
        Excluir
      </Acao>
    </>
  );
}
