import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { casaNoFiltroColuna, operadoresParaTipo, tipoFiltroDaColuna } from "./cadastroColunaFiltroLogic";
import { cn } from "@/lib/utils";
import { nomesDaContagem, textoDoTotal } from "./contagemBase1";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";

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

/** Coluna sem condição no filtro rápido (só marcar valores): situação e cor. */
const semCondicao = (/** @type {{ cellKind?: string } | undefined} */ col) =>
  col?.cellKind === "ativo-badge" || col?.cellKind === "situacao" || col?.cellKind === "cor";

/** @param {string} v dd/mm/aaaa → aaaa-mm-dd (campo de data) */
const isoDeBr = (v) => {
  const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
/** @param {string} v aaaa-mm-dd → dd/mm/aaaa */
const brDeIso = (v) => {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
/** @param {string} v dd/mm/aaaa → número ordenável */
const ordemDeData = (v) => {
  const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
};

/**
 * @typedef {{ op: string, v1: string, v2: string, valores: Set<string> | null }} FiltroDaColuna
 * @typedef {{ valores: string[] | null, op: string, v1: string, v2: string }} RascunhoDoFiltro
 */

/** Condição completa? (Está entre precisa dos dois valores) @param {{ op?: string, v1?: string, v2?: string } | null | undefined} f */
const regraValida = (f) => Boolean(f && f.op && String(f.v1 || "").trim() !== "" && (f.op !== "entre" || String(f.v2 || "").trim() !== ""));

/**
 * Condição em palavras, como na pílula do design: "é maior do que 15", "entre 1 e 3".
 * @param {{ op?: string, v1?: string, v2?: string } | null | undefined} f
 * @param {'texto'|'num'|'data'} tipo
 */
export function textoDaRegra(f, tipo) {
  if (!regraValida(f) || !f) return "";
  const rot = (operadoresParaTipo(tipo).find(([k]) => k === f.op) || [])[1] || f.op || "";
  return f.op === "entre" ? `entre ${f.v1} e ${f.v2}` : `${rot.toLowerCase()} ${f.v1}`;
}

/**
 * Janela da faixa (filtro, ordenar, "+ Filtro"): mesma janela branca das listas do design
 * (`mk-sel-pop b1-lista-pop b1-fr-pop`), 6px abaixo do botão, alinhada à esquerda dele.
 * @param {{ open: boolean, onOpenChange: (o: boolean) => void, trigger: React.ReactElement, rotulo: string, children: React.ReactNode }} props
 */
function JanelaDaFaixa({ open, onOpenChange, trigger, rotulo, children }) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
          aria-label={rotulo}
          className="mk-sel-pop b1-lista-pop b1-fr-pop"
          onOpenAutoFocus={(e) => {
            // Foco no campo de pesquisa quando houver; senão fica no botão (não rola a lista).
            const raiz = /** @type {HTMLElement | null} */ (e.currentTarget);
            const alvo = raiz?.querySelector?.(".b1-fr-campo");
            e.preventDefault();
            if (alvo instanceof HTMLElement) alvo.focus();
          }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Caixa de marcar da linha (✓ desenhado; `unica` = só o visto, sem caixa — Ordenar). @param {{ unica?: boolean }} props */
function CaixaDaLinha({ unica = false }) {
  return (
    <span className={cn("b1-fr-box", unica && "b1-fr-box--unica")} aria-hidden="true">
      <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m2 6 3 3 5-6" />
      </svg>
    </span>
  );
}

/**
 * Linha das janelas da faixa.
 * @param {{ rotulo: string, on: boolean, onClick: () => void, conta?: string, cor?: string, unica?: boolean }} props
 */
function LinhaDaJanela({ rotulo, on, onClick, conta = "", cor = "", unica = false }) {
  return (
    <button type="button" role="option" aria-selected={on} className="mk-sel-op b1-fr-op" onClick={onClick}>
      <CaixaDaLinha unica={unica} />
      {cor ? <span className="b1-cor-dot" style={{ backgroundColor: cor }} aria-hidden="true" /> : null}
      <span className="b1-fr-op__txt">{rotulo}</span>
      {conta ? <span className="b1-fr-op__n">{conta}</span> : null}
    </button>
  );
}

/**
 * Campo único de pesquisa no topo das janelas ("Pesquisar…"); com condição escolhida ele é o valor dela.
 * @param {{ valor: string, onChange: (v: string) => void, onLimpar: () => void, placeholder?: string, rotulo?: string,
 *   tipo?: string, modo?: string, condicao?: React.ReactNode, depois?: React.ReactNode }} props
 */
function CampoDaJanela({ valor, onChange, onLimpar, placeholder = "Pesquisar…", rotulo = "Pesquisar", tipo = "text", modo = undefined, condicao = null, depois = null }) {
  return (
    <div className="b1-fr-campos">
      <div className="b1-pq">
        <input
          className="b1-pq__in b1-fr-campo"
          type={tipo}
          inputMode={/** @type {any} */ (modo)}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder={placeholder}
          aria-label={rotulo}
        />
        {valor ? (
          <button type="button" className="b1-pq__btn b1-pq__x" tabIndex={-1} aria-label="Limpar pesquisa" title="Limpar pesquisa" onClick={onLimpar}>
            <X size={14} aria-hidden />
          </button>
        ) : null}
        {condicao}
      </div>
      {depois}
    </div>
  );
}

/**
 * Janela do filtro de uma pílula: pesquisa (ou valor da condição), "Condição ⌄", valores para marcar com a contagem,
 * e no rodapé ✕ · contagem · ✓. Tudo é rascunho até o ✓ (D-PROD-161).
 * @param {{
 *   rotulo: string,
 *   tipo: 'texto'|'num'|'data',
 *   comCondicao: boolean,
 *   corNomes?: Readonly<Record<string, string>>,
 *   ehCor: boolean,
 *   valoresDaBase: string[],
 *   atual: FiltroDaColuna | null,
 *   contarComo: (rascunho: FiltroDaColuna | null) => string,
 *   onAplicar: (filtro: FiltroDaColuna | null) => void,
 *   onCancelar: () => void,
 *   semRodape?: boolean,
 *   controleRef?: { current: null | { aplicar: () => void } },
 *   onConta?: (texto: string) => void,
 * }} props
 */
function JanelaDoFiltro({ rotulo, tipo, comCondicao, corNomes, ehCor, valoresDaBase, atual, contarComo, onAplicar, onCancelar, semRodape = false, controleRef = undefined, onConta = undefined }) {
  const [rasc, setRasc] = useState(/** @type {RascunhoDoFiltro} */ ({
    valores: atual?.valores ? [...atual.valores] : null,
    op: atual?.op ?? "",
    v1: atual?.v1 ?? "",
    v2: atual?.v2 ?? "",
  }));
  const [busca, setBusca] = useState("");
  const [opAberto, setOpAberto] = useState(false);
  const ehData = tipo === "data";
  const txt = (/** @type {string} */ v) => {
    if (v === "" || v === "-" || v === "–") return "Sem informação";
    return ehCor ? corNomes?.[v.toLowerCase()] ?? v : v;
  };

  const { valores, contagem } = useMemo(() => {
    const mapa = new Map();
    for (const v of valoresDaBase) mapa.set(v, (mapa.get(v) || 0) + 1);
    const vazio = (/** @type {string} */ v) => v === "" || v === "-" || v === "–";
    const lista = [...mapa.keys()].sort(
      (a, b) =>
        Number(vazio(a)) - Number(vazio(b)) ||
        (ehData ? ordemDeData(a) - ordemDeData(b) : COLLATOR.compare(txt(a), txt(b))),
    );
    return { valores: lista, contagem: mapa };
  }, [valoresDaBase, ehData]);

  const op = rasc.op || "";
  const comRegra = regraValida(rasc);
  const termo = op ? "" : busca.trim().toLowerCase();
  const extras = (rasc.valores || []).filter((v) => !contagem.has(v));
  const todos = extras.length ? [...valores, ...extras] : valores;
  let visiveis = todos.filter((v) =>
    comRegra
      ? casaNoFiltroColuna({ op, v1: rasc.v1, v2: rasc.v2, valores: null }, tipo, v)
      : !termo || txt(v).toLowerCase().includes(termo),
  );
  let maisOpcoes = "";
  if (visiveis.length > LIMITE_OPCOES) {
    const marcados = rasc.valores ? visiveis.filter((v) => rasc.valores?.includes(v)) : [];
    const resto = visiveis.filter((v) => !rasc.valores?.includes(v));
    maisOpcoes = `Mostrando ${Math.max(LIMITE_OPCOES, marcados.length)} de ${visiveis.length.toLocaleString("pt-BR")} — digite para encontrar`;
    visiveis = [...marcados, ...resto.slice(0, Math.max(0, LIMITE_OPCOES - marcados.length))];
  }

  /** @returns {FiltroDaColuna | null} o que o ✓ aplicaria */
  const limpo = () => {
    const temValores = Boolean(rasc.valores && rasc.valores.length);
    const temRegra = regraValida(rasc);
    if (!temValores && !temRegra) return null;
    return {
      op: temRegra ? op : "",
      v1: temRegra ? rasc.v1 : "",
      v2: temRegra && op === "entre" ? rasc.v2 : "",
      valores: temValores ? new Set(rasc.valores) : null,
    };
  };

  /** @param {string} v */
  const alternar = (v) =>
    setRasc((r) => {
      const at = r.valores || [];
      const prox = at.includes(v) ? at.filter((x) => x !== v) : [...at, v];
      return { ...r, valores: prox.length ? prox : null };
    });

  const ops = operadoresParaTipo(tipo);
  const rotuloOp = (/** @type {string} */ k) => (ops.find(([x]) => x === k) || ops[0])[1];
  const opPadrao = tipo === "texto" ? "cont" : "ig";
  // Um campo só: sem condição procura na lista; com condição é o valor dela.
  const usaValor = Boolean(op);
  const valorDoCampo = usaValor ? (ehData ? isoDeBr(rasc.v1) : rasc.v1) : busca;

  const condicao = comCondicao ? (
    <button
      type="button"
      role="combobox"
      aria-label="Condição"
      title="Condição"
      aria-expanded={opAberto}
      className={cn("b1-pq__cond b1-fr-regra__sel", op && "is-on")}
      onClick={() => setOpAberto((a) => !a)}
    >
      <span className="b1-fr-regra__sel-l">{op ? rotuloOp(op) : "Condição"}</span>
      <ChevronDown className="b1-fr-regra__sel-c" size={14} aria-hidden />
    </button>
  ) : null;

  const segundoValor =
    comCondicao && op === "entre" ? (
      <div className="b1-pq">
        <input
          className="b1-pq__in b1-fr-campo"
          type={ehData ? "date" : "text"}
          inputMode={tipo === "num" ? "decimal" : undefined}
          value={ehData ? isoDeBr(rasc.v2) : rasc.v2}
          onChange={(e) => setRasc((r) => ({ ...r, v2: ehData ? brDeIso(e.target.value) : e.target.value }))}
          placeholder="Até"
          aria-label="Até"
        />
      </div>
    ) : null;

  const listaDeCondicoes =
    comCondicao && opAberto ? (
      <div className="b1-fr-regra__lista" role="listbox" aria-label="Condição">
        {ops.map(([k, rot]) => (
          <button
            key={k || "sem"}
            type="button"
            role="option"
            aria-selected={op === k}
            className={cn("mk-sel-op b1-fr-op b1-fr-regra__opt", op === k && "is-on")}
            onClick={() => {
              setOpAberto(false);
              if (!k) {
                setRasc((r) => ({ ...r, op: "", v1: "", v2: "" }));
                return;
              }
              // O que já estava escrito na pesquisa vira o valor da condição.
              const escrito = busca.trim();
              setRasc((r) => ({ ...r, op: k, v1: r.v1 || (ehData ? "" : escrito) }));
              if (escrito) setBusca("");
            }}
          >
            <span className="b1-fr-op__txt">{rot}</span>
            {op === k ? <Check className="mk-sel-op__check" size={15} aria-hidden /> : null}
          </button>
        ))}
      </div>
    ) : null;

  const pesquisavel = comCondicao || valores.length > 8;
  const filtrandoPorRegra = comRegra;
  const conta = contarComo(limpo());
  // Na folha do celular o ✓ e a contagem ficam no topo da folha (fora desta janela).
  if (controleRef) controleRef.current = { aplicar: () => onAplicar(limpo()) };
  useEffect(() => {
    onConta?.(conta);
  }, [conta, onConta]);

  return (
    <>
      {pesquisavel ? (
        <CampoDaJanela
          valor={valorDoCampo}
          tipo={usaValor && ehData ? "date" : "text"}
          modo={usaValor && tipo === "num" ? "decimal" : undefined}
          placeholder={op === "entre" ? "De" : "Pesquisar…"}
          rotulo={op === "entre" ? "De" : "Pesquisar"}
          onChange={(v) => {
            if (usaValor) setRasc((r) => ({ ...r, v1: ehData ? brDeIso(v) : v }));
            else setBusca(v);
          }}
          onLimpar={() => (usaValor ? setRasc((r) => ({ ...r, v1: "" })) : setBusca(""))}
          condicao={condicao}
          depois={
            <>
              {segundoValor}
              {listaDeCondicoes}
            </>
          }
        />
      ) : null}
      <div className="mk-sel-lista b1-lista b1-fr-lista" role="listbox" aria-multiselectable="true" aria-label={rotulo}>
        {!termo && !filtrandoPorRegra ? (
          <button
            type="button"
            role="option"
            aria-selected={!rasc.valores}
            className="mk-sel-op b1-fr-op b1-fr-op--todos"
            onClick={() => setRasc((r) => ({ ...r, valores: null }))}
          >
            <span className="b1-fr-op__txt">Todos</span>
            {!rasc.valores ? <Check className="mk-sel-op__check" size={15} aria-hidden /> : null}
          </button>
        ) : null}
        {visiveis.length === 0 ? <div className="mk-sel-vazio">Nada encontrado</div> : null}
        {visiveis.map((v) => (
          <LinhaDaJanela
            key={v || "∅"}
            rotulo={txt(v)}
            on={Boolean(rasc.valores?.includes(v))}
            conta={(contagem.get(v) || 0).toLocaleString("pt-BR")}
            cor={ehCor && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : ""}
            onClick={() => alternar(v)}
          />
        ))}
        {maisOpcoes ? <div className="b1-fr-maisopc">{maisOpcoes}</div> : null}
      </div>
      {semRodape ? null : (
        <div className="b1-fr-acoes">
          <button type="button" className="b1-fr-acoes__x" title="Cancelar" aria-label="Cancelar" onClick={onCancelar}>
            <X size={16} aria-hidden />
          </button>
          <div className="b1-fr-acoes__meio">
            <span className="b1-fr-acoes__conta" aria-live="polite">
              {conta}
            </span>
          </div>
          <button type="button" className="mk-btn-ok b1-fr-acoes__aplicar" title="Aplicar" aria-label="Aplicar" onClick={() => onAplicar(limpo())}>
            <Check size={16} aria-hidden />
          </button>
        </div>
      )}
    </>
  );
}

/**
 * @param {object} props
 * @param {Array<{ id: string; label: string; sortable?: boolean; cellKind?: string; filterKind?: 'texto'|'num'|'data'; corNomes?: Readonly<Record<string, string>> }>} props.columns
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
 * @param {Array<{ key: string; dir: 'asc'|'desc'; label: string }>} [props.ordens] opções de "Ordenar" em palavras da tela
 *   (sem elas, saem das colunas)
 * @param {string[]} [props.camposDaFaixa] ordem dos campos em "+ Filtro" (sem ela, a ordem das colunas)
 * @param {boolean} [props.menuCelularAberto] celular: o funil da barra pediu a lista "Filtros"
 * @param {(aberto: boolean) => void} [props.onMenuCelularChange]
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
  ordens: ordensDaTela = undefined,
  camposDaFaixa = undefined,
  menuCelularAberto = false,
  onMenuCelularChange = undefined,
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
  // Celular (D-PROD-161, 6.10): o funil abre a folha "Filtros"; dela se vai a Ordenar, a cada filtro e ao "+".
  const [folha, setFolha] = useState(/** @type {null | 'menu' | 'ordem' | 'mais' | { fr: string }} */ (null));
  const [contaDaFolha, setContaDaFolha] = useState("");
  const controleDaFolha = useRef(/** @type {null | { aplicar: () => void }} */ (null));
  useEffect(() => {
    if (celular && menuCelularAberto && !folha) setFolha("menu");
    if (!menuCelularAberto && folha) setFolha(null);
  }, [celular, menuCelularAberto]);

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
  const ordens = useMemo(() => ordensDaTela ?? opcoesDeOrdenacao(columns), [ordensDaTela, columns]);
  const camposDoMais = useMemo(() => {
    if (!camposDaFaixa) return columns;
    const lista = camposDaFaixa.map((id) => porId.get(id)).filter(Boolean);
    return [...lista, ...columns.filter((c) => !camposDaFaixa.includes(c.id))];
  }, [camposDaFaixa, columns, porId]);

  if (!slot) return null;

  const ordemAtual =
    ordens.find((o) => o.key === sort.key && o.dir === (sort.direction === "desc" ? "desc" : "asc"))?.label ??
    `${porId.get(sort.key)?.label ?? "Ordenar"} ${sort.direction === "desc" ? "↓" : "↑"}`;
  const temFiltro = Object.keys(filters).length > 0;

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

  /** Tudo o que a pílula e a janela de um filtro precisam. @param {string} id */
  const infoDoFiltro = (id) => {
    const col = porId.get(id);
    const rotulo = rotuloDoFiltro(col);
    const tipo = tipoFiltroDaColuna(id, col);
    const ehCor = col?.cellKind === "cor";
    const txtValor = (/** @type {string} */ v) => (ehCor ? col?.corNomes?.[v.toLowerCase()] ?? v : rotuloDoValor(v));
    const f = filters[id];
    const n = f?.valores ? f.valores.size : 0;
    const regra = textoDaRegra(f, tipo);
    const ativo = Boolean(f) && (n > 0 || Boolean(regra));
    const marcados = n === 1 ? txtValor([.../** @type {Set<string>} */ (f.valores)][0]) : n > 1 ? `${n} escolhidos` : "";
    const valor = ativo ? [marcados, regra].filter(Boolean).join(" · ") : "";
    return { col, rotulo, tipo, ehCor, f, ativo, valor };
  };

  /**
   * Janela (ou folha) do filtro de uma coluna.
   * @param {string} id
   * @param {{ onAplicar: (novo: FiltroDaColuna | null) => void, onCancelar: () => void, semRodape?: boolean }} opc
   */
  const janelaDoFiltro = (id, { onAplicar, onCancelar, semRodape = false }) => {
    const { col, rotulo, tipo, ehCor, f } = infoDoFiltro(id);
    const base = linhasDe(id);
    return (
      <JanelaDoFiltro
        rotulo={rotulo || id}
        tipo={tipo}
        comCondicao={!semCondicao(col)}
        corNomes={col?.corNomes}
        ehCor={ehCor}
        valoresDaBase={base.map((r) => String(getFieldValue(r, id) ?? ""))}
        atual={f ?? null}
        contarComo={(previa) =>
          textoDoTotal({
            mostrados: previa ? base.filter((r) => casaNoFiltroColuna(previa, tipo, String(getFieldValue(r, id) ?? ""))).length : base.length,
            totais: rows.length,
            nomes,
          })
        }
        onCancelar={onCancelar}
        onAplicar={onAplicar}
        semRodape={semRodape}
        controleRef={semRodape ? controleDaFolha : undefined}
        onConta={semRodape ? setContaDaFolha : undefined}
      />
    );
  };

  /** @param {string} id */
  const chipDoFiltro = (id) => {
    const { rotulo, ativo, valor } = infoDoFiltro(id);
    const aberta = aberto === id;
    return (
      <span key={id} className={cn("b1-fr-chip", ativo && "is-on", aberta && "is-open")}>
        <JanelaDaFaixa
          open={aberta}
          onOpenChange={(o) => setAberto(o ? id : null)}
          rotulo={rotulo || id}
          trigger={
            <button type="button" className="b1-fr-chip__btn" aria-haspopup="dialog" aria-expanded={aberta}>
              <span className="b1-fr-chip__rot">{rotulo}</span>
              {valor ? <span className="b1-fr-chip__val">{valor}</span> : null}
              {!ativo ? <ChevronDown className="b1-fr-chip__seta" size={14} aria-hidden /> : null}
            </button>
          }
        >
          {aberta
            ? janelaDoFiltro(id, {
                onCancelar: () => setAberto(null),
                onAplicar: (novo) => {
                  onFilterChange(id, novo);
                  setAberto(null);
                },
              })
            : null}
        </JanelaDaFaixa>
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

  const fecharFolhas = () => {
    setFolha(null);
    onMenuCelularChange?.(false);
  };
  const voltarAoMenu = () => setFolha("menu");
  /** @param {() => void} aoTocar @param {string} rotulo */
  const botaoOk = (aoTocar, rotulo = "Aplicar") => (
    <button type="button" className="mk-sheet__new mk-btn-ok" aria-label={rotulo} title={rotulo} onClick={aoTocar}>
      <Check aria-hidden />
    </button>
  );
  let folhaCelular = null;
  if (celular && folha) {
    let titulo = "";
    let aside = "";
    /** @type {React.ReactNode} */
    let acao = null;
    /** @type {React.ReactNode} */
    let corpo = null;
    let aoFechar = voltarAoMenu;
    if (folha === "menu") {
      titulo = "Filtros";
      aside = conta;
      aoFechar = fecharFolhas;
      acao = (
        <button
          type="button"
          className="mk-sheet__new"
          aria-label="Adicionar filtro"
          title="Adicionar filtro"
          onClick={() => {
            setBuscaCampo("");
            setFolha("mais");
          }}
        >
          <Plus aria-hidden />
        </button>
      );
      const itens = [
        { id: "#ordem", rotulo: "Ordenar", valor: ordemAtual, ativo: false },
        ...naFaixa.map((id) => {
          const info = infoDoFiltro(id);
          return { id, rotulo: info.rotulo, valor: info.valor || "Todos", ativo: info.ativo };
        }),
      ];
      corpo = (
        <>
          <div className="mk-sel-lista b1-lista b1-fr-lista" role="list" aria-label="Filtros">
            {itens.map((it) => (
              <button
                key={it.id}
                type="button"
                className={cn("mk-sel-op b1-fr-op b1-fr-nav", it.ativo && "is-on")}
                onClick={() => setFolha(it.id === "#ordem" ? "ordem" : { fr: it.id })}
              >
                <span className="b1-fr-op__txt">{it.rotulo}</span>
                <span className="b1-fr-nav__val">{it.valor}</span>
                <ChevronRight className="b1-fr-nav__seta" size={16} aria-hidden />
              </button>
            ))}
          </div>
          {temFiltro ? (
            <button type="button" className="b1-fr-menu__limpar" onClick={onClearFilters}>
              Limpar filtros
            </button>
          ) : null}
        </>
      );
    } else if (folha === "ordem") {
      titulo = "Ordenar";
      aside = "Escolha quem vem primeiro";
      acao = botaoOk(voltarAoMenu);
      corpo = (
        <div className="mk-sel-lista b1-lista b1-fr-lista" role="listbox" aria-multiselectable="true" aria-label="Ordenar">
          {ordens.map((o) => (
            <LinhaDaJanela
              key={`${o.key}:${o.dir}`}
              rotulo={o.label}
              unica
              on={o.key === sort.key && o.dir === (sort.direction === "desc" ? "desc" : "asc")}
              onClick={() => {
                onSortChange(o.key, o.dir);
                fecharFolhas();
              }}
            />
          ))}
        </div>
      );
    } else if (folha === "mais") {
      titulo = "Filtros rápidos";
      aside = "Marque o que aparece na faixa";
      acao = botaoOk(voltarAoMenu);
      corpo = (
        <>
          {camposDoMais.length > 8 ? <CampoDaJanela valor={buscaCampo} onChange={setBuscaCampo} onLimpar={() => setBuscaCampo("")} /> : null}
          <div className="mk-sel-lista b1-lista b1-fr-lista" role="listbox" aria-multiselectable="true" aria-label="Filtros rápidos">
            {camposDoMais
              .filter((c) => !termoCampo || rotuloDoFiltro(c).toLowerCase().includes(termoCampo))
              .map((c) => (
                <LinhaDaJanela key={c.id} rotulo={rotuloDoFiltro(c)} on={naFaixa.includes(c.id)} onClick={() => alternarNaFaixa(c.id)} />
              ))}
          </div>
        </>
      );
    } else {
      const id = folha.fr;
      titulo = infoDoFiltro(id).rotulo || id;
      aside = contaDaFolha;
      acao = botaoOk(() => controleDaFolha.current?.aplicar());
      corpo = janelaDoFiltro(id, {
        semRodape: true,
        onCancelar: voltarAoMenu,
        onAplicar: (novo) => {
          onFilterChange(id, novo);
          fecharFolhas();
        },
      });
    }
    folhaCelular = (
      <MobileSheet open onClose={aoFechar} label={titulo} title={titulo} aside={aside} headerAction={acao} className="mk-base1-sheet" role="dialog">
        <div className="b1-lista-pop b1-fr-sheet">{corpo}</div>
      </MobileSheet>
    );
  }

  return (
    <>
    {folhaCelular}
    {createPortal(
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
              <JanelaDaFaixa
                open={ordemAberta}
                onOpenChange={(o) => setAberto(o ? "#ordem" : null)}
                rotulo="Ordenar"
                trigger={
                  <button type="button" className="b1-fr-chip__btn" aria-haspopup="dialog" aria-expanded={ordemAberta} aria-label="Ordenar" title="Ordenar">
                    <ArrowUpDown className="b1-fr-chip__ic" size={14} aria-hidden />
                    <span className="b1-fr-chip__val">{ordemAtual}</span>
                    <ChevronDown className="b1-fr-chip__seta" size={14} aria-hidden />
                  </button>
                }
              >
                <div className="mk-sel-lista b1-lista b1-fr-lista" role="listbox" aria-multiselectable="true" aria-label="Ordenar">
                  {ordens.map((o) => (
                    <LinhaDaJanela
                      key={`${o.key}:${o.dir}`}
                      rotulo={o.label}
                      unica
                      on={o.key === sort.key && o.dir === (sort.direction === "desc" ? "desc" : "asc")}
                      onClick={() => {
                        onSortChange(o.key, o.dir);
                        setAberto(null);
                      }}
                    />
                  ))}
                </div>
              </JanelaDaFaixa>
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
        <JanelaDaFaixa
          open={maisAberto}
          onOpenChange={(o) => {
            setAberto(o ? "#mais" : null);
            setBuscaCampo("");
          }}
          rotulo="Filtros rápidos"
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
          {camposDoMais.length > 8 ? (
            <CampoDaJanela valor={buscaCampo} onChange={setBuscaCampo} onLimpar={() => setBuscaCampo("")} />
          ) : null}
          <div className="mk-sel-lista b1-lista b1-fr-lista" role="listbox" aria-multiselectable="true" aria-label="Filtros rápidos">
            {camposDoMais
              .filter((c) => !termoCampo || rotuloDoFiltro(c).toLowerCase().includes(termoCampo))
              .map((c) => (
                <LinhaDaJanela key={c.id} rotulo={rotuloDoFiltro(c)} on={naFaixa.includes(c.id)} onClick={() => alternarNaFaixa(c.id)} />
              ))}
          </div>
        </JanelaDaFaixa>
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
    )}
    </>
  );
}
