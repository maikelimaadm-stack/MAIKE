import React from "react";
import { ArrowRightLeft, Baby, CircleX, Combine, History, Scale, Tags, Truck } from "lucide-react";
import IconeLancarSuplementacao from "../IconeLancarSuplementacao";
import { TextoDeslizante } from "./blocos";
import "@/styles/mk-dp-historico.css";
import "@/styles/mk-dp-tl-acoes.css";

/*
 * Linha do tempo do Detalhes do Lote v12 (aba Histórico, D-PROD-218): trilho
 * à esquerda, um ponto azul por dia ("09 NOV. 2026") e, embaixo, os cartões do
 * dia — cabeçalho com ícone teal e título, linhas rótulo/valor. Só desenho:
 * os cartões chegam prontos de `historicoDoPasto.js`. Visual em
 * src/styles/mk-dp-historico.css, sob a raiz `.mk-dp`.
 *
 * Marcação: ol.mk-dp-tl > li.mk-dp-tl__grupo > h3.mk-dp-tl__dia(> span.mk-dp-tl__ponto)
 *           + ul.mk-dp-tl__cartoes > li.mk-dp-tl__card
 *             > div.mk-dp-tl__cab(> svg.mk-dp-tl__ic + strong) + dl.mk-dp-tl__linhas (grade) > div.mk-dp-tl__row(.mk-dp-tl__row--larga: texto longo) > dt + dd
 *             + div.mk-dp-tl__acoes (só com `acoes`, D-PROD-266)
 *
 * Sem chip "Cancelado": no Mapa Geral só há EXCLUSÃO, e o registro excluído não chega à linha
 * do tempo (quem monta os cartões já o tira). O campo `cancelado` dos cartões é só dado
 * (ex.: a aba Histórico não põe "Excluir" nele); este componente não o desenha.
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
  suplementacao: IconeLancarSuplementacao,
  registro: History,
};

/**
 * `dias`: `[{ chave, rotulo: "09 NOV. 2026", cartoes: [{ chave, icone | Icone, titulo, linhas: [{ rotulo, valor }] }] }]`.
 * Fora do pasto, monte os dias com `rotuloDoDia("2026-11-09")` de historicoDoPasto.js
 * e passe `Icone` (lucide) quando o desenho não é um dos do histórico do pasto.
 * `acoes` (opcional, D-PROD-266): o que vai no pé do cartão (ex.: "Excluir
 * movimentação" na aba Histórico do pasto), numa faixa abaixo das linhas com a
 * mesma divisória fina delas. Cartão sem `acoes` fica como antes (sem pé). O pé
 * que a D-PROD-222 tirou era o do histórico do bebedouro; este é o slot genérico.
 * @param {{ dias: Array<DiaHistorico | { chave: string, rotulo: string, cartoes: Array<{ chave: string, icone?: IconeHistorico, Icone?: import("lucide-react").LucideIcon, titulo: string, cancelado?: boolean, linhas: Array<{ rotulo: string, valor: React.ReactNode }>, acoes?: React.ReactNode }> }>, rotulo?: string, textoAutomatico?: boolean }} props
 */
/** Rótulos de texto livre: ocupam a largura do cartão mesmo quando o texto é curto. */
const ROTULOS_DE_TEXTO = /^(descrição|observaç(ão|ões)|detalhe|motivo)$/i;

/**
 * Texto livre (descrição, observações, detalhe, motivo) ou longo ocupa a largura do cartão na grade
 * compacta das linhas (D-PROD-224); números e nomes curtos ficam lado a lado.
 * @param {string} rotulo
 * @param {React.ReactNode} valor
 */
const textoLongo = (rotulo, valor) => ROTULOS_DE_TEXTO.test(String(rotulo ?? "").trim()) || (typeof valor === "string" && valor.length > 28);

/**
 * Cartão curto do histórico do pasto (v13): tira das linhas o que sobe para o cabeçalho — o
 * lote (subtítulo), a quantidade em destaque à direita e a rota "De → Até" — e devolve o resto
 * para continuar como linha rótulo/valor. Nada some: o que não tem lugar no cabeçalho fica em `resto`.
 *  - Movimentação · entrada → "+N cab" (tom "entrada"); · saída → "−N cab" (tom "saida").
 *  - Pesagem → "N kg" (o peso médio); as cabeças pesadas continuam como linha.
 *  - Demais com "Quantidade"/"Cabeças" → "N cab".
 * @param {{ titulo?: string, icone?: string, linhas?: Array<{ rotulo: string, valor: any }> }} cartao
 * @returns {{ lote: any, destaque: null | { texto: string, tom: "entrada" | "saida" | "neutro", rotulo: string }, rota: null | { de: any, ate: any }, resto: Array<{ rotulo: string, valor: any }> }}
 */
export function resumoDoCartao(cartao) {
  const linhas = Array.isArray(cartao?.linhas) ? cartao.linhas : [];
  const usadas = new Set();
  /** @param {string} rotulo */
  const achar = (rotulo) => {
    const i = linhas.findIndex((l, k) => !usadas.has(k) && l?.rotulo === rotulo);
    return i >= 0 ? { i, valor: linhas[i].valor } : null;
  };
  /** Só texto/número com conteúdo sobe para o cabeçalho ("—" fica como linha). @param {any} v */
  const temValor = (v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "" && String(v).trim() !== "—";
  const titulo = String(cartao?.titulo ?? "");

  let lote = null;
  /** @type {null | { texto: string, tom: "entrada" | "saida" | "neutro", rotulo: string }} */
  let destaque = null;
  const lLote = achar("Lote");
  if (lLote && temValor(lLote.valor)) {
    lote = lLote.valor;
    usadas.add(lLote.i);
  }

  if (cartao?.icone === "pesagem") {
    const peso = achar("Peso médio (kg)");
    if (peso && temValor(peso.valor)) {
      destaque = { texto: `${peso.valor} kg`, tom: "neutro", rotulo: `Peso médio: ${peso.valor} kg` };
      usadas.add(peso.i);
    }
  } else if (cartao?.icone !== "suplementacao") {
    const qtd = achar("Cabeças") ?? achar("Quantidade");
    if (qtd && temValor(qtd.valor)) {
      const entrada = cartao?.icone === "movimentacao" && /·\s*entrada$/i.test(titulo);
      const saida = cartao?.icone === "movimentacao" && /·\s*saída$/i.test(titulo);
      const sinal = entrada ? "+" : saida ? "−" : "";
      destaque = {
        texto: `${sinal}${qtd.valor} cab`,
        tom: entrada ? "entrada" : saida ? "saida" : "neutro",
        rotulo: `${entrada ? "Entraram" : saida ? "Saíram" : "Quantidade:"} ${qtd.valor} cabeças`,
      };
      usadas.add(qtd.i);
    }
  }

  let rota = null;
  const de = achar("De");
  const ate = achar("Até");
  if (de && ate) {
    rota = { de: de.valor, ate: ate.valor };
    usadas.add(de.i);
    usadas.add(ate.i);
  }

  return { lote, destaque, rota, resto: linhas.filter((_, k) => !usadas.has(k)) };
}

/**
 * `compacto` (v13, só a aba Histórico do pasto/área passa): cartão curto — tipo e lote à
 * esquerda, quantidade em destaque à direita, "De → Até" numa linha; o resto continua em
 * linhas rótulo/valor. Sem `compacto` o cartão é o de sempre (cocho, depósito, bebedouro, tarefa).
 */
export default function LinhaDoTempo({ dias, rotulo = "Registros do pasto", textoAutomatico = false, compacto = false }) {
  const lista = Array.isArray(dias) ? dias : [];
  return (
    <ol className={compacto ? "mk-dp-tl mk-dp-tl--curto" : "mk-dp-tl"} aria-label={rotulo}>
      {lista.map((dia) => (
        <li key={dia.chave} className="mk-dp-tl__grupo">
          <h3 className="mk-dp-tl__dia">
            <span className="mk-dp-tl__ponto" aria-hidden="true" />
            {dia.rotulo}
          </h3>
          <ul className="mk-dp-tl__cartoes">
            {dia.cartoes.map((c) => {
              // `Icone` (componente lucide) vale sobre a chave `icone`: as linhas do
              // tempo do depósito, do bebedouro e da tarefa (D-PROD-220) têm desenhos próprios.
              const Icone = c.Icone ?? ICONES[c.icone] ?? History;
              if (compacto) {
                const r = resumoDoCartao(c);
                return (
                  <li key={c.chave} className="mk-dp-tl__card mk-dp-tl__card--curto">
                    <div className="mk-dp-tl__cab">
                      <Icone className="mk-dp-tl__ic" size={20} aria-hidden="true" />
                      <div className="mk-dp-tl__quem">
                        <strong className="mk-dp-tl__titulo">{textoAutomatico ? <TextoDeslizante>{c.titulo}</TextoDeslizante> : c.titulo}</strong>
                        {r.lote != null ? (
                          <span className="mk-dp-tl__lote">
                            <span className="mk-dp-tl__sr">Lote: </span>
                            {textoAutomatico ? <TextoDeslizante>{r.lote}</TextoDeslizante> : r.lote}
                          </span>
                        ) : null}
                      </div>
                      {r.destaque ? (
                        <span className="mk-dp-tl__qtd" data-tom={r.destaque.tom} aria-label={r.destaque.rotulo}>
                          {r.destaque.texto}
                        </span>
                      ) : null}
                    </div>
                    {r.rota ? (
                      <div className="mk-dp-tl__rota">
                        <span className="mk-dp-tl__ponta">
                          <span className="mk-dp-tl__rotulo">De</span> <b>{r.rota.de}</b>
                        </span>
                        <span className="mk-dp-tl__seta" aria-hidden="true">→</span>
                        <span className="mk-dp-tl__ponta mk-dp-tl__ponta--fim">
                          <span className="mk-dp-tl__rotulo">Até</span> <b>{r.rota.ate}</b>
                        </span>
                      </div>
                    ) : null}
                    {r.resto.length ? (
                      <dl className="mk-dp-tl__linhas">
                        {r.resto.map((l, i) => (
                          <div key={`${l.rotulo}-${i}`} className={textoLongo(l.rotulo, l.valor) ? "mk-dp-tl__row mk-dp-tl__row--larga" : "mk-dp-tl__row"}>
                            <dt>{textoAutomatico ? <TextoDeslizante>{l.rotulo}</TextoDeslizante> : l.rotulo}</dt>
                            <dd>{textoAutomatico ? <TextoDeslizante>{l.valor}</TextoDeslizante> : l.valor}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {c.acoes != null && c.acoes !== false ? <div className="mk-dp-tl__acoes">{c.acoes}</div> : null}
                  </li>
                );
              }
              return (
                <li key={c.chave} className="mk-dp-tl__card">
                  <div className="mk-dp-tl__cab">
                    <Icone className="mk-dp-tl__ic" size={22} aria-hidden="true" />
                    <strong className="mk-dp-tl__titulo">{textoAutomatico ? <TextoDeslizante>{c.titulo}</TextoDeslizante> : c.titulo}</strong>
                  </div>
                  <dl className="mk-dp-tl__linhas">
                    {c.linhas.map((l, i) => (
                      <div key={`${l.rotulo}-${i}`} className={textoLongo(l.rotulo, l.valor) ? "mk-dp-tl__row mk-dp-tl__row--larga" : "mk-dp-tl__row"}>
                        <dt>{textoAutomatico ? <TextoDeslizante>{l.rotulo}</TextoDeslizante> : l.rotulo}</dt>
                        <dd>{textoAutomatico ? <TextoDeslizante>{l.valor}</TextoDeslizante> : l.valor}</dd>
                      </div>
                    ))}
                  </dl>
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
