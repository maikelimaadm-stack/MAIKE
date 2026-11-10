import React from "react";
import { TextoCorrido } from "@/components/mapa/CampoDl";
import { useMediaQuery } from "@/components/common/MobileSheet";
import { TONS } from "@/components/mapa/detalhes-lote/catalogo";

/*
 * Peças visuais do Detalhes do Lote v8 (mockup docs/design/detalhes-do-lote/
 * detalhes-do-lote-v8.dc.html). Estilos inline com as medidas exatas do
 * mockup; quem precisa de pseudo-classe usa src/styles/mk-detalhes-lote.css.
 */

export const COR = {
  titulo: "#292a2d",
  texto: "#374151",
  meta: "#64748b",
  borda: "#e2e8f0",
  divisor: "#edf0f3",
  marcador: "#cbd5e1",
  destaque: "#e6f7fc",
  fundo: "#FAFCFE",
  ativo: "rgba(64, 222, 99, 0.14)",
  linha: "#16a34a",
  barra: "#5ACBE9",
};

const SOMBRA_DESKTOP = "0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.025)";
const SOMBRA_TELA = "0 1px 3px rgba(15, 23, 42, 0.1)";

/**
 * @typedef {{ modo: 'celular'|'tablet'|'desktop', celular: boolean, tablet: boolean, desktop: boolean, tela: boolean,
 *   sombra: string, sombraBtn: string, infoCols: 3|4, linhaToque: string, linhaTopico: string }} DlUi
 */

/**
 * @param {boolean} celular
 * @param {boolean} desktop
 * @returns {DlUi}
 */
function montarUi(celular, desktop) {
  const modo = celular ? "celular" : desktop ? "desktop" : "tablet";
  const sombra = modo === "desktop" ? SOMBRA_DESKTOP : SOMBRA_TELA;
  return {
    modo,
    celular: modo === "celular",
    tablet: modo === "tablet",
    desktop: modo === "desktop",
    tela: modo !== "desktop",
    sombra,
    sombraBtn: sombra,
    infoCols: modo === "celular" ? 3 : 4,
    linhaToque: modo === "celular" ? "44px" : "36px",
    linhaTopico: modo === "celular" ? "32px" : "26px",
  };
}

/** Contexto com o `DlUi` do diálogo (modo da tela + medidas que mudam com ele). */
export const DlUiContext = React.createContext(/** @type {DlUi | null} */ (null));

/** Modo da tela e medidas do mockup. Fora do provider, calcula pelas media queries. */
export function useDlUi() {
  const ctx = React.useContext(DlUiContext);
  const celular = useMediaQuery("(max-width: 639px)");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const proprio = React.useMemo(() => montarUi(celular, desktop), [celular, desktop]);
  return ctx || proprio;
}

/**
 * Mede a tela uma vez para todo o diálogo.
 * @param {{ children?: React.ReactNode }} props
 */
export function DlUiProvider({ children }) {
  const celular = useMediaQuery("(max-width: 639px)");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const ui = React.useMemo(() => montarUi(celular, desktop), [celular, desktop]);
  return <DlUiContext.Provider value={ui}>{children}</DlUiContext.Provider>;
}

/**
 * Card branco do padrão (raio 12, sombra do modo).
 * @param {{ children?: React.ReactNode, gap?: number, padding?: string, style?: React.CSSProperties }} props
 */
export function CartaoDl({ children, gap = 8, padding = "10px", style }) {
  const ui = useDlUi();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap,
        padding,
        borderRadius: 12,
        background: "#fff",
        boxShadow: ui.sombra,
        fontSize: 12,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Título do card em pílula.
 * @param {{ children?: React.ReactNode }} props
 */
export function PilulaTitulo({ children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        minWidth: 0,
        padding: "2px 9px",
        borderRadius: 999,
        background: COR.destaque,
        color: COR.texto,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.01em",
        lineHeight: 1.25,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Pílula de situação ("Atenção" / "Em dia") com bolinha.
 * @param {{ situacao: { rotulo: string, tom: string } | null | undefined }} props
 */
export function PilulaSituacao({ situacao }) {
  if (!situacao) return null;
  const tons = /** @type {Record<string, { texto: string, fundo: string, borda: string } | undefined>} */ (/** @type {unknown} */ (TONS || {}));
  const t = tons[situacao.tom] || tons.neutro || { texto: COR.texto, fundo: COR.fundo, borda: COR.borda };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        flex: "0 0 auto",
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${t.borda}`,
        background: t.fundo,
        color: t.texto,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: t.texto }} />
      {situacao.rotulo}
    </span>
  );
}

/**
 * Ícone da categoria; sem url, o quadrado tracejado do mockup.
 * @param {{ url?: string | null, tamanho?: number, alt?: string }} props
 */
export function IconeCategoria({ url, tamanho = 22, alt = "" }) {
  const caixa = { display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", width: tamanho, height: tamanho };
  if (url) {
    return (
      <span style={caixa}>
        <img src={url} alt={alt} style={{ width: tamanho, height: tamanho, objectFit: "contain" }} />
      </span>
    );
  }
  return (
    <span style={caixa} aria-hidden={alt ? undefined : true} title={alt || undefined}>
      <span
        style={{
          display: "block",
          boxSizing: "border-box",
          width: "100%",
          height: "100%",
          borderRadius: tamanho >= 32 ? 8 : 4,
          background: "#eef1f4",
          border: "1px dashed #dfe3e8",
        }}
      />
    </span>
  );
}

/**
 * Título de seção (eyebrow 9px caixa alta) com a linha fina à direita.
 * @param {{ children?: React.ReactNode, direita?: React.ReactNode }} props
 */
export function TituloSecao({ children, direita }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 1,
        fontSize: 9,
        fontWeight: 700,
        color: COR.meta,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {children}
      <span aria-hidden="true" style={{ flex: "1 1 auto", height: 1, background: COR.divisor }} />
      {direita != null ? <span style={{ flex: "0 0 auto" }}>{direita}</span> : null}
    </div>
  );
}

/**
 * @typedef {{ rotulo: React.ReactNode, texto: React.ReactNode, cor?: string, dot?: string|null, barra?: number|null, dica?: string, quebra?: boolean }} CampoGrade
 */

/**
 * Grade rótulo/valor com linhas finas (a 1ª linha sem linha; a última
 * completada com células vazias que também têm linha).
 * @param {{ campos: CampoGrade[], colunas: number, variante?: 'topico'|'info' }} props
 */
export function GradeCampos({ campos, colunas, variante = "topico" }) {
  const ui = useDlUi();
  const lista = Array.isArray(campos) ? campos : [];
  const cols = Math.max(1, Number(colunas) || 1);
  const sobra = lista.length % cols;
  const vazias = sobra ? cols - sobra : 0;
  const info = variante === "info";
  const dotTam = info ? 9 : 8;
  const barraLarg = info ? 34 : 28;

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "0 6px" }}>
      {lista.map((c, i) => {
        const quebra = Boolean(c.quebra);
        const barra = c.barra == null || !Number.isFinite(Number(c.barra)) ? null : Math.max(0, Math.min(100, Number(c.barra)));
        /** @type {React.CSSProperties} */
        const estiloValor = info
          ? {
              overflow: "hidden",
              whiteSpace: quebra ? "normal" : "nowrap",
              overflowWrap: "anywhere",
              textOverflow: "ellipsis",
              fontSize: 10.5,
              lineHeight: 1.2,
              fontWeight: 600,
              color: c.cor || COR.texto,
            }
          : {
              overflowWrap: "anywhere",
              whiteSpace: "normal",
              fontSize: 10.5,
              lineHeight: 1.25,
              fontWeight: 600,
              color: c.cor || COR.texto,
            };
        return (
          <div key={i} title={c.dica || undefined} style={{ minWidth: 0, padding: "5px 0", borderTop: `1px solid ${i < cols ? "transparent" : COR.divisor}` }}>
            <div
              style={{
                overflow: info ? "hidden" : undefined,
                whiteSpace: info && !ui.celular ? "nowrap" : "normal",
                textOverflow: info ? "ellipsis" : undefined,
                fontSize: 10.5,
                lineHeight: 1.15,
                fontWeight: 500,
                color: COR.meta,
              }}
            >
              {c.rotulo}
            </div>
            <div style={estiloValor}>
              {(() => {
                const dot = c.dot ? (
                  <span aria-hidden="true" style={{ flex: "0 0 auto", width: dotTam, height: dotTam, border: `1px solid ${COR.marcador}`, borderRadius: 999, backgroundColor: c.dot }} />
                ) : null;
                const barrinha = barra != null ? (
                  <span aria-hidden="true" style={{ display: "inline-block", flex: "0 0 auto", width: barraLarg, height: 4, borderRadius: 999, background: COR.divisor, overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${barra}%`, height: "100%", borderRadius: 999, background: COR.barra }} />
                  </span>
                ) : null;
                // 'info' numa linha só: se o valor não couber, o texto corre devagar (D-PROD-124, TextoCorrido do CampoDl).
                if (info && !quebra) return <TextoCorrido>{dot}{c.texto}{barrinha}</TextoCorrido>;
                return (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: info ? undefined : "wrap", maxWidth: "100%" }}>
                    {dot}
                    {c.texto}
                    {barrinha}
                  </span>
                );
              })()}
            </div>
          </div>
        );
      })}
      {Array.from({ length: vazias }, (_, i) => (
        <span key={`vazia-${i}`} aria-hidden="true" style={{ display: "block", borderTop: `1px solid ${lista.length + i < cols ? "transparent" : COR.divisor}` }} />
      ))}
    </div>
  );
}

/**
 * Quatro números (rótulo eyebrow em cima, valor embaixo).
 * @param {{ itens: Array<{ rotulo: React.ReactNode, texto: React.ReactNode, cor?: string }> }} props
 */
export function NumerosDl({ itens }) {
  const lista = Array.isArray(itens) ? itens : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0 6px" }}>
      {lista.map((it, i) => (
        <div key={i} style={{ minWidth: 0, padding: "5px 0", borderTop: `1px solid ${COR.divisor}` }}>
          <div style={{ fontSize: 9, fontWeight: 700, lineHeight: 1.2, letterSpacing: "0.05em", textTransform: "uppercase", color: COR.meta }}>{it.rotulo}</div>
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 10.5,
              fontWeight: 600,
              lineHeight: 1.3,
              color: it.cor || COR.texto,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {it.texto}
          </div>
        </div>
      ))}
    </div>
  );
}

const CAMINHO_CHEVRON = {
  direita: "m9 6 6 6-6 6",
  esquerda: "m15 6-6 6 6 6",
  baixo: "m6 9 6 6 6-6",
};

/**
 * Popup que abre embaixo de um botão: a altura máxima vai do fim do botão até
 * o fim da tela visível, e o popup rola por dentro. Sem isto, no celular as
 * últimas opções ficavam abaixo da tela — e a camada que fecha o popup ao tocar
 * fora também impede rolar o corpo por trás dela.
 * @param {boolean} aberto
 * @returns {{ ancora: React.MutableRefObject<HTMLButtonElement | null>, estilo: React.CSSProperties }}
 */
export function useAlturaPopup(aberto) {
  const ancora = React.useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [maximo, setMaximo] = React.useState(/** @type {number | null} */ (null));
  React.useLayoutEffect(() => {
    if (!aberto || typeof window === "undefined") return undefined;
    const medir = () => {
      const el = ancora.current;
      if (!el) return;
      const fimBotao = el.getBoundingClientRect().bottom;
      const alturaTela = window.visualViewport?.height ?? window.innerHeight;
      // 5px de distância do botão + 12px de respiro no fim da tela; nunca menor que 160px.
      setMaximo(Math.max(160, Math.floor(alturaTela - fimBotao - 5 - 12)));
    };
    medir();
    window.addEventListener("resize", medir);
    window.visualViewport?.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.visualViewport?.removeEventListener("resize", medir);
    };
  }, [aberto]);
  return {
    ancora,
    estilo: { maxHeight: maximo ?? undefined, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" },
  };
}

/**
 * Seta (traço 2,25). `girar` → 90° com transição (acordeão).
 * @param {{ direcao?: 'direita'|'esquerda'|'baixo', tamanho?: number, cor?: string, girar?: boolean, style?: React.CSSProperties }} props
 */
export function Chevron({ direcao = "direita", tamanho = 18, cor = "#64748b", girar = false, style }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke={cor}
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "0 0 auto", transform: girar ? "rotate(90deg)" : "none", transition: "transform 0.15s", ...style }}
    >
      <path d={CAMINHO_CHEVRON[direcao] || CAMINHO_CHEVRON.direita} />
    </svg>
  );
}
