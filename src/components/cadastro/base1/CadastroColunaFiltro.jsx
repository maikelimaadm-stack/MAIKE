import React from "react";
import { createPortal } from "react-dom";
import { Check, FilterX, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { casaNoFiltroColuna, operadoresParaTipo } from "./cadastroColunaFiltroLogic";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import { MgDatePicker, brToISO, isoToBR } from "./MgDatePicker";
import SeletorDeOperador from "./SeletorDeOperador";
import { usePortalComprasSkin } from "./portalComprasSkinContext";
import {
  deveFecharFiltroPorFora,
  haCamadaAninhadaDoFiltroAberta,
} from "./cadastroColunaFiltroCamada";

function Chk({ on, parte = false }) {
  return (
    <span className={cn("chk", on && "on", !on && parte && "parte")}>
      {(on || parte) && <Check strokeWidth={3} />}
    </span>
  );
}

/**
 * Popover de filtro de cabeçalho (`fpop` — paridade frota/equipamentos / portal compras).
 * No celular abre na folha de baixo (`MobileSheet`). A lista de valores já
 * mostra só o que atende à condição, e o ✓ fica bloqueado quando o filtro
 * deixaria a coluna sem nenhum registro.
 */
export default function CadastroColunaFiltro({
  rotulo,
  tipo,
  ancora,
  valores,
  atual,
  ancoraReserva = null,
  onAplicar,
  onFechar,
}) {
  const portalSkin = usePortalComprasSkin();
  const celular = useCelular();
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
    // Sem cabeçalho visível (cards, coluna fora da tela): usa o botão Filtros.
    const el = document.querySelector(ancora)?.closest("th");
    const b = el?.getBoundingClientRect() ?? ancoraReserva;
    if (!b) return;
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
  }, [ancora, ancoraReserva]);

  React.useLayoutEffect(() => {
    if (!celular) reposicionar();
  }, [reposicionar, celular]);

  React.useEffect(() => {
    const teclado = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (haCamadaAninhadaDoFiltroAberta()) return;
      e.preventDefault();
      fechar.current();
    };
    const fora = (e) => {
      if (celular) return;
      const th = document.querySelector(ancora)?.closest("th") ?? null;
      const shell = painel.current?.querySelector?.(".fpop") ?? painel.current;
      if (
        !deveFecharFiltroPorFora({
          alvo: e.target,
          ponto: e,
          shell,
          ancora: th,
        })
      ) {
        return;
      }
      fechar.current();
    };
    const scroll = () => reposicionar();
    document.addEventListener("keydown", teclado);
    document.addEventListener("mousedown", fora);
    document.addEventListener("pointerdown", fora);
    window.addEventListener("resize", scroll);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("keydown", teclado);
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("pointerdown", fora);
      window.removeEventListener("resize", scroll);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [ancora, reposicionar, celular]);

  const ops = operadoresParaTipo(tipo);
  const condicao = { op, v1, v2, valores: null };
  const atende = (v) => casaNoFiltroColuna(condicao, tipo, v);
  const vistos = contagem.filter(([v]) => v.toLowerCase().includes(busca.toLowerCase()) && atende(v));
  const todos = vistos.length > 0 && vistos.every(([v]) => sel.has(v));
  const algum = vistos.some(([v]) => sel.has(v));

  const semResultado = !contagem.some(([v]) => sel.has(v) && atende(v));

  const aplicar = () => {
    if (semResultado) return;
    const valoresFiltrados = sel.size === contagem.length ? null : sel;
    onAplicar(!op && !valoresFiltrados ? null : { op, v1, v2, valores: valoresFiltrados });
  };

  const aoEnviar = (e) => {
    e.preventDefault();
    aplicar();
  };

  const ph = tipo === "data" ? "dd/mm/aaaa" : tipo === "num" ? "Número" : "Valor";

  const shellClass = cn("b1ref cadastro-b1", portalSkin && "b1-portal-compras");

  const formulario = (
      <form
        className={cn("pop fpop", portalSkin && "b1-portal-compras", celular && "fpop--sheet")}
        role="menu"
        aria-label={`Filtrar coluna ${rotulo}`}
        style={celular ? undefined : pos}
        onSubmit={aoEnviar}
      >
        <button
          type="button"
          className={cn("fmi fmi-limpar", atual && "is-on")}
          disabled={!atual}
          onClick={() => onAplicar(null)}
        >
          <FilterX size={14} />
          <span className="fval-l">Limpar filtro de “{rotulo}”</span>
        </button>
        <span className="opt-sep" aria-hidden="true" />
        <div className="fcond">
          <SeletorDeOperador
            valor={op || "sem"}
            opcoes={ops.map(([value, label]) => ({ value: value || "sem", label }))}
            onChange={(v) => setOp(v === "sem" ? "" : v)}
          />
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
        <div className="mk-pill fpop-busca">
          {busca ? (
            <button type="button" className="mk-pill__clear" aria-label="Limpar" onClick={() => setBusca("")}>
              <X size={13} />
            </button>
          ) : (
            <span className="mk-pill__icon" aria-hidden>
              <Search size={13} />
            </span>
          )}
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar valor…"
            aria-label="Procurar valor"
          />
        </div>
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
          {vistos.length === 0 ? (
            <span className="dvaz">{op ? "Nenhum valor atende à condição." : "Nenhum valor com esse texto."}</span>
          ) : null}
        </div>
        <div className="fpop-f">
          <span className="fpop-zero" role={semResultado ? "status" : undefined}>
            {semResultado ? "Nenhum registro atende a este filtro." : ""}
          </span>
          <button type="button" className="tb-btn tb-btn-icon tb-btn-sm shrink-0" title="Cancelar" aria-label="Cancelar" onClick={onFechar}>
            <X className="h-4 w-4" />
          </button>
          <button
            type="submit"
            className="tb-btn tb-btn-icon tb-btn-green tb-btn-sm shrink-0"
            title="Aplicar"
            aria-label="Aplicar"
            disabled={semResultado}
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      </form>
  );

  if (celular) {
    return (
      <MobileSheet open onClose={() => fechar.current()} label={`Filtrar coluna ${rotulo}`} title={rotulo}>
        <div className={shellClass} ref={painel}>
          {formulario}
        </div>
      </MobileSheet>
    );
  }

  return createPortal(
    <div className={shellClass} ref={painel}>
      {formulario}
    </div>,
    document.body,
  );
}
