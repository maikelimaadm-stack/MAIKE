import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { excluirHistorico } from "@/services/bebedouroDataService";
import { confirmarExclusao } from "@/lib/maikeConfirmar";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import CartaoHistorico, { EstadoHistorico, LinhaHistorico, MolduraHistorico, SeloHistorico, useTituloDoHistorico } from "@/components/lotes/CartaoHistorico";
import { cn } from "@/lib/utils";
import { diaDoLancamento, linhasDoLancamento, statusForaDoNormal } from "./cartoesDoBebedouro";

// A regra é a ordem de cadastro (a do servidor), não a data do lançamento: um
// retroativo lançado por último é o primeiro da lista, mesmo com data antiga.
const SO_O_ULTIMO = "Só o primeiro da lista (o último lançado no sistema) pode ser excluído.";
const TITULO = "Histórico do Bebedouro";

/** Status fora do normal → tom do selo: pendente é alerta (âmbar); emergencial, urgência (vermelho). */
const TOM_DO_STATUS = /** @type {Record<string, "ambar" | "vermelho">} */ ({ Pendente: "ambar", Emergencial: "vermelho" });

/**
 * Histórico completo do bebedouro, no desenho dos históricos do manejo
 * (D-PROD-221, o do Histórico de Movimentação): abre num `LancLoteDialogo`
 * largo e só de leitura por cima do detalhe; o título com a contagem vai para o
 * cabeçalho do diálogo ("Histórico do Bebedouro (N)"); cada lançamento é um
 * `CartaoHistorico`, NA ORDEM DO SERVIDOR: selos de data ("dd/mm/aaaa"), tipo e
 * status fora do normal; o bebedouro em negrito; as linhas "Rótulo: valor" de
 * antes (`linhasDoLancamento`, com a hora quando gravada); o "Excluir" no rodapé
 * do cartão. Sem rolagem própria: o diálogo é quem rola.
 *
 * Regras de antes: só o último lançado no sistema (índice 0 da ordem do
 * servidor, por criação) é excluível — o servidor recusa os demais (409) e o
 * "Excluir" deles fica desligado, com a regra no `title`. D-PROD-137 (BEB-01):
 * "Excluir" só com `podeExcluir` (a regra do servidor, calculada por quem monta;
 * padrão `false`), fora da heurística de texto do Layout
 * (`data-permissao-explicita`), e a recusa do servidor vira mensagem.
 *
 * `carregando` e `erro` (sem cópia da lista): o estado no lugar da lista, sem
 * "Nenhum lançamento encontrado." nem contagem.
 *
 * @param {{ historico?: any[], podeExcluir?: boolean, carregando?: boolean, erro?: boolean, bebedouroNome?: string }} props
 */
export default function BebedouroTimeline({ historico = [], podeExcluir = false, carregando = false, erro = false, bebedouroNome = "" }) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);
  const lista = Array.isArray(historico) ? historico : [];
  const contagem = carregando || erro ? null : lista.length;
  // Dentro do `LancLoteDialogo` o título (com a contagem) vai para o cabeçalho.
  const noDialogo = useTituloDoHistorico(TITULO, contagem);
  // Fora do diálogo (sem cabeçalho para o título), o título fica na barra.
  const barra = noDialogo ? null : <h3 className="text-sm font-semibold text-slate-900">{`${TITULO}${contagem ? ` (${contagem})` : ""}`}</h3>;

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

  if (carregando) return <MolduraHistorico barra={barra} estado={<EstadoHistorico tipo="carregando" />} />;
  if (erro) return <MolduraHistorico barra={barra} estado={<EstadoHistorico tipo="erro" />} />;
  if (!lista.length) return <MolduraHistorico barra={barra} estado={<EstadoHistorico>Nenhum lançamento encontrado.</EstadoHistorico>} />;

  return (
    <MolduraHistorico barra={barra}>
      {lista.map((item, index) => {
        const status = statusForaDoNormal(item);
        const ligado = index === 0 && deletingId !== item.id;
        return (
          <CartaoHistorico
            key={String(item?.id ?? `lancamento-${index}`)}
            data-testid="lancamento-bebedouro"
            selos={
              <>
                <SeloHistorico tom="data">{diaDoLancamento(item?.data_lancamento)}</SeloHistorico>
                <SeloHistorico>{item?.tipo_lancamento || "Lançamento"}</SeloHistorico>
                {status ? <SeloHistorico tom={TOM_DO_STATUS[status] || "neutro"}>{status}</SeloHistorico> : null}
              </>
            }
            titulo={bebedouroNome || undefined}
            rodape={
              podeExcluir ? (
                // O botão do "Excluir movimentação" do manejo: contorno, texto vermelho quando ligado.
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn("h-8 text-xs", ligado ? "text-red-700" : "text-slate-500")}
                  // Fora da heurística de texto do Layout: a regra é a do servidor (D-PROD-137).
                  data-permissao-explicita=""
                  disabled={!ligado}
                  title={index !== 0 ? SO_O_ULTIMO : undefined}
                  onClick={() => handleDelete(item, index)}
                >
                  Excluir
                </Button>
              ) : null
            }
          >
            {linhasDoLancamento(item, { comHora: true, comStatus: false }).map((linha) => (
              <LinhaHistorico key={linha.rotulo} rotulo={linha.rotulo}>
                {linha.valor}
              </LinhaHistorico>
            ))}
          </CartaoHistorico>
        );
      })}
    </MolduraHistorico>
  );
}
