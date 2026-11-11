import React from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Search, X } from "lucide-react";
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
 * coluna abre o filtro dela (o mesmo do cabeçalho). No celular, a mesma janela do tablet (D-PROD-168).
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
  const [busca, setBusca] = React.useState("");
  const painel = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const fechar = React.useRef(onFechar);
  fechar.current = onFechar;
  const termo = busca.trim().toLowerCase();
  const vistas = colunas.filter((c) => c.label.toLowerCase().includes(termo));

  React.useEffect(() => {
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
  }, []);

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

  // Celular igual ao tablet (pedido do proprietário, D-PROD-168): a mesma janela abaixo do botão, não a folha de baixo.
  // Como no design (D-PROD-164): alinhado à esquerda do botão quando cabe; senão, à direita dele; senão, centrado.
  const largura = 260;
  const margem = 8;
  const teto = window.innerWidth - largura - margem;
  const r = ancora;
  const left = !r
    ? 12
    : r.left >= 0 && r.left <= teto + 0.5
      ? r.left
      : r.right <= window.innerWidth + 0.5 && r.right - largura >= margem - 0.5
        ? r.right - largura
        : Math.max(margem, Math.min((r.left + r.right) / 2 - largura / 2, teto));
  const top = (ancora?.bottom ?? 120) + 6;
  return createPortal(
    <div
      ref={painel}
      className="cadastro-b1 fpc fpc--pop"
      role="menu"
      aria-label="Filtrar por campo"
      style={{ left, top, maxHeight: Math.max(200, window.innerHeight - top - 12) }}
    >
      {/* Sem título: a pesquisa encosta no topo, igual às outras janelas (D-PROD-164). */}
      {conteudo}
    </div>,
    document.body,
  );
}
