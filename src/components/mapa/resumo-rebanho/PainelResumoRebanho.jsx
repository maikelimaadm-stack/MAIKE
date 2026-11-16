import React from "react";
import { DlUiProvider, useDlUi, COR, CartaoDl, PilulaTitulo } from "@/components/mapa/detalhes-lote/pecas";
import { resumoDoRebanho, TODAS_FAZENDAS, DIAS_HORIZONTE, KG_POR_UA } from "@/domain/rebanho/resumoDoRebanho";
import "@/styles/mk-detalhes-lote.css";

/*
 * D-PROD-213 — Resumo do Rebanho (Mapa Geral). Casca IGUAL à do Detalhes do
 * Lote v8 (PainelDetalhesLote): `.mk-dl.mk-dl8` com `data-modo`, menu de abas
 * fixo (`.mk-dl8__aba`, sublinhado verde) e corpo que rola; cartões, pílulas e
 * cores das peças do Detalhes do Lote (`pecas.jsx`). Estilos de casca em
 * src/styles/mk-detalhes-lote.css; nada de cor ou fonte nova aqui.
 * As contas ficam em src/domain/rebanho/resumoDoRebanho.js (puras).
 */

const ABAS = [
  { id: "rebanho", rotulo: "Rebanho" },
  { id: "pastos", rotulo: "Pastos" },
];

/** @param {number|null|undefined} v @param {number} [casas] */
const num = (v, casas = 0) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Rótulo eyebrow (o mesmo do NumerosDl). */
const EYEBROW = /** @type {React.CSSProperties} */ ({
  fontSize: 9, fontWeight: 700, lineHeight: 1.2, letterSpacing: "0.05em", textTransform: "uppercase", color: COR.meta,
});

/**
 * @param {{ posicoes: any[], areas: any[], categoriasManejo?: any[], hoje: string|null, abaInicial?: 'rebanho'|'pastos' }} props
 */
export default function PainelResumoRebanho(props) {
  return (
    <DlUiProvider>
      <Painel {...props} />
    </DlUiProvider>
  );
}

/** @param {{ posicoes: any[], areas: any[], categoriasManejo?: any[], hoje: string|null, abaInicial?: 'rebanho'|'pastos' }} props */
function Painel({ posicoes, areas, categoriasManejo = [], hoje, abaInicial = "rebanho" }) {
  const ui = useDlUi();
  const idBase = `mk-rr-${React.useId().replace(/:/g, "")}`;
  const [aba, setAba] = React.useState(abaInicial);
  const [fazenda, setFazenda] = React.useState(TODAS_FAZENDAS);

  const resumo = React.useMemo(
    () => resumoDoRebanho({ posicoes, areas, categoriasManejo, hoje, fazenda }),
    [posicoes, areas, categoriasManejo, hoje, fazenda],
  );
  // Uma fazenda do filtro que sumiu (troca de empresa) volta para "Todas".
  React.useEffect(() => {
    if (fazenda !== TODAS_FAZENDAS && !resumo.fazendas.some((f) => f.id === fazenda)) setFazenda(TODAS_FAZENDAS);
  }, [fazenda, resumo.fazendas]);

  const corpo = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  React.useEffect(() => {
    if (corpo.current) corpo.current.scrollTop = 0;
  }, [aba]);

  const aoTeclar = (/** @type {React.KeyboardEvent<HTMLDivElement>} */ e) => {
    const ids = ABAS.map((a) => a.id);
    const i = ids.indexOf(aba);
    let novo = -1;
    if (e.key === "ArrowRight") novo = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft") novo = (i - 1 + ids.length) % ids.length;
    if (novo < 0) return;
    e.preventDefault();
    setAba(/** @type {any} */ (ids[novo]));
    /** @type {HTMLElement | null} */ (document.getElementById(`${idBase}-aba-${ids[novo]}`))?.focus();
  };

  const opcoesFazenda = [{ id: TODAS_FAZENDAS, rotulo: "Todas" }, ...resumo.fazendas];

  return (
    <div className="mk-dl mk-dl8" data-modo={ui.modo} translate="no">
      <div className="mk-dl8__menu">
        <div
          role="tablist"
          aria-label="Seções"
          className="mk-dl8__abas"
          style={{ gridTemplateColumns: `repeat(${ABAS.length}, max-content)` }}
          onKeyDown={aoTeclar}
        >
          {ABAS.map((a) => {
            const ativa = a.id === aba;
            return (
              <button
                key={a.id}
                id={`${idBase}-aba-${a.id}`}
                type="button"
                role="tab"
                aria-selected={ativa}
                aria-controls={`${idBase}-painel`}
                tabIndex={ativa ? 0 : -1}
                className="mk-dl8__aba"
                onClick={() => setAba(/** @type {any} */ (a.id))}
              >
                <span className="mk-dl8__aba-rotulo">{a.rotulo}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div ref={corpo} className="mk-dl8__corpo">
        <div className="mk-dl8__deslize">
          <div key={aba} id={`${idBase}-painel`} role="tabpanel" aria-labelledby={`${idBase}-aba-${aba}`} className="mk-dl8__painel">
            {opcoesFazenda.length > 2 ? (
              <SeletorFazenda opcoes={opcoesFazenda} valor={fazenda} aoMudar={setFazenda} />
            ) : null}
            {aba === "rebanho" ? <AbaRebanho resumo={resumo} /> : <AbaPastos resumo={resumo} />}
            <p style={{ margin: "2px 2px 0", fontSize: 10, lineHeight: 1.4, color: COR.meta }}>
              Peso de hoje e de {DIAS_HORIZONTE} dias projetados pela curva de ganho. O ganho real aparece depois da segunda pesagem.
              {resumo.cabecasSemProjecao > 0
                ? ` ${num(resumo.cabecasSemProjecao)} ${resumo.cabecasSemProjecao === 1 ? "cabeça sem projeção usa" : "cabeças sem projeção usam"} o peso gravado.`
                : ""}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Pílula [Todas | Fazenda A | Fazenda B] — o mesmo seletor "Ver como" da aba Lotes.
 * @param {{ opcoes: Array<{ id: string, rotulo: string }>, valor: string, aoMudar: (v: string) => void }} props
 */
function SeletorFazenda({ opcoes, valor, aoMudar }) {
  const ui = useDlUi();
  const celular = ui.celular;
  return (
    <div
      role="group"
      aria-label="Fazenda"
      style={{
        display: "inline-flex", alignSelf: "flex-start", maxWidth: "100%", overflowX: "auto", gap: 2, padding: 3, height: 36,
        borderRadius: 999, background: "#fff", boxShadow: ui.sombraBtn, boxSizing: "border-box",
      }}
    >
      {opcoes.map((o) => {
        const ativa = o.id === valor;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={ativa}
            onClick={() => aoMudar(o.id)}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", height: "100%",
              padding: `0 ${celular ? 12 : 16}px`, border: 0, borderRadius: 999,
              background: ativa ? COR.ativo : "transparent", color: COR.titulo,
              fontSize: celular ? 12 : 13, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
            }}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** @param {{ resumo: import('@/domain/rebanho/resumoDoRebanho').ResumoRebanho }} props */
function AbaRebanho({ resumo }) {
  const ui = useDlUi();
  const celular = ui.celular;
  const ganho = resumo.arrobasGanho90;
  const cartoes = [
    { rotulo: "Cabeças", valor: num(resumo.cabecas), sub: `${resumo.categorias.length} categorias · ${resumo.pastos.length} pastos` },
    { rotulo: "Peso médio", valor: `${num(resumo.pesoMedioHoje)} kg`, sub: "Projetado hoje" },
    { rotulo: "Arrobas", valor: `${num(resumo.arrobasHoje)} @`, sub: "Peso vivo ÷ 30" },
    {
      rotulo: `Em ${DIAS_HORIZONTE} dias`,
      valor: ganho === null ? "—" : `${ganho >= 0 ? "+" : ""}${num(ganho)} @`,
      sub: `Peso médio ${num(resumo.pesoMedio90)} kg`,
      cor: COR.linha,
    },
  ];
  const colunas = celular ? "minmax(0, 1fr) 52px 62px 66px" : "minmax(0, 1fr) 80px 96px 96px";

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${ui.desktop ? 4 : 2}, minmax(0, 1fr))`, gap: 8 }}>
        {cartoes.map((c) => (
          <CartaoDl key={c.rotulo} gap={2} padding="10px 12px">
            <span style={EYEBROW}>{c.rotulo}</span>
            <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.25, color: c.cor || COR.titulo, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{c.valor}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: COR.meta }}>{c.sub}</span>
          </CartaoDl>
        ))}
      </div>

      <CartaoDl gap={0} padding="4px 10px">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0 4px" }}>
          <PilulaTitulo>{`Por categoria · ${resumo.categorias.length}`}</PilulaTitulo>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: colunas, gap: 8, padding: "4px 0", ...EYEBROW }}>
          <span>Categoria</span>
          <span style={{ textAlign: "right" }}>Cabeças</span>
          <span style={{ textAlign: "right" }}>Peso hoje</span>
          <span style={{ textAlign: "right" }}>{`Em ${DIAS_HORIZONTE} dias`}</span>
        </div>
        {resumo.categorias.length === 0 ? (
          <div style={{ padding: "8px 0", fontSize: 11, color: COR.meta }}>Nenhum animal no mapa.</div>
        ) : null}
        {resumo.categorias.map((c) => (
          <div
            key={c.nome}
            style={{
              display: "grid", gridTemplateColumns: colunas, alignItems: "center", gap: 8, minHeight: ui.linhaToque,
              padding: "5px 0", borderTop: `1px solid ${COR.divisor}`, fontSize: 11, fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: celular ? "normal" : "nowrap", fontWeight: 700, lineHeight: 1.25, color: COR.titulo }}>{c.nome}</span>
            <span style={{ textAlign: "right", fontWeight: 600, color: COR.texto }}>{num(c.cabecas)}</span>
            <span style={{ textAlign: "right", fontWeight: 700, color: COR.titulo }}>{`${num(c.pesoHoje)} kg`}</span>
            <span style={{ textAlign: "right", fontWeight: 600, color: COR.linha }}>{`${num(c.peso90)} kg`}</span>
          </div>
        ))}
      </CartaoDl>
    </>
  );
}

/** @param {{ resumo: import('@/domain/rebanho/resumoDoRebanho').ResumoRebanho }} props */
function AbaPastos({ resumo }) {
  const ui = useDlUi();
  const maxUa = Math.max(0, ...resumo.pastos.map((p) => p.uaHa ?? 0)) || 1;
  /** @type {React.CSSProperties} */
  const umaLinha = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <CartaoDl gap={0} padding="4px 10px">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0 4px" }}>
        <PilulaTitulo>{`Pastos · ${resumo.pastos.length}`}</PilulaTitulo>
        <span style={{ fontSize: 10, fontWeight: 600, color: COR.meta, whiteSpace: "nowrap" }}>{`Lotação em UA/ha · 1 UA = ${KG_POR_UA} kg`}</span>
      </div>
      {resumo.pastos.length === 0 ? (
        <div style={{ padding: "8px 0", fontSize: 11, color: COR.meta }}>Nenhum animal no mapa.</div>
      ) : null}
      {resumo.pastos.map((p) => (
        <div
          key={p.id}
          style={{
            display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${ui.celular ? 110 : 180}px`, alignItems: "center", gap: 10,
            minHeight: ui.linhaToque, padding: "5px 0", borderTop: `1px solid ${COR.divisor}`,
          }}
        >
          <span style={{ minWidth: 0 }}>
            <span style={{ ...umaLinha, fontSize: 11, fontWeight: 700, lineHeight: 1.25, color: COR.titulo }}>{p.nome}</span>
            <span style={{ ...umaLinha, fontSize: 10, fontWeight: 600, lineHeight: 1.3, color: COR.meta }}>
              {`${num(p.cabecas)} cab · peso ${num(p.pesoHoje)} kg${p.fazenda ? ` · ${p.fazenda}` : ""}`}
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span aria-hidden="true" style={{ flex: "1 1 auto", height: 6, borderRadius: 999, background: COR.divisor, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", borderRadius: 999, background: COR.barra, width: `${Math.max(0, Math.min(100, ((p.uaHa ?? 0) / maxUa) * 100))}%` }} />
            </span>
            <span style={{ flex: "0 0 auto", minWidth: 30, textAlign: "right", fontSize: 11, fontWeight: 700, color: COR.titulo, fontVariantNumeric: "tabular-nums" }}>
              {num(p.uaHa, 1)}
            </span>
          </span>
        </div>
      ))}
    </CartaoDl>
  );
}
