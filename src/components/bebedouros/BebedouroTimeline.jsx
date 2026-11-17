import React, { useState } from "react";
import { History } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { excluirHistorico } from "@/services/bebedouroDataService";
import { confirmarExclusao } from "@/lib/maikeConfirmar";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import { Acao, TituloBloco, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { diasDoHistorico } from "./cartoesDoBebedouro";

// A regra é a ordem de cadastro (a do servidor), não a data do lançamento: um
// retroativo lançado por último é o primeiro da lista, mesmo com data antiga.
const SO_O_ULTIMO = "Só o primeiro da lista (o último lançado no sistema) pode ser excluído.";

/**
 * Histórico completo do bebedouro (tela empilhada do detalhe), no desenho do
 * Detalhes do Lote v12 (D-PROD-220): a linha do tempo com os MESMOS cartões do
 * resumo, mais a hora, em ORDEM DO SERVIDOR, e a contagem em "Lançamentos (N)".
 * Sem rolagem própria: o corpo da casca é a única área que rola.
 *
 * Regras de antes: só o último lançado no sistema (índice 0 da ordem do
 * servidor, por criação) é excluível — o servidor recusa os demais (409) e o
 * "Excluir" deles fica desligado. D-PROD-137 (BEB-01): "Excluir" só com
 * `podeExcluir` (a regra do servidor, calculada por quem monta; padrão `false`)
 * e a recusa do servidor vira mensagem — antes a rejeição ficava sem tratamento
 * e o botão travado.
 *
 * @param {{ historico?: any[], podeExcluir?: boolean }} props
 */
export default function BebedouroTimeline({ historico = [], podeExcluir = false }) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (item, index) => {
    if (index !== 0 || !podeExcluir) return;
    if (!(await confirmarExclusao("Excluir este lançamento do bebedouro?"))) return;
    setDeletingId(item.id);
    try {
      await excluirHistorico(item.id);
    } catch (error) {
      // 409 do servidor: entrou um lançamento mais novo depois que a lista foi lida.
      const somenteUltimo = /** @type {any} */ (error)?.cause?.code === "BEBEDOUROHISTORICO_SOMENTE_ULTIMO";
      toast.error(somenteUltimo
        ? "Há um lançamento mais recente deste bebedouro: só o último pode ser excluído. Nada foi apagado; a lista foi atualizada."
        : getApiErrorMessage(error, "Não foi possível excluir o lançamento. Nada foi apagado."));
    } finally {
      // Sucesso ou recusa (ex.: outro lançamento entrou depois): relê a lista do servidor.
      queryClient.invalidateQueries({ queryKey: ["bebedouro-historico"] });
      // A lista da tela Bebedouros (status, alertas, custos) lê outra chave: o
      // prefixo acima não a cobre. Mesmo par de chaves que o "Lançar" invalida.
      queryClient.invalidateQueries({ queryKey: ["bebedouro-historico-all"] });
      setDeletingId(null);
    }
  };

  if (!historico.length) return <Vazio icone={History}>Nenhum lançamento encontrado.</Vazio>;

  const dias = diasDoHistorico(historico, {
    comHora: true,
    acoes: podeExcluir
      ? (item, index) => (
          <Acao
            tom="perigo"
            // Fora da heurística de texto do Layout: a regra é a do servidor (D-PROD-137).
            data-permissao-explicita=""
            disabled={index !== 0 || deletingId === item.id}
            title={index !== 0 ? SO_O_ULTIMO : undefined}
            onClick={() => handleDelete(item, index)}
          >
            Excluir
          </Acao>
        )
      : null,
  });

  return (
    <>
      <TituloBloco>{`Lançamentos (${historico.length})`}</TituloBloco>
      <LinhaDoTempo dias={dias} rotulo="Lançamentos do bebedouro" />
    </>
  );
}
