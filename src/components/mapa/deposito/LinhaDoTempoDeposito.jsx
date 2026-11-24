import React from "react";
import "@/styles/mk-dp-historico.css";
import "@/styles/mk-dp-tl-acoes.css";
import "@/styles/mk-dp-deposito-v13.css";

/**
 * Linha do tempo do DEPÓSITO no desenho v13: o mesmo trilho com um ponto por dia da linha do
 * tempo do Detalhes do Lote, com o cartão curto (`mk-dp-tl--curto`) próprio do depósito —
 * título ("Entrada no depósito" / "Saída do depósito") e, embaixo, o produto com a origem ou o
 * destino; à direita a quantidade com sinal ("+1.000 kg" verde, "−400 kg" vermelho) e os sacos.
 * As observações continuam como linha; a ação "Excluir transferência" (D-PROD-268) fica no pé.
 * Os cartões chegam prontos de `cartaoDaMovimentacao` (campo `curto`).
 *
 * @param {{ dias: Array<{ chave: string, rotulo: string, cartoes: Array<any> }>, rotulo?: string }} props
 */
export default function LinhaDoTempoDeposito({ dias, rotulo = "Histórico do depósito" }) {
  const lista = Array.isArray(dias) ? dias : [];
  return (
    <ol className="mk-dp-tl mk-dp-tl--curto mk-dp-dep13__tl" aria-label={rotulo}>
      {lista.map((dia) => (
        <li key={dia.chave} className="mk-dp-tl__grupo">
          <h3 className="mk-dp-tl__dia">
            <span className="mk-dp-tl__ponto" aria-hidden="true" />
            {dia.rotulo}
          </h3>
          <ul className="mk-dp-tl__cartoes">
            {dia.cartoes.map((c) => {
              const Icone = c.Icone;
              const k = c.curto;
              return (
                <li key={c.chave} className="mk-dp-tl__card mk-dp-tl__card--curto">
                  <div className="mk-dp-tl__cab">
                    {Icone ? <Icone className="mk-dp-tl__ic" size={20} aria-hidden="true" /> : null}
                    <div className="mk-dp-tl__quem">
                      <strong className="mk-dp-tl__titulo">{c.titulo}</strong>
                      <span className="mk-dp-tl__lote">{k.resumo}</span>
                    </div>
                    <span className="mk-dp-tl__qtd" data-tom={k.tom}>
                      <span className="mk-dp-tl__sr">{k.rotuloQuantidade}</span>
                      <span aria-hidden="true">{k.quantidade}</span>
                      {k.sacos ? (
                        <span className="mk-dp-dep13__qtd-sub" aria-hidden="true">
                          {k.sacos}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {k.resto.length ? (
                    <dl className="mk-dp-tl__linhas">
                      {k.resto.map((l, i) => (
                        <div key={`${l.rotulo}-${i}`} className="mk-dp-tl__row mk-dp-tl__row--larga">
                          <dt>{l.rotulo}</dt>
                          <dd>{l.valor}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {c.acoes != null && c.acoes !== false ? <div className="mk-dp-tl__acoes">{c.acoes}</div> : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
