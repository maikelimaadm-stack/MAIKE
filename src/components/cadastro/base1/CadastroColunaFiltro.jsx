import React from "react";
import { createPortal } from "react-dom";
import { Check, FilterX, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { operadoresParaTipo } from "./cadastroColunaFiltroLogic";

function Chk({ on, parte = false }) {
  return (
    <span className={cn("chk", on && "on", !on && parte && "parte")}>
      {(on || parte) && <Check strokeWidth={3} />}
    </span>
  );
}

/**
 * Popover de filtro de cabeçalho (`fpop` — paridade frota/equipamentos).
 *
 * @param {object} props
 * @param {string} props.rotulo
 * @param {'texto'|'num'|'data'} props.tipo
 * @param {string} props.ancora seletor CSS do botão do cabeçalho
 * @param {string[]} props.valores valores distintos da coluna (linhas carregadas)
 * @param {import('./cadastroColunaFiltroLogic').CadastroColunaFiltroAtivo | null} props.atual
 * @param {(f: import('./cadastroColunaFiltroLogic').CadastroColunaFiltroAtivo | null) => void} props.onAplicar
 * @param {() => void} props.onFechar
 */
export default function CadastroColunaFiltro({
  rotulo,
  tipo,
  ancora,
  valores,
  atual,
  onAplicar,
  onFechar,
}) {
  const contagem = React.useMemo(() => {
    const m = new Map();
    for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], "pt-BR", { numeric: true }),
    );
  }, [valores]);

  const [sel, setSel] = React.useState(() => new Set(atual?.valores ?? contagem.map(([v]) => v)));
  const [op, setOp] = React.useState(atual?.op ?? "");
  const [v1, setV1] = React.useState(atual?.v1 ?? "");
  const [v2, setV2] = React.useState(atual?.v2 ?? "");
  const [busca, setBusca] = React.useState("");
  const [pos, setPos] = React.useState(/** @type {React.CSSProperties} */ ({ visibility: "hidden" }));

  const fechar = React.useRef(onFechar);
  fechar.current = onFechar;

  React.useEffect(() => {
    const teclado = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        fechar.current();
      }
    };
    document.addEventListener("keydown", teclado);
    return () => document.removeEventListener("keydown", teclado);
  }, []);

  React.useLayoutEffect(() => {
    const el = document.querySelector(ancora)?.closest("th");
    if (!el) return;
    const b = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(b.left, window.innerWidth - 262));
    const abaixo = window.innerHeight - b.bottom - 12;
    const acima = b.top - 12;
    setPos(
      abaixo >= 360 || abaixo >= acima
        ? { top: b.bottom + 4, left, maxHeight: abaixo }
        : { bottom: window.innerHeight - b.top + 4, left, maxHeight: acima },
    );
  }, [ancora]);

  const ops = operadoresParaTipo(tipo);
  const vistos = contagem.filter(([v]) => v.toLowerCase().includes(busca.toLowerCase()));
  const todos = vistos.length > 0 && vistos.every(([v]) => sel.has(v));
  const algum = vistos.some(([v]) => sel.has(v));

  const aplicar = () => {
    const valoresFiltrados = sel.size === contagem.length ? null : sel;
    onAplicar(!op && !valoresFiltrados ? null : { op, v1, v2, valores: valoresFiltrados });
  };

  const ph = tipo === "data" ? "dd/mm/aaaa" : tipo === "num" ? "Número" : "Valor";

  return createPortal(
    <div className="b1ref">
      <button
        type="button"
        aria-label="Fechar o filtro"
        tabIndex={-1}
        className="fixed inset-0 z-[59] cursor-default"
        onClick={onFechar}
      />
      <div className="pop fpop" role="menu" aria-label={`Filtrar coluna ${rotulo}`} style={pos}>
        <button
          type="button"
          className="fmi"
          disabled={!atual}
          onClick={() => onAplicar(null)}
        >
          <FilterX size={14} />
          <span className="fval-l">Limpar filtro de “{rotulo}”</span>
        </button>
        <span className="opt-sep" aria-hidden="true" />
        <div className="fcond">
          <select
            className="fin w-full"
            value={op || "sem"}
            onChange={(e) => setOp(e.target.value === "sem" ? "" : e.target.value)}
            aria-label="Condição do filtro"
          >
            {ops.map(([value, label]) => (
              <option key={value || "sem"} value={value || "sem"}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {op ? (
          <div className="fcond">
            <input
              className="fin"
              value={v1}
              onChange={(e) => setV1(e.target.value)}
              placeholder={ph}
              aria-label="Valor da condição"
            />
            {op === "entre" ? (
              <>
                <span className="fe">e</span>
                <input
                  className="fin"
                  value={v2}
                  onChange={(e) => setV2(e.target.value)}
                  placeholder={ph}
                  aria-label="Segundo valor da condição"
                />
              </>
            ) : null}
          </div>
        ) : null}
        <span className="opt-sep" aria-hidden="true" />
        <label className="cfgb" style={{ margin: "0 8px 6px", height: 28 }}>
          <Search size={14} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar valor…"
            aria-label="Procurar valor"
          />
        </label>
        <button
          type="button"
          className="pr fvr ftodos"
          role="checkbox"
          aria-checked={todos}
          onClick={() =>
            setSel((p) => {
              const n = new Set(p);
              for (const [v] of vistos) {
                if (todos) n.delete(v);
                else n.add(v);
              }
              return n;
            })
          }
        >
          <span className="fck">
            <Chk on={todos} parte={algum} />
          </span>
          <span className="pn">(Selecionar Tudo)</span>
          <span className="r">{sel.size} de {contagem.length}</span>
        </button>
        <div className="fpop-l">
          {vistos.map(([v, n]) => (
            <button
              type="button"
              key={v}
              className={cn("pr fvr", sel.has(v) && "on")}
              role="checkbox"
              aria-checked={sel.has(v)}
              onClick={() =>
                setSel((p) => {
                  const s = new Set(p);
                  if (s.has(v)) s.delete(v);
                  else s.add(v);
                  return s;
                })
              }
            >
              <span className="fck">
                <Chk on={sel.has(v)} />
              </span>
              <span className="pn">{v || "(Vazias)"}</span>
              <span className="r">{n}</span>
            </button>
          ))}
          {vistos.length === 0 ? <span className="dvaz">Nenhum valor com esse texto.</span> : null}
        </div>
        <div className="fpop-f">
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="tb-btn tb-btn-out xs" onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className="tb-btn novo xs" onClick={aplicar}>
            Aplicar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
