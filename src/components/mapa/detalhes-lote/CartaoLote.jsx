import React from "react";
import {
  useDlUi,
  COR,
  TIPO,
  CartaoDl,
  PilulaSituacao,
  IconeCategoria,
  GradeCampos,
  NumerosDl,
} from "@/components/mapa/detalhes-lote/pecas";
import { TONS, topicosDoLote } from "@/components/mapa/detalhes-lote/catalogo";

/** @typedef {import('./catalogo').LoteVm} LoteVm */

/**
 * O que o card do lote lê do estado da aba Lotes (useEstadoLotes): só as seções
 * marcadas em Informações e os tópicos abertos — abrir/fechar vale para todos os lotes.
 * @typedef {{
 *   secoes: string[],
 *   topicosAbertos: Record<string, boolean>,
 *   alternarTopico: (titulo: string) => void,
 * }} EstadoCartao
 */

/**
 * Corpo do card do lote (mockup v8, linhas 251–279 e 315–336), sem o cabeçalho:
 * 1) os 4 números · 2) tópicos recolhidos (os marcados em Informações) · 3) alertas embaixo.
 * Devolve um fragmento: quem chama põe dentro de um flex column com gap 6.
 * Sem fundo cinza, sem borda colorida, sem botões de ação.
 *
 * @param {{ lote: LoteVm, estado: EstadoCartao }} props
 */
export function CorpoCartaoLote({ lote, estado }) {
  const ui = useDlUi();
  const topicos = topicosDoLote(lote, estado.secoes);
  const alertas = lote.alertasVisiveis || [];

  const numeros = [
    { rotulo: "Cabeças", texto: lote.textos.cab },
    { rotulo: "Peso médio (kg)", texto: lote.textos.peso },
    { rotulo: "kg PV/ha", texto: lote.textos.kgPvHa },
    { rotulo: "Dias sem pesar", texto: lote.textos.diasSemPesar, cor: lote.textos.diasSemPesarCor },
  ];

  return (
    <>
      <NumerosDl itens={numeros} />

      {topicos.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {topicos.map((tp) => {
            const aberto = !!estado.topicosAbertos[tp.titulo];
            return (
              <div key={tp.titulo} style={{ borderTop: `1px solid ${COR.divisor}` }}>
                <button
                  type="button"
                  aria-expanded={aberto}
                  onClick={() => estado.alternarTopico(tp.titulo)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    minHeight: ui.linhaTopico,
                    padding: "4px 0",
                    border: 0,
                    background: "transparent",
                    color: COR.meta,
                    ...TIPO.grupo,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span aria-hidden="true" style={{ display: "inline-block", width: 10, fontSize: 13, color: COR.meta }}>
                      {aberto ? "▾" : "▸"}
                    </span>
                    {tp.titulo}
                  </span>
                  <span style={{ flex: "0 0 auto", ...TIPO.rotulo, fontFamily: "var(--mk-fonte-texto)", letterSpacing: 0, textTransform: "none", color: COR.meta }}>
                    {aberto ? "ocultar" : `${tp.campos.length} dados`}
                  </span>
                </button>
                {aberto ? (
                  <div style={{ padding: "0 0 2px" }}>
                    <GradeCampos campos={tp.campos} colunas={ui.infoCols} variante="topico" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {alertas.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 6, borderTop: `1px solid ${COR.divisor}` }}>
          {alertas.map((al) => {
            const tom = TONS[al.tom] || TONS.neutro;
            return (
              <div
                key={`${al.tipo}-${al.frase}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  padding: "5px 8px",
                  borderRadius: 8,
                  border: `1px solid ${tom.borda}`,
                  background: tom.fundo,
                  color: tom.texto,
                  ...TIPO.selo,
                  lineHeight: 1.3,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ flex: "0 0 auto", marginTop: 4, width: 7, height: 7, borderRadius: 999, background: tom.texto }}
                />
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{al.frase}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/**
 * Card de um lote (vista Lote; mockup v8, linhas 300–338): cabeçalho com ícone 32,
 * nome, "CATEGORIA · SEXO" e pílula de situação; depois o corpo.
 *
 * @param {{ lote: LoteVm, estado: EstadoCartao }} props
 */
export default function CartaoLote({ lote, estado }) {
  /** @type {React.CSSProperties} */
  const umaLinha = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <CartaoDl gap={6}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", width: 32, height: 32 }}>
            <IconeCategoria url={lote.iconeUrl} tamanho={32} alt={lote.categoria} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...umaLinha, ...TIPO.item, lineHeight: 1.25, color: COR.titulo }}>{lote.nome}</div>
            <div style={{ ...umaLinha, ...TIPO.rotulo, lineHeight: 1.3, color: COR.meta }}>{lote.sub}</div>
          </div>
        </div>
        <span style={{ display: "inline-flex", flex: "0 0 auto" }}>
          <PilulaSituacao situacao={lote.situacao} />
        </span>
      </div>
      <CorpoCartaoLote lote={lote} estado={estado} />
    </CartaoDl>
  );
}
