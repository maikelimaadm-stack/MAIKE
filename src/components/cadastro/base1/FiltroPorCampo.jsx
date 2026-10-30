import React from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Filter, FilterX, Search, X } from "lucide-react";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import { ROTULO_OPERADOR } from "./cadastroColunaFiltroLogic";

/** Resumo curto do filtro ativo: "> 100", "entre 1 e 3", "2 valores". */
function resumoDoFiltro(f) {
  if (!f) return "";
  if (f.op) return `${ROTULO_OPERADOR[f.op] ?? f.op} ${f.v1}${f.op === "entre" ? ` e ${f.v2}` : ""}`.trim();
  if (f.valores) {
    if (f.valores.size === 1) return [...f.valores][0] || "(Vazias)";
    return `${f.valores.size} valores`;
  }
  return "";
}

/**
 * Painel do botão Filtros: as colunas visíveis, na ordem da tabela. Tocar numa
 * coluna abre o filtro dela (o mesmo do cabeçalho). Celular: folha de baixo.
 *
 * @param {{
 *   colunas: Array<{ id: string, label: string }>,
 *   filtros: Record<string, any>,
 *   ancora: DOMRect | null,
 *   onEscolher: (colunaId: string) => void,
 *   onFechar: () => void,
 * }} props
 */
export default function FiltroPorCampo({ colunas, filtros, ancora, onEscolher, onFechar }) {
  const celular = useCelular();
  const [busca, setBusca] = React.useState("");
  const painel = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const fechar = React.useRef(onFechar);
  fechar.current = onFechar;
  const termo = busca.trim().toLowerCase();
  const vistas = colunas.filter((c) => c.label.toLowerCase().includes(termo));

  React.useEffect(() => {
    if (celular) return undefined;
    const fora = (event) => {
      if (painel.current?.contains(/** @type {Node} */ (event.target))) return;
      if (/** @type {Element} */ (event.target)?.closest?.('[data-testid="b1-field-filter"]')) return;
      fechar.current();
    };
    const teclado = (event) => {
      if (event.key === "Escape") fechar.current();
    };
    document.addEventListener("pointerdown", fora, true);
    document.addEventListener("keydown", teclado);
    return () => {
      document.removeEventListener("pointerdown", fora, true);
      document.removeEventListener("keydown", teclado);
    };
  }, [celular]);

  const conteudo = (
    <>
      <div className="mk-pill fpc__busca">
        {busca ? (
          <button type="button" className="mk-pill__clear" aria-label="Limpar" onClick={() => setBusca("")}>
            <X size={13} />
          </button>
        ) : (
          <span className="mk-pill__icon" aria-hidden>
            <Search size={13} />
          </span>
        )}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar campo…" aria-label="Procurar campo" />
      </div>
      <div className="fpc__lista">
        {vistas.map((c) => {
          const f = filtros[c.id];
          const resumo = resumoDoFiltro(f);
          return (
            <button key={c.id} type="button" role="menuitem" className="fpc__item" onClick={() => onEscolher(c.id)}>
              <span className={f ? "fpc__ic is-on" : "fpc__ic"} aria-hidden>
                {f ? <FilterX size={14} /> : <Filter size={14} />}
              </span>
              <span className="fpc__nome">{c.label}</span>
              {resumo ? <span className="fpc__resumo">{resumo}</span> : null}
              <span className="fpc__chev" aria-hidden>
                <ChevronRight size={14} />
              </span>
            </button>
          );
        })}
        {!vistas.length ? <span className="fpc__vazio">Nenhum campo com esse nome.</span> : null}
      </div>
    </>
  );

  if (celular) {
    return (
      <MobileSheet open onClose={() => fechar.current()} label="Filtrar por campo" title="Filtrar por campo" role="menu">
        <div className="fpc fpc--sheet">{conteudo}</div>
      </MobileSheet>
    );
  }

  const left = Math.max(8, Math.min(ancora?.left ?? 12, window.innerWidth - 268));
  const top = (ancora?.bottom ?? 120) + 6;
  return createPortal(
    <div
      ref={painel}
      className="cadastro-b1 fpc fpc--pop"
      role="menu"
      aria-label="Filtrar por campo"
      style={{ left, top, maxHeight: Math.max(200, window.innerHeight - top - 12) }}
    >
      <div className="fpc__titulo">Filtrar por campo</div>
      {conteudo}
    </div>,
    document.body,
  );
}
