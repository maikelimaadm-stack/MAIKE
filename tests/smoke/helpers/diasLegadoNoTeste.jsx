import React from "react";
import ListaApontamentos from "@/components/lancamento-atividades/ListaApontamentos";

/**
 * SÓ PARA OS TESTES (emenda da D-PROD-252): a tela não mostra mais "dias lançados" — cada linha lançada tem a data dela. O
 * componente `ListaApontamentos` (o lançamento do dia, com o formulário do dia e as linhas dentro dele) segue no código, e os
 * testes antigos continuam cobrindo-o. Este invólucro monta a lista antiga ao lado da `AtividadeAberta` real, fora das abas,
 * para esses testes alcançarem os mesmos componentes. A aplicação NÃO usa este arquivo.
 *
 * @param {React.ComponentType<any>} AtividadeAbertaReal
 */
export const comDiasLegados = (AtividadeAbertaReal) =>
  function AtividadeAbertaComDiasLegados(/** @type {any} */ props) {
    return (
      <>
        <AtividadeAbertaReal {...props} />
        <section data-testid="atividade-dias-legado">
          <ListaApontamentos key={String(props.atividade?.id ?? "")} atividade={props.atividade} acoes={props.acoes} onAtividadeAtualizada={props.onAtividadeAtualizada} titulo="Lançamentos por dia" />
        </section>
      </>
    );
  };
