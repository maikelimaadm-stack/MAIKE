import React from "react";
import { useDlUi, COR } from "@/components/mapa/detalhes-lote/pecas";
import { colunasAtivas, TONS } from "@/components/mapa/detalhes-lote/catalogo";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').CampoDef} CampoDef */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').LoteVm} LoteVm */
/** @typedef {import('@/components/mapa/detalhes-lote/useEstadoLotes').EstadoLotes} EstadoLotes */

const SEP = `1px solid ${COR.divisor}`;

// Piso de largura = maior palavra do cabeçalho, para o título quebrar em 2 linhas
// sem invadir a coluna vizinha (mockup v8, script linhas 900–904).
/** @param {string} rotulo */
const palavraMax = (rotulo) => Math.max(...String(rotulo).split(/[ /]+/).map((w) => w.length));
/** @param {string} rotulo */
const pisoCab = (rotulo) => Math.min(170, Math.max(46, palavraMax(rotulo) * 6.7 + 26));
// No celular o piso é curto: o título quebra em 2 linhas em vez de alargar a coluna.
/** @param {string} rotulo */
const pisoCabCel = (rotulo) => Math.min(84, Math.max(40, palavraMax(rotulo) * 6.2 + 14));

/** @param {CampoDef[]} cols @param {number} i */
const primeiraDoGrupo = (cols, i) => i === 0 || cols[i - 1].secao !== cols[i].secao;

/** @type {React.CSSProperties} */
const FIXA = { position: "sticky", left: 0, zIndex: 1, borderRight: SEP };

/** @type {React.CSSProperties} */
const EYEBROW = { fontSize: 9, fontWeight: 700, color: COR.meta, textTransform: "uppercase", letterSpacing: "0.05em" };

/** @type {React.CSSProperties} */
const AVISO = { padding: "10px 12px", borderTop: SEP, fontSize: 11, color: COR.meta };

/**
 * Vista Lista da aba Lotes: tabela em grid com as colunas das seções marcadas em
 * "Filtrar" (Alertas · Lotação · Pesagem · Identificação). Mockup v8, linhas 343–390.
 * Tracks iguais em todas as linhas (grupo, cabeçalho, dados, total); primeira coluna fixa.
 *
 * @param {{ modelo: ModeloDetalhes, estado: EstadoLotes }} props
 */
export default function VistaLista({ modelo, estado }) {
  const ui = useDlUi();
  const celular = ui.celular;
  const cols = colunasAtivas(estado.secoes);
  const lotes = estado.lotesVisiveis;
  const ord = estado.ordenar;

  const gridCols = celular
    ? `120px ${cols.map((c) => `${Math.max(c.larguraCel, pisoCabCel(c.rotulo))}px`).join(" ")}`
    : `190px ${cols.map((c) => `minmax(${Math.max(c.larguraDesk, pisoCab(c.rotulo))}px, 1fr)`).join(" ")}`;
  const celPad = celular ? "6px 6px" : "6px 10px";
  const celPadTh = celular ? "4px 6px 6px" : "4px 10px 6px";
  const barraLarg = celular ? 22 : 32;

  /** @type {Array<{ rotulo: string, span: number }>} */
  const grupos = [];
  cols.forEach((c, i) => {
    if (primeiraDoGrupo(cols, i)) grupos.push({ rotulo: c.secao, span: 1 });
    else grupos[grupos.length - 1].span += 1;
  });

  /** @param {string|null} chave */
  const seta = (chave) => (ord.chave === chave ? (ord.dir > 0 ? "▲" : "▼") : "");
  /** @param {string|null} chave */
  const corCab = (chave) => (ord.chave === chave ? COR.titulo : COR.meta);

  /** @type {React.CSSProperties} */
  const linhaGrid = { display: "grid", gridTemplateColumns: gridCols, alignItems: "stretch" };

  /** @type {React.CSSProperties} */
  const botaoCab = {
    display: "inline-flex",
    alignItems: "flex-end",
    gap: 3,
    maxWidth: "100%",
    padding: 0,
    border: 0,
    background: "transparent",
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: 1.2,
    textAlign: "left",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    cursor: "pointer",
  };

  return (
    <div style={{ borderRadius: 12, background: "#fff", boxShadow: ui.sombra, overflow: "hidden" }}>
      <div data-sem-deslize="" style={{ overflowX: "auto", overscrollBehaviorX: "contain" }}>
        <div style={{ width: "max-content", minWidth: "100%", fontSize: 10.5, color: COR.texto }}>
          {cols.length > 0 && (
            <div style={{ ...linhaGrid, background: COR.fundo }}>
              <div style={{ ...FIXA, ...EYEBROW, padding: "6px 10px 2px", background: COR.fundo }}>Lote</div>
              {grupos.map((g) => (
                <div
                  key={g.rotulo}
                  style={{
                    ...EYEBROW,
                    gridColumn: `span ${g.span}`,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    padding: "6px 10px 2px",
                    borderLeft: SEP,
                    whiteSpace: "nowrap",
                  }}
                >
                  {g.rotulo}
                </div>
              ))}
            </div>
          )}

          <div style={{ ...linhaGrid, background: COR.fundo, borderBottom: SEP }}>
            <div
              style={{
                ...FIXA,
                display: "flex",
                alignItems: "flex-end",
                minWidth: 0,
                overflow: "hidden",
                padding: celPadTh,
                background: COR.fundo,
              }}
            >
              <button type="button" onClick={() => estado.ordenarPor("nome")} style={{ ...botaoCab, color: corCab("nome") }}>
                Nome<span style={{ flex: "0 0 auto", fontSize: 9 }}>{seta("nome")}</span>
              </button>
            </div>
            {cols.map((c, i) => (
              <div
                key={c.chave}
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  minWidth: 0,
                  overflow: "hidden",
                  padding: celPadTh,
                  borderLeft: primeiraDoGrupo(cols, i) ? SEP : 0,
                }}
              >
                <button
                  type="button"
                  title={c.dica || undefined}
                  onClick={() => estado.ordenarPor(c.chave)}
                  style={{ ...botaoCab, color: corCab(c.chave), hyphens: "auto" }}
                >
                  <span style={{ minWidth: 0 }}>{c.rotulo}</span>
                  <span style={{ flex: "0 0 auto", fontSize: 9 }}>{seta(c.chave)}</span>
                </button>
              </div>
            ))}
          </div>

          {lotes.map((lote, li) => (
            <LinhaTabela
              key={lote.id}
              lote={lote}
              cols={cols}
              primeira={li === 0}
              linhaGrid={linhaGrid}
              celPad={celPad}
              barraLarg={barraLarg}
            />
          ))}

          <div style={{ ...linhaGrid, background: COR.fundo, borderTop: SEP, fontWeight: 700 }}>
            <div style={{ ...FIXA, padding: celPad, background: COR.fundo }}>Total da área</div>
            {cols.map((c, i) => (
              <div
                key={c.chave}
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  padding: celPad,
                  borderLeft: primeiraDoGrupo(cols, i) ? SEP : 0,
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {modelo.totais?.[c.chave] ?? ""}
              </div>
            ))}
          </div>
        </div>
      </div>
      {cols.length === 0 && <div style={AVISO}>Marque uma seção em “Filtrar” para ver as colunas.</div>}
      {lotes.length === 0 && <div style={AVISO}>Nenhum lote com esse alerta. Troque o filtro para ver os outros.</div>}
    </div>
  );
}

/**
 * Uma linha de dados: primeira coluna fixa (bolinha da situação + nome + sub) e uma
 * célula por coluna ativa, com cor/bolinha/barra vindas de `lote.valores[chave]`.
 *
 * @param {{ lote: LoteVm, cols: CampoDef[], primeira: boolean, linhaGrid: React.CSSProperties, celPad: string, barraLarg: number }} props
 */
function LinhaTabela({ lote, cols, primeira, linhaGrid, celPad, barraLarg }) {
  const tom = TONS[lote.situacao?.tom] || TONS.neutro;
  return (
    <div style={{ ...linhaGrid, borderTop: `1px solid ${primeira ? "transparent" : COR.divisor}`, background: "#fff" }}>
      <div style={{ ...FIXA, display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: celPad, background: "#fff" }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
            <span
              title={lote.situacao?.rotulo}
              style={{ width: 7, height: 7, flex: "0 0 auto", borderRadius: 999, background: tom.texto }}
            />
            {lote.nome}
          </span>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontSize: 10,
              fontWeight: 500,
              color: COR.meta,
              whiteSpace: "nowrap",
            }}
          >
            {lote.sub}
          </span>
        </span>
      </div>
      {cols.map((c, i) => {
        const cel = lote.valores?.[c.chave];
        const temBarra = typeof cel?.barra === "number" && Number.isFinite(cel.barra);
        return (
          <div
            key={c.chave}
            style={{
              display: "flex",
              alignItems: "center",
              minWidth: 0,
              overflow: "hidden",
              padding: celPad,
              borderLeft: primeiraDoGrupo(cols, i) ? SEP : 0,
              whiteSpace: cel?.quebra ? "normal" : "nowrap",
              overflowWrap: "anywhere",
              fontWeight: 600,
              color: cel?.cor || COR.texto,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {cel?.dot && (
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    flex: "0 0 auto",
                    border: `1px solid ${COR.marcador}`,
                    borderRadius: 999,
                    backgroundColor: cel.dot,
                  }}
                />
              )}
              {cel?.texto ?? "—"}
              {temBarra && (
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    flex: "0 0 auto",
                    width: barraLarg,
                    height: 4,
                    borderRadius: 999,
                    background: COR.divisor,
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      width: `${Math.max(0, Math.min(100, Number(cel?.barra)))}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: COR.barra,
                    }}
                  />
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
