import React from "react";
import { createPortal } from "react-dom";
import { Check, FilterX, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { operadoresParaTipo } from "./cadastroColunaFiltroLogic";
import { MgDatePicker, brToISO, isoToBR } from "./MgDatePicker";

function Chk({ on, parte = false }) {
  return (
    <span className={cn("chk", on && "on", !on && parte && "parte")}>
      {(on || parte) && <Check strokeWidth={3} />}
    </span>
  );
}

function camadaAninhadaAberta(alvo) {
  if (!(alvo instanceof Element)) return false;
  return Boolean(
    alvo.closest(
      "[data-radix-popper-content-wrapper], [data-radix-select-content], .cmd-panel, .mg-b1-glass-pop, .b1-dp-filtro",
    ),
  );
}

function deveFecharPorFora({ alvo, ponto, shell, ancoraTh }) {
  if (!(alvo instanceof Node)) return false;
  if (shell?.contains(alvo)) return false;
  if (ancoraTh?.contains(alvo)) return false;
  if (camadaAninhadaAberta(alvo)) return false;
  if (ponto && ancoraTh) {
    const r = ancoraTh.getBoundingClientRect();
    if (ponto.clientX >= r.left && ponto.clientX <= r.right && ponto.clientY >= r.top && ponto.clientY <= r.bottom) {
      return false;
    }
  }
  return true;
}

/**
 * Popover de filtro de cabeçalho (`fpop` — paridade frota/equipamentos / portal compras).
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
  const painel = React.useRef(null);
  const fechar = React.useRef(onFechar);
  fechar.current = onFechar;

  const reposicionar = React.useCallback(() => {
    const el = document.querySelector(ancora)?.closest("th");
    if (!el) return;
    const b = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(b.left, window.innerWidth - 262));
    const abaixo = window.innerHeight - b.bottom - 12;
    const acima = b.top - 12;
    setPos(
      abaixo >= 360 || abaixo >= acima
        ? { top: b.bottom + 4, left, maxHeight: abaixo, visibility: "visible" }
        : {
            bottom: window.innerHeight - b.top + 4,
            left,
            maxHeight: acima,
            visibility: "visible",
          },
    );
  }, [ancora]);

  React.useLayoutEffect(() => {
    reposicionar();
  }, [reposicionar]);

  React.useEffect(() => {
    const teclado = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (camadaAninhadaAberta(document.activeElement)) return;
        e.preventDefault();
        fechar.current();
      }
    };
    const fora = (e) => {
      const th = document.querySelector(ancora)?.closest("th") ?? null;
      if (!deveFecharPorFora({ alvo: e.target, ponto: e, shell: painel.current, ancoraTh: th })) return;
      fechar.current();
    };
    const scroll = () => reposicionar();
    document.addEventListener("keydown", teclado);
    document.addEventListener("mousedown", fora);
    window.addEventListener("resize", scroll);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("keydown", teclado);
      document.removeEventListener("mousedown", fora);
      window.removeEventListener("resize", scroll);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [ancora, reposicionar]);

  const ops = operadoresParaTipo(tipo);
  const vistos = contagem.filter(([v]) => v.toLowerCase().includes(busca.toLowerCase()));
  const todos = vistos.length > 0 && vistos.every(([v]) => sel.has(v));
  const algum = vistos.some(([v]) => sel.has(v));

  const aplicar = () => {
    const valoresFiltrados = sel.size === contagem.length ? null : sel;
    onAplicar(!op && !valoresFiltrados ? null : { op, v1, v2, valores: valoresFiltrados });
  };

  const aoEnviar = (e) => {
    e.preventDefault();
    aplicar();
  };

  const ph = tipo === "data" ? "dd/mm/aaaa" : tipo === "num" ? "Número" : "Valor";

  return createPortal(
    <div className="b1ref" ref={painel}>
      <form className="pop fpop" role="menu" aria-label={`Filtrar coluna ${rotulo}`} style={pos} onSubmit={aoEnviar}>
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
            {tipo === "data" ? (
              <div className="b1-dp-filtro">
                <MgDatePicker
                  value={brToISO(v1)}
                  onChange={(iso) => setV1(iso ? isoToBR(iso) : "")}
                  placeholder={ph}
                  variant="central"
                />
              </div>
            ) : (
              <input
                className="fin"
                value={v1}
                onChange={(e) => setV1(e.target.value)}
                placeholder={ph}
                aria-label="Valor da condição"
              />
            )}
            {op === "entre" ? (
              <>
                <span className="fe">e</span>
                {tipo === "data" ? (
                  <div className="b1-dp-filtro">
                    <MgDatePicker
                      value={brToISO(v2)}
                      onChange={(iso) => setV2(iso ? isoToBR(iso) : "")}
                      placeholder={ph}
                      variant="central"
                    />
                  </div>
                ) : (
                  <input
                    className="fin"
                    value={v2}
                    onChange={(e) => setV2(e.target.value)}
                    placeholder={ph}
                    aria-label="Segundo valor da condição"
                  />
                )}
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
          <button type="button" className="tb-btn tb-btn-icon tb-btn-sm shrink-0" title="Cancelar" aria-label="Cancelar" onClick={onFechar}>
            <X className="h-4 w-4" />
          </button>
          <button type="submit" className="tb-btn tb-btn-icon shrink-0" title="Aplicar" aria-label="Aplicar">
            <Check className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
