import React, { useCallback, useEffect, useId, useState } from "react";
import { useDlUi, COR, CartaoDl, PilulaTitulo, IconeCategoria, TituloSecao, GradeCampos, Chevron, useAlturaPopup } from "@/components/mapa/detalhes-lote/pecas";
import { SECOES_AREA, TONS, VAZIO } from "@/components/mapa/detalhes-lote/catalogo";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/** @param {string[]} sel */
function textoSeletor(sel) {
  if (SECOES_AREA.every((s) => sel.includes(s))) return "Todas";
  if (!sel.length) return "Nenhuma";
  if (sel.length === 1) return sel[0];
  return `${sel.length} selecionadas`;
}

/**
 * Aba Área: seletor "Mostrar informações" (Área · Lotação · Categorias), card
 * "Informações da Área" com a faixa da lotação, card "Categorias na área" e os
 * alertas da área. Mockup v8, linhas 155–195. Sem produção e sem altura do capim.
 *
 * As seções marcadas são PREFERÊNCIA DO USUÁRIO (fazenda + conta + empresa,
 * ./preferencias.js): chegam em `secoes` e cada mudança vai para `aoMudarSecoes`.
 * Sem `secoes`, mostra todas (padrão: sem filtro).
 *
 * @param {{ modelo: ModeloDetalhes, secoes?: string[], aoMudarSecoes?: (secoes: string[]) => void }} props
 */
export default function AbaArea({ modelo, secoes: secoesPref, aoMudarSecoes }) {
  const ui = useDlUi();
  const area = modelo.area;
  const secoes = SECOES_AREA.filter((s) => (secoesPref ?? SECOES_AREA).includes(s));
  const [aberto, setAberto] = useState(false);
  const { ancora, estilo: estiloRolagem } = useAlturaPopup(aberto);
  const idCampo = useId();

  /** @param {string[]} prox */
  const mudar = useCallback((prox) => {
    aoMudarSecoes?.(SECOES_AREA.filter((s) => prox.includes(s)));
  }, [aoMudarSecoes]);

  /** @param {string} s */
  const alternar = (s) => mudar(secoes.includes(s) ? secoes.filter((x) => x !== s) : [...secoes, s]);
  const tudo = SECOES_AREA.every((s) => secoes.includes(s));
  const alternarTodas = () => mudar(tudo ? [] : [...SECOES_AREA]);

  useEffect(() => {
    if (!aberto) return undefined;
    /** @param {KeyboardEvent} e */
    const aoTeclar = (e) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  const opcoes = [
    { rotulo: "Todas", on: tudo, alternar: alternarTodas },
    ...SECOES_AREA.map((s) => ({ rotulo: s, on: secoes.includes(s), alternar: () => alternar(s) })),
  ];

  const secoesVisiveis = (area.secoes || []).filter((sec) => secoes.includes(sec.titulo));
  const mostrarCategorias = secoes.includes("Categorias");
  const categorias = area.categorias || [];
  const legendaCols = ui.celular ? 1 : 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: ui.celular ? "minmax(0, 0.62fr) minmax(0, 2fr)" : "minmax(0, 1fr) minmax(0, 1.35fr)",
            columnGap: 10,
            alignItems: "center",
            height: 36,
            padding: "0 10px",
            borderRadius: 12,
            background: "#fff",
            boxShadow: ui.sombra,
          }}
        >
          <label
            htmlFor={idCampo}
            style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 12, fontWeight: 500, lineHeight: 1.25, color: COR.texto }}
          >
            {ui.celular ? "Mostrar" : "Mostrar informações"}
          </label>
          <button
            ref={ancora}
            id={idCampo}
            type="button"
            role="combobox"
            aria-expanded={aberto}
            aria-haspopup="listbox"
            aria-label="Mostrar informações"
            onClick={() => setAberto((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              width: "100%",
              minWidth: 0,
              height: 30,
              padding: "0 8px",
              border: 0,
              borderRadius: 8,
              background: COR.fundo,
              color: COR.texto,
              fontSize: 12,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{textoSeletor(secoes)}</span>
            <Chevron direcao="baixo" tamanho={12} cor={COR.meta} />
          </button>
        </div>
        {aberto && (
          <>
            <div aria-hidden="true" onClick={() => setAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
            <div
              role="listbox"
              aria-label="Mostrar informações"
              aria-multiselectable="true"
              style={{
                position: "absolute",
                top: "calc(100% + 5px)",
                right: 8,
                zIndex: 21,
                width: 250,
                maxWidth: "calc(100% - 16px)",
                padding: 6,
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 6px 24px rgba(15, 23, 42, .14)",
                ...estiloRolagem,
              }}
            >
              <div style={{ padding: "6px 8px", fontSize: 13, fontWeight: 600, color: COR.meta }}>Mostrar informações</div>
              {opcoes.map((op, i) => (
                <button
                  key={op.rotulo}
                  type="button"
                  role="option"
                  aria-selected={op.on}
                  onClick={op.alternar}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    minHeight: ui.linhaToque,
                    padding: "6px 8px",
                    border: 0,
                    borderTop: `1px solid ${i === 0 ? "transparent" : COR.divisor}`,
                    background: "transparent",
                    color: COR.texto,
                    fontSize: 13,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 14,
                      height: 14,
                      flex: "0 0 14px",
                      border: `1px solid ${op.on ? "#32d65e" : COR.marcador}`,
                      borderRadius: 4,
                      background: op.on ? "#32d65e" : "#fff",
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
                      <path d="m2 6 3 3 5-6" />
                    </svg>
                  </span>
                  {op.rotulo}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <CartaoDl gap={8}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <PilulaTitulo>Informações da Área</PilulaTitulo>
          {area.faixaCurta ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 600, color: COR.texto, whiteSpace: "nowrap" }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, flex: "0 0 auto", borderRadius: 999, background: area.faixa?.cor || COR.marcador }} />
              {area.faixaCurta}
            </span>
          ) : null}
        </div>
        {secoesVisiveis.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {secoesVisiveis.map((sec) => (
              <div key={sec.titulo}>
                <TituloSecao>{sec.titulo}</TituloSecao>
                <GradeCampos campos={sec.campos} colunas={ui.infoCols} variante="info" />
              </div>
            ))}
          </div>
        )}
      </CartaoDl>

      {mostrarCategorias && categorias.length > 0 && (
        <CartaoDl gap={8}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <PilulaTitulo>Categorias na área</PilulaTitulo>
            <span style={{ fontSize: 10.5, fontWeight: 500, color: COR.meta }}>{area.cabTotal && area.cabTotal !== VAZIO ? `${area.cabTotal} cab` : VAZIO}</span>
          </div>
          <div aria-hidden="true" style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: COR.divisor, gap: 2 }}>
            {categorias.map((cat) => (
              <span key={cat.nome} style={{ display: "block", width: `${Math.max(0, Number(cat.pct) || 0)}%`, background: cat.cor }} />
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${legendaCols}, minmax(0, 1fr))`, gap: "0 12px" }}>
            {categorias.map((cat, i) => (
              <div
                key={cat.nome}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                  padding: "4px 0",
                  borderTop: `1px solid ${i < legendaCols ? "transparent" : COR.divisor}`,
                }}
              >
                <IconeCategoria figura={cat.subicone} tamanho={22} alt={cat.nome} />
                <span
                  style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: COR.texto,
                  }}
                >
                  {cat.nome}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 500, color: COR.meta, whiteSpace: "nowrap" }}>{cat.resumo}</span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    minWidth: 38,
                    justifyContent: "flex-end",
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: COR.texto,
                  }}
                >
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: cat.cor }} />
                  {cat.pctTexto}
                </span>
              </div>
            ))}
          </div>
        </CartaoDl>
      )}

      {(area.alertas || []).map((al, i) => {
        const cor = (TONS[al.tom] || TONS.atencao).texto;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px", fontSize: 10.5, fontWeight: 600, color: cor }}>
            <span aria-hidden="true" style={{ width: 7, height: 7, flex: "0 0 auto", borderRadius: 999, background: cor }} />
            {al.frase}
          </div>
        );
      })}
    </div>
  );
}
