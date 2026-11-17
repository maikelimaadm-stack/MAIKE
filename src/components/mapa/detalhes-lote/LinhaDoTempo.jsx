import React from "react";
import { ArrowRightLeft, Baby, CircleX, Combine, History, Package, Scale, Tags, Truck } from "lucide-react";
import { Chip } from "./blocos";
import "@/styles/mk-dp-historico.css";

/*
 * Linha do tempo do Detalhes do Lote v12 (aba Histórico, D-PROD-217): trilho
 * à esquerda, um ponto azul por dia ("09 NOV. 2026") e, embaixo, os cartões do
 * dia — cabeçalho com ícone teal e título, linhas rótulo/valor. Só desenho:
 * os cartões chegam prontos de `historicoDoPasto.js`. Visual em
 * src/styles/mk-dp-historico.css, sob a raiz `.mk-dp`.
 *
 * Marcação: ol.mk-dp-tl > li.mk-dp-tl__grupo > h3.mk-dp-tl__dia(> span.mk-dp-tl__ponto)
 *           + ul.mk-dp-tl__cartoes > li.mk-dp-tl__card(.is-cancelado)
 *             > div.mk-dp-tl__cab(> svg.mk-dp-tl__ic + strong + .mk-dp-chip) + dl.mk-dp-tl__linhas > div.mk-dp-tl__row > dt + dd
 */

/** @typedef {import("./historicoDoPasto").DiaHistorico} DiaHistorico */
/** @typedef {import("./historicoDoPasto").IconeHistorico} IconeHistorico */

/** @type {Record<IconeHistorico, import("lucide-react").LucideIcon>} */
const ICONES = {
  movimentacao: ArrowRightLeft,
  pesagem: Scale,
  nascimento: Baby,
  morte: CircleX,
  saida: Truck,
  mudanca: Tags,
  juncao: Combine,
  suplementacao: Package,
  registro: History,
};

/**
 * @param {{ dias: DiaHistorico[], rotulo?: string }} props
 */
export default function LinhaDoTempo({ dias, rotulo = "Registros do pasto" }) {
  const lista = Array.isArray(dias) ? dias : [];
  return (
    <ol className="mk-dp-tl" aria-label={rotulo}>
      {lista.map((dia) => (
        <li key={dia.chave} className="mk-dp-tl__grupo">
          <h3 className="mk-dp-tl__dia">
            <span className="mk-dp-tl__ponto" aria-hidden="true" />
            {dia.rotulo}
          </h3>
          <ul className="mk-dp-tl__cartoes">
            {dia.cartoes.map((c) => {
              const Icone = ICONES[c.icone] ?? History;
              return (
                <li key={c.chave} className={c.cancelado ? "mk-dp-tl__card is-cancelado" : "mk-dp-tl__card"}>
                  <div className="mk-dp-tl__cab">
                    <Icone className="mk-dp-tl__ic" size={22} aria-hidden="true" />
                    <strong className="mk-dp-tl__titulo">{c.titulo}</strong>
                    {c.cancelado ? (
                      <Chip tom="neutro" className="mk-dp-tl__chip">
                        Cancelado
                      </Chip>
                    ) : null}
                  </div>
                  <dl className="mk-dp-tl__linhas">
                    {c.linhas.map((l, i) => (
                      <div key={`${l.rotulo}-${i}`} className="mk-dp-tl__row">
                        <dt>{l.rotulo}</dt>
                        <dd>{l.valor}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
