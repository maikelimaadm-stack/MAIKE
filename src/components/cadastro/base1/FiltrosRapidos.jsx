import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { B1Popover } from "./Base1Ui";
import { ROTULO_OPERADOR, tipoFiltroDaColuna } from "./cadastroColunaFiltroLogic";
import { cn } from "@/lib/utils";
import { nomesDaContagem, textoDoTotal } from "./contagemBase1";
import { useCelular } from "@/components/common/MobileSheet";

/**
 * Faixa de filtros rápidos do motor Base1 (D-PROD-161).
 *
 * O chrome da lista oferece o lugar (`FiltrosRapidosSlotContext`); quem desenha é a grade,
 * dona dos filtros e da ordenação — não existe um segundo estado de filtro.
 */

/** @type {React.Context<HTMLElement | null>} */
export const FiltrosRapidosSlotContext = React.createContext(/** @type {HTMLElement | null} */ (null));

/** Nome do registro na contagem da faixa ("lote"/"lotes") — vem do chrome da lista. */
export const ContagemNomesContext = React.createContext(nomesDaContagem(undefined, undefined));

/** Rótulo do filtro na faixa: a situação vira "Situação" (pergunta simples), o resto usa o nome da coluna. */
const rotuloDoFiltro = (/** @type {{ label: string; cellKind?: string } | undefined} */ col) =>
  col?.cellKind === "ativo-badge" || col?.cellKind === "situacao" ? "Situação" : col?.label ?? "";

const LIMITE_OPCOES = 100;
const MAX_AUTOMATICOS = 4;
const COLLATOR = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** @param {string} v */
const rotuloDoValor = (v) => (v === "" || v === "-" || v === "–" ? "Sem informação" : v);

/**
 * Opções de ordenação em palavras simples, derivadas das colunas.
 * @param {Array<{ id: string; label: string; sortable?: boolean; filterKind?: 'texto'|'num'|'data' }>} colunas
 */
export function opcoesDeOrdenacao(colunas) {
  /** @type {Array<{ key: string; dir: 'asc'|'desc'; label: string }>} */
  const opcoes = [];
  for (const c of colunas) {
    if (c.sortable === false) continue;
    const tipo = tipoFiltroDaColuna(c.id, c);
    if (tipo === "num") {
      opcoes.push({ key: c.id, dir: "asc", label: `${c.label} (menor primeiro)` });
      opcoes.push({ key: c.id, dir: "desc", label: `${c.label} (maior primeiro)` });
    } else if (tipo === "data") {
      opcoes.push({ key: c.id, dir: "desc", label: `${c.label} (mais recente)` });
      opcoes.push({ key: c.id, dir: "asc", label: `${c.label} (mais antiga)` });
    } else {
      opcoes.push({ key: c.id, dir: "asc", label: `${c.label} (A → Z)` });
      opcoes.push({ key: c.id, dir: "desc", label: `${c.label} (Z → A)` });
    }
  }
  return opcoes;
}

/**
 * Filtros que aparecem na faixa quando a tela não escolhe: a situação (ativo) e as
 * primeiras colunas com poucos valores distintos.
 * @param {Array<{ id: string; cellKind?: string }>} colunas
 * @param {object[]} linhas
 * @param {(linha: object, id: string) => unknown} valorDe
 */
export function filtrosRapidosAutomaticos(colunas, linhas, valorDe) {
  const escolhidos = colunas.filter((c) => c.cellKind === "ativo-badge" || c.cellKind === "situacao").map((c) => c.id);
  if (!linhas.length) return escolhidos.slice(0, MAX_AUTOMATICOS);
  for (const c of colunas) {
    if (escolhidos.length >= MAX_AUTOMATICOS) break;
    if (escolhidos.includes(c.id)) continue;
    const distintos = new Set();
    for (const l of linhas) {
      distintos.add(String(valorDe(l, c.id) ?? ""));
      if (distintos.size > 12) break;
    }
    if (distintos.size >= 2 && distintos.size <= 12 && distintos.size < linhas.length) escolhidos.push(c.id);
  }
  return escolhidos;
}

/** @param {string} chave */
function lerFaixa(chave) {
  try {
    const bruto = localStorage.getItem(chave);
    const lista = bruto ? JSON.parse(bruto) : null;
    return Array.isArray(lista) ? lista.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/** @param {string} chave @param {string[]} ids */
function gravarFaixa(chave, ids) {
  try {
    localStorage.setItem(chave, JSON.stringify(ids));
  } catch {
    /* storage indisponível */
  }
}

/** @param {{ valor: string; onChange: (v: string) => void; rotulo: string }} props */
function LinhaDePesquisa({ valor, onChange, rotulo }) {
  return (
    <div className="b1-pq">
      <input
        className="b1-pq__in"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Pesquisar…"
        aria-label={rotulo}
      />
      {valor ? (
        <button type="button" className="b1-pq__btn" aria-label="Limpar pesquisa" title="Limpar pesquisa" onClick={() => onChange("")}>
          <X size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Lista de marcar de um filtro: rascunho local, aplica no ✓.
 * @param {{
 *   rotulo: string,
 *   valores: string[],
 *   atual: Set<string> | null,
 *   totalDaLista: number,
 *   nomeDoTotal: (n: number) => string,
 *   onAplicar: (valores: Set<string> | null) => void,
 *   onCancelar: () => void,
 * }} props
 */
function ListaDeMarcar({ rotulo, valores, atual, totalDaLista, nomeDoTotal, onAplicar, onCancelar }) {
  const [rascunho, setRascunho] = useState(() => (atual ? new Set(atual) : null));
  const [busca, setBusca] = useState("");

  const { opcoes, contagem } = useMemo(() => {
    const mapa = new Map();
    for (const v of valores) mapa.set(v, (mapa.get(v) || 0) + 1);
    const lista = [...mapa.keys()].sort(
      (a, b) => Number(rotuloDoValor(a) === "Sem informação") - Number(rotuloDoValor(b) === "Sem informação") || COLLATOR.compare(a, b),
    );
    return { opcoes: lista, contagem: mapa };
  }, [valores]);

  const termo = busca.trim().toLowerCase();
  const filtradas = termo ? opcoes.filter((v) => rotuloDoValor(v).toLowerCase().includes(termo)) : opcoes;
  const visiveis = filtradas.slice(0, LIMITE_OPCOES);
  const previa = rascunho ? valores.filter((v) => rascunho.has(v)).length : valores.length;

  /** @param {string} v */
  const alternar = (v) =>
    setRascunho((p) => {
      const n = new Set(p ?? []);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n.size ? n : null;
    });

  return (
    <>
      {opcoes.length > 8 ? <LinhaDePesquisa valor={busca} onChange={setBusca} rotulo={`Pesquisar em ${rotulo}`} /> : null}
      <div className="b1-fr-lista" role="listbox" aria-multiselectable="true" aria-label={rotulo}>
        {!termo ? (
          <button type="button" role="option" aria-selected={!rascunho} className="b1-fr-op" onClick={() => setRascunho(null)}>
            <span className="b1-fr-op__txt">Todos</span>
            {!rascunho ? <Check className="b1-fr-op__visto" size={16} aria-hidden /> : null}
          </button>
        ) : null}
        {visiveis.length === 0 ? <div className="b1-fr-vazio">Nada encontrado</div> : null}
        {visiveis.map((v) => {
          const on = Boolean(rascunho?.has(v));
          return (
            <button key={v} type="button" role="option" aria-selected={on} className="b1-fr-op" onClick={() => alternar(v)}>
              <span className="b1-fr-op__txt">{rotuloDoValor(v)}</span>
              <span className="b1-fr-op__n">{contagem.get(v)}</span>
              <span className="b1-fr-op__marca" aria-hidden="true">
                {on ? <Check size={16} /> : null}
              </span>
            </button>
          );
        })}
        {filtradas.length > LIMITE_OPCOES ? (
          <div className="b1-fr-vazio">
            Mostrando {LIMITE_OPCOES} de {filtradas.length} — digite para encontrar
          </div>
        ) : null}
      </div>
      <div className="b1-fr-acoes">
        <button type="button" className="b1-fr-acoes__x" aria-label="Cancelar" title="Cancelar" onClick={onCancelar}>
          <X size={16} aria-hidden />
        </button>
        <span className="b1-fr-acoes__conta" aria-live="polite">
          {previa === totalDaLista ? nomeDoTotal(totalDaLista) : `${previa} de ${nomeDoTotal(totalDaLista)}`}
        </span>
        <button type="button" className="b1-fr-acoes__aplicar" aria-label="Aplicar" title="Aplicar" onClick={() => onAplicar(rascunho)}>
          <Check size={16} aria-hidden />
        </button>
      </div>
    </>
  );
}

/**
 * @param {object} props
 * @param {Array<{ id: string; label: string; sortable?: boolean; cellKind?: string; filterKind?: 'texto'|'num'|'data' }>} props.columns
 * @param {object[]} props.rows todas as linhas carregadas (antes dos filtros)
 * @param {(colId: string) => object[]} [props.rowsFor] linhas que passam pela busca e pelos OUTROS filtros (contagem de cada opção)
 * @param {(linha: object, id: string) => unknown} props.getFieldValue
 * @param {Record<string, { op: string; v1: string; v2: string; valores: Set<string> | null }>} props.filters
 * @param {(colId: string, filtro: { op: string; v1: string; v2: string; valores: Set<string> | null } | null) => void} props.onFilterChange
 * @param {() => void} props.onClearFilters
 * @param {{ key: string; direction: string }} props.sort
 * @param {(key: string, dir: 'asc'|'desc') => void} props.onSortChange
 * @param {string} props.storageKey
 * @param {string[]} [props.defaultIds] filtros da faixa quando o usuário ainda não escolheu
 * @param {number} [props.mostrados] linhas que passam por todos os filtros (contagem "5 de 12 lotes")
 */
export default function FiltrosRapidos({
  columns,
  rows,
  rowsFor,
  getFieldValue,
  filters,
  onFilterChange,
  onClearFilters,
  sort,
  onSortChange,
  storageKey,
  defaultIds,
  mostrados = undefined,
}) {
  const slot = useContext(FiltrosRapidosSlotContext);
  const nomes = useContext(ContagemNomesContext);
  // Celular (D-PROD-161): sem a faixa de pílulas — fica só o resumo; os filtros abrem pelo funil da barra.
  const celular = useCelular();
  const chipsRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const arrasto = useRef(/** @type {null | { x: number, pos: number, andou: boolean }} */ (null));
  const arrastou = useRef(false);

  // Faixa que não cabe: rola de lado; as pontas esmaecem e mostram seta só onde ainda há filtro escondido.
  const medirFaixa = useCallback(() => {
    const fx = chipsRef.current;
    if (!fx) return;
    const max = fx.scrollWidth - fx.clientWidth;
    const ini = max > 1 && fx.scrollLeft > 2;
    const fim = max > 1 && fx.scrollLeft < max - 2;
    for (const el of [fx, fx.parentElement]) {
      if (!el) continue;
      if (ini) el.setAttribute("data-esc-ini", "");
      else el.removeAttribute("data-esc-ini");
      if (fim) el.setAttribute("data-esc-fim", "");
      else el.removeAttribute("data-esc-fim");
    }
  }, []);
  useLayoutEffect(() => {
    medirFaixa();
  });
  useEffect(() => {
    window.addEventListener("resize", medirFaixa);
    return () => window.removeEventListener("resize", medirFaixa);
  }, [medirFaixa]);
  /** @param {number} sentido */
  const rolarFaixa = (sentido) => {
    const fx = chipsRef.current;
    if (!fx) return;
    const passo = Math.max(160, Math.round(fx.clientWidth * 0.7));
    fx.scrollTo({ left: fx.scrollLeft + sentido * passo, behavior: "smooth" });
  };
  /** @param {React.WheelEvent<HTMLDivElement>} e roda vertical do mouse rola a faixa de lado */
  const rodaNaFaixa = (e) => {
    const fx = chipsRef.current;
    if (!fx || fx.scrollWidth <= fx.clientWidth + 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    fx.scrollLeft += e.deltaY;
  };
  /** @param {React.PointerEvent<HTMLDivElement>} e arrastar a faixa com o mouse (no toque a rolagem já é nativa) */
  const iniciarArrasto = (e) => {
    const fx = chipsRef.current;
    if (e.pointerType !== "mouse" || e.button !== 0 || !fx || fx.scrollWidth <= fx.clientWidth + 1) return;
    arrasto.current = { x: e.clientX, pos: fx.scrollLeft, andou: false };
  };
  /** @param {React.PointerEvent<HTMLDivElement>} e */
  const moverArrasto = (e) => {
    const a = arrasto.current;
    const fx = chipsRef.current;
    if (!a || !fx) return;
    const dx = e.clientX - a.x;
    if (!a.andou && Math.abs(dx) < 5) return;
    a.andou = true;
    fx.setAttribute("data-arrastando", "");
    fx.scrollLeft = a.pos - dx;
  };
  const terminarArrasto = () => {
    const a = arrasto.current;
    if (!a) return;
    arrasto.current = null;
    chipsRef.current?.removeAttribute("data-arrastando");
    if (a.andou) {
      arrastou.current = true;
      setTimeout(() => {
        arrastou.current = false;
      }, 0);
    }
  };
  const chave = `${storageKey}_filtrosRapidos`;
  const [salvos, setSalvos] = useState(() => lerFaixa(chave));
  const [aberto, setAberto] = useState(/** @type {string | null} */ (null));
  const [buscaCampo, setBuscaCampo] = useState("");

  useEffect(() => {
    setSalvos(lerFaixa(chave));
  }, [chave]);

  const porId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const automaticos = useMemo(
    () => (defaultIds ? defaultIds : filtrosRapidosAutomaticos(columns, rows, getFieldValue)),
    [defaultIds, columns, rows, getFieldValue],
  );
  const fixos = useMemo(() => (salvos ?? automaticos).filter((id) => porId.has(id)), [salvos, automaticos, porId]);
  // Coluna filtrada por outro caminho (menu ⋮, "Filtrar por campo") também aparece na faixa.
  const naFaixa = useMemo(
    () => [...fixos, ...Object.keys(filters).filter((id) => porId.has(id) && !fixos.includes(id))],
    [fixos, filters, porId],
  );
  const ordens = useMemo(() => opcoesDeOrdenacao(columns), [columns]);

  if (!slot) return null;

  const ordemAtual =
    ordens.find((o) => o.key === sort.key && o.dir === (sort.direction === "desc" ? "desc" : "asc"))?.label ??
    `${porId.get(sort.key)?.label ?? "Ordenar"} ${sort.direction === "desc" ? "↓" : "↑"}`;
  const temFiltro = Object.keys(filters).length > 0;
  const nomeDoTotal = (/** @type {number} */ n) => `${n} registro${n === 1 ? "" : "s"}`;

  /** @param {string} id */
  const alternarNaFaixa = (id) => {
    const proximo = fixos.includes(id) ? fixos.filter((x) => x !== id) : [...fixos, id];
    if (naFaixa.includes(id) && filters[id]) onFilterChange(id, null);
    setSalvos(proximo);
    gravarFaixa(chave, proximo);
  };

  /** @param {string} id */
  const linhasDe = (id) => (rowsFor ? rowsFor(id) : rows);
  /** @param {string} id */
  const valoresDaColuna = (id) => linhasDe(id).map((r) => String(getFieldValue(r, id) ?? ""));

  const termoCampo = buscaCampo.trim().toLowerCase();

  const totalDeLinhas = rows.length;
  const conta = textoDoTotal({ mostrados: mostrados ?? totalDeLinhas, totais: totalDeLinhas, nomes });

  /** @param {string} id */
  const chipDoFiltro = (id) => {
    const col = porId.get(id);
    const rotulo = rotuloDoFiltro(col);
    const f = filters[id];
    const n = f?.valores ? f.valores.size : 0;
    const regra = f?.op ? `${ROTULO_OPERADOR[f.op] ?? f.op} ${f.v1}${f.op === "entre" ? ` e ${f.v2}` : ""}`.trim() : "";
    const ativo = Boolean(f) && (n > 0 || Boolean(regra));
    const marcados = n === 1 ? rotuloDoValor([.../** @type {Set<string>} */ (f.valores)][0]) : n > 1 ? `${n} escolhidos` : "";
    const valor = ativo ? [marcados, regra].filter(Boolean).join(" · ") : "";
    const aberta = aberto === id;
    return (
      <span key={id} className={cn("b1-fr-chip", ativo && "is-on", aberta && "is-open")}>
        <B1Popover
          open={aberta}
          onOpenChange={(o) => setAberto(o ? id : null)}
          align="start"
          className="b1-fr-pop"
          trigger={
            <button type="button" className="b1-fr-chip__btn" aria-haspopup="dialog" aria-expanded={aberta}>
              <span className="b1-fr-chip__rot">{rotulo}</span>
              {valor ? <span className="b1-fr-chip__val">{valor}</span> : null}
              {!ativo ? <ChevronDown className="b1-fr-chip__seta" size={14} aria-hidden /> : null}
            </button>
          }
        >
          {aberta ? (
            <ListaDeMarcar
              rotulo={rotulo || id}
              valores={valoresDaColuna(id)}
              atual={f?.valores ?? null}
              totalDaLista={linhasDe(id).length}
              nomeDoTotal={nomeDoTotal}
              onCancelar={() => setAberto(null)}
              onAplicar={(valores) => {
                const temCondicao = Boolean(f?.op);
                if (!valores && !temCondicao) onFilterChange(id, null);
                else onFilterChange(id, { op: f?.op ?? "", v1: f?.v1 ?? "", v2: f?.v2 ?? "", valores });
                setAberto(null);
              }}
            />
          ) : null}
        </B1Popover>
        {ativo ? (
          <button
            type="button"
            className="b1-fr-chip__x"
            aria-label={`Tirar filtro de ${rotulo}`}
            title={`Tirar filtro de ${rotulo}`}
            onClick={(e) => {
              e.stopPropagation();
              onFilterChange(id, null);
            }}
          >
            <X size={13} aria-hidden />
          </button>
        ) : null}
      </span>
    );
  };

  const ordemAberta = aberto === "#ordem";
  const maisAberto = aberto === "#mais";

  return createPortal(
    <div className="b1-fr no-print" data-testid="b1-filtros-rapidos">
      {celular ? null : (
      <div className="b1-fr__faixa">
        <div className="b1-fr__trilho">
          <button
            type="button"
            className="b1-fr__seta b1-fr__seta--ini"
            tabIndex={-1}
            aria-label="Ver filtros anteriores"
            title="Ver filtros anteriores"
            onClick={(e) => {
              e.stopPropagation();
              rolarFaixa(-1);
            }}
          >
            <ChevronLeft aria-hidden />
          </button>
          <div
            ref={chipsRef}
            className="b1-fr__chips"
            role="toolbar"
            aria-label="Filtros rápidos"
            onScroll={medirFaixa}
            onWheel={rodaNaFaixa}
            onPointerDown={iniciarArrasto}
            onPointerMove={moverArrasto}
            onPointerUp={terminarArrasto}
            onPointerCancel={terminarArrasto}
            onClickCapture={(e) => {
              if (!arrastou.current) return;
              arrastou.current = false;
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <span className={cn("b1-fr-chip b1-fr-chip--ordem", ordemAberta && "is-open")}>
              <B1Popover
                open={ordemAberta}
                onOpenChange={(o) => setAberto(o ? "#ordem" : null)}
                align="start"
                className="b1-fr-pop"
                trigger={
                  <button type="button" className="b1-fr-chip__btn" aria-haspopup="dialog" aria-expanded={ordemAberta} aria-label="Ordenar" title="Ordenar">
                    <ArrowUpDown className="b1-fr-chip__ic" size={14} aria-hidden />
                    <span className="b1-fr-chip__val">{ordemAtual}</span>
                    <ChevronDown className="b1-fr-chip__seta" size={14} aria-hidden />
                  </button>
                }
              >
                <div className="b1-fr-lista" role="listbox" aria-label="Ordenar">
                  {ordens.map((o) => {
                    const on = o.key === sort.key && o.dir === (sort.direction === "desc" ? "desc" : "asc");
                    return (
                      <button
                        key={`${o.key}:${o.dir}`}
                        type="button"
                        role="option"
                        aria-selected={on}
                        className="b1-fr-op"
                        onClick={() => {
                          onSortChange(o.key, o.dir);
                          setAberto(null);
                        }}
                      >
                        <span className="b1-fr-op__txt">{o.label}</span>
                        <span className="b1-fr-op__marca" aria-hidden="true">
                          {on ? <Check size={16} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </B1Popover>
            </span>
            <span className="b1-fr__sep" aria-hidden="true" />
            {naFaixa.map(chipDoFiltro)}
          </div>
          <button
            type="button"
            className="b1-fr__seta b1-fr__seta--fim"
            tabIndex={-1}
            aria-label="Ver mais filtros"
            title="Ver mais filtros"
            onClick={(e) => {
              e.stopPropagation();
              rolarFaixa(1);
            }}
          >
            <ChevronRight aria-hidden />
          </button>
        </div>
        <span className="b1-fr__sep" aria-hidden="true" />
        <B1Popover
          open={maisAberto}
          onOpenChange={(o) => {
            setAberto(o ? "#mais" : null);
            setBuscaCampo("");
          }}
          align="start"
          className="b1-fr-pop"
          trigger={
            <button
              type="button"
              className={cn("b1-fr-add", maisAberto && "is-open")}
              aria-haspopup="dialog"
              aria-expanded={maisAberto}
              aria-label="Adicionar ou tirar filtros"
              title="Adicionar ou tirar filtros"
            >
              <Plus size={14} aria-hidden />
              <span>Filtro</span>
            </button>
          }
        >
          {columns.length > 8 ? <LinhaDePesquisa valor={buscaCampo} onChange={setBuscaCampo} rotulo="Pesquisar campo" /> : null}
          <div className="b1-fr-lista" role="listbox" aria-multiselectable="true" aria-label="Filtros da faixa">
            {columns
              .filter((c) => !termoCampo || rotuloDoFiltro(c).toLowerCase().includes(termoCampo))
              .map((c) => {
                const on = naFaixa.includes(c.id);
                return (
                  <button key={c.id} type="button" role="option" aria-selected={on} className="b1-fr-op" onClick={() => alternarNaFaixa(c.id)}>
                    <span className="b1-fr-op__txt">{rotuloDoFiltro(c)}</span>
                    <span className="b1-fr-op__marca" aria-hidden="true">
                      {on ? <Check size={16} /> : null}
                    </span>
                  </button>
                );
              })}
          </div>
        </B1Popover>
      </div>
      )}
      <div className="b1-fr__resumo" aria-live="polite" data-conta={conta}>
        {temFiltro ? (
          <button type="button" className="b1-fr__limpar" onClick={onClearFilters}>
            Limpar filtros
          </button>
        ) : null}
      </div>
    </div>,
    slot,
  );
}
