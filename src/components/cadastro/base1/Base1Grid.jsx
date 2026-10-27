import React from "react";
import {
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Filter,
  FilterX,
  Scaling,
  PanelLeft,
  EyeOff,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { MIN_COL_WIDTH } from "@/lib/cadastroBase1ColumnPrefs";
import { fonteDaCelula, medirLarguraColuna } from "@/lib/larguraColuna";
import { B1Popover, MenuList, MgCheck } from "./Base1Ui";
import { selectClickOf, useBlockNativeTextSelection } from "./selectClick";
import { usePortalComprasSkin } from "./portalComprasSkinContext";

const ROW_ESTIMATE_PX = 32;
/** Abaixo disso o custo do virtualizer não compensa. */
const VIRTUALIZE_FROM = 80;

export const SELECT_COLUMN_WIDTH = 36;

/**
 * Grade Modelo Base1 (referência CONTROLE-DE-ESTOQUE / frota equipamentos).
 *
 * @param {object} props
 * @param {Array<{ key: string; label: string; sortable?: boolean; align?: string; width?: number; pinned?: 'left'; render?: (r: object) => import('react').ReactNode; text?: (r: object) => string }>} props.columns
 * @param {object[]} props.rows
 * @param {boolean} [props.loading]
 * @param {{ key: string; dir: 'asc'|'desc' }} [props.sort]
 * @param {(key: string) => void} [props.onSort]
 * @param {Set<string>} props.selected
 * @param {(id: string, mod: import('./selectClick').SelectClick) => void} props.onSelectClick
 * @param {(id: string) => void} props.onToggle
 * @param {(on: boolean) => void} props.onToggleAll
 * @param {(r: object) => void} [props.onOpen]
 * @param {number} [props.frozen]
 * @param {(n: number) => void} [props.onFreeze]
 * @param {(key: string) => void} [props.onHide]
 * @param {(key: string, width: number) => void} [props.onResize]
 * @param {(key: string) => void} [props.onAutoFit]
 * @param {(key: string) => void} [props.onFilter]
 * @param {(key: string) => void} [props.onClearFilter]
 * @param {Set<string>} [props.filteredKeys]
 * @param {Set<string>} [props.autoFitKeys]
 * @param {(r: object) => string} [props.rowKey]
 * @param {string} [props.emptyText]
 * @param {string|null} [props.scrollToId]
 * @param {import('react').ReactNode} [props.footer]
 * @param {boolean} [props.referenceHeaders]
 * @param {boolean} [props.referenceExtendedColumnMenu]
 * @param {boolean} [props.selecaoSticky]
 * @param {boolean} [props.colunaSelecao]
 */
export default function Base1Grid({
  columns,
  rows,
  loading,
  sort,
  onSort,
  selected,
  onSelectClick,
  onToggle,
  onToggleAll,
  onOpen,
  frozen = 0,
  onFreeze,
  onHide,
  onResize,
  onAutoFit,
  onFilter,
  onClearFilter,
  filteredKeys,
  autoFitKeys,
  rowKey,
  emptyText = "Nenhum registro encontrado",
  scrollToId = null,
  footer,
  referenceHeaders = false,
  referenceExtendedColumnMenu = false,
  selecaoSticky = true,
  colunaSelecao = true,
}) {
  const portalSkin = usePortalComprasSkin();
  const key = rowKey ?? ((r) => String(r.id));
  const allOn = rows.length > 0 && rows.every((r) => selected.has(key(r)));
  const someOn = !allOn && rows.some((r) => selected.has(key(r)));
  const ths = React.useRef({});
  const trs = React.useRef({});
  const [lefts, setLefts] = React.useState({});
  const [menuFor, setMenuFor] = React.useState(null);
  let pinnedCount = 0;
  while (pinnedCount < columns.length && columns[pinnedCount]?.pinned === "left") pinnedCount++;
  const frozenCount = Math.max(0, Math.min(Math.max(frozen, pinnedCount), columns.length));
  const selectCongelado = colunaSelecao && (selecaoSticky || frozenCount > 0);
  const leftBase = selectCongelado ? SELECT_COLUMN_WIDTH : 0;
  const colSpanVazio = columns.length + (colunaSelecao ? 1 : 0);

  const measure = React.useCallback(() => {
    const out = {};
    let acc = leftBase;
    for (const c of columns.slice(0, frozenCount)) {
      out[c.key] = acc;
      acc += ths.current[c.key]?.getBoundingClientRect().width ?? c.width ?? 160;
    }
    setLefts((prev) => {
      const keys = Object.keys(out);
      return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === out[k]) ? prev : out;
    });
  }, [columns, frozenCount, leftBase]);

  React.useLayoutEffect(() => {
    measure();
  }, [measure, rows.length]);

  React.useEffect(() => {
    if (!frozenCount || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    for (const c of columns.slice(0, frozenCount)) {
      const el = ths.current[c.key];
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [columns, frozenCount, measure]);

  React.useEffect(() => {
    if (scrollToId) trs.current[scrollToId]?.scrollIntoView({ block: "center" });
  }, [scrollToId, rows.length]);

  const cellText = (c, r) => (c.text ? c.text(r) : String(r[c.key] ?? ""));

  const iconesNoCabecalho = (c, i, opts) => {
    const isAnchor = i === frozenCount - 1 && frozenCount > 0;
    const fitOn = Boolean(opts?.forcarAuto || autoFitKeys?.has(c.key));
    const filterOn = Boolean(filteredKeys?.has(c.key));
    const ordenado = sort?.key === c.key;
    return (filterOn ? 1 : 0) + (fitOn ? 1 : 0) + (isAnchor ? 1 : 0) + (ordenado ? 1 : 0);
  };

  const larguraPorConteudo = (c, i, opts) => {
    const th = ths.current[c.key];
    const celulas = rows.map((r) => cellText(c, r)).filter((t) => t && t !== "–" && t !== "—");
    return medirLarguraColuna({
      rotulo: c.label,
      textosCelulas: celulas,
      fontCabecalho: fonteDaCelula(th),
      iconesEstado: iconesNoCabecalho(c, i, opts),
    });
  };

  const aplicarAutoAjuste = (c, i, jaLigado) => {
    if (jaLigado) {
      onAutoFit?.(c.key);
      return;
    }
    onResize?.(c.key, larguraPorConteudo(c, i, { forcarAuto: true }));
    onAutoFit?.(c.key);
  };

  const ajustarLarguraUmaVez = (c, i) => {
    onResize?.(c.key, larguraPorConteudo(c, i));
  };

  const filtrosSig = React.useMemo(
    () => (filteredKeys && filteredKeys.size ? [...filteredKeys].sort().join("\0") : ""),
    [filteredKeys],
  );

  React.useEffect(() => {
    if (!autoFitKeys?.size || !onResize) return;
    columns.forEach((c, i) => {
      if (!autoFitKeys.has(c.key)) return;
      const w = larguraPorConteudo(c, i);
      if (c.width !== w) onResize(c.key, w);
    });
  }, [autoFitKeys, rows, columns, frozenCount, sort?.key, sort?.dir, filtrosSig]);

  const syncColunaInline = (table, colIndex, wPx) => {
    if (colIndex < 0) return;
    const cellIndex = colunaSelecao ? colIndex + 1 : colIndex;
    const apply = (el) => {
      if (!(el instanceof HTMLElement)) return;
      if (wPx == null) {
        el.style.width = el.style.minWidth = el.style.maxWidth = "";
      } else {
        el.style.width = el.style.minWidth = el.style.maxWidth = `${wPx}px`;
      }
    };
    for (const row of table.querySelectorAll("tbody tr, tfoot tr")) {
      apply(row.children[cellIndex]);
    }
  };

  const startResize = (e, c) => {
    if (e.detail > 1) return;
    e.preventDefault();
    e.stopPropagation();
    const th = ths.current[c.key];
    if (!th) return;
    const x0 = e.clientX;
    const w0 = th.getBoundingClientRect().width;
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const colIndex = columns.findIndex((col) => col.key === c.key);
    const table = th.closest("table");
    const move = (ev) => {
      const w = Math.max(MIN_COL_WIDTH, w0 + ev.clientX - x0);
      th.style.width = th.style.minWidth = th.style.maxWidth = `${w}px`;
      if (table) syncColunaInline(table, colIndex, w);
      measure();
    };
    const clearInline = () => {
      th.style.width = th.style.minWidth = th.style.maxWidth = "";
      if (table) syncColunaInline(table, colIndex, null);
    };
    const up = (ev) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
      const w = Math.round(Math.max(MIN_COL_WIDTH, w0 + ev.clientX - x0));
      clearInline();
      onResize?.(c.key, w);
      if (autoFitKeys?.has(c.key)) onAutoFit?.(c.key);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const stickyBg = (on, ri) =>
    on ? "var(--mg-selection-bg)" : ri % 2 === 1 ? "var(--mg-row-alt)" : "#fff";

  const abrirFiltroDireto = referenceHeaders && onFilter && !referenceExtendedColumnMenu;

  const scrollRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));
  useBlockNativeTextSelection(scrollRef);
  const virtualizar = !loading && rows.length >= VIRTUALIZE_FROM;
  const rowVirtualizer = useVirtualizer({
    count: virtualizar ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 16,
  });
  const virtualRows = virtualizar ? rowVirtualizer.getVirtualItems() : null;
  const padTop = virtualRows?.length ? virtualRows[0].start : 0;
  const padBottom = virtualRows?.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  const renderRow = (r, ri) => {
    const id = key(r);
    const on = selected.has(id);
    return (
      <tr
        key={id}
        ref={(el) => {
          trs.current[id] = el;
        }}
        data-testid="b1-row"
        aria-selected={on}
        className={cn(on && "selected", ri % 2 === 1 ? "odd" : "even")}
        onClick={(e) => onSelectClick(id, selectClickOf(e))}
        onDoubleClick={() => onOpen?.(r)}
      >
        {colunaSelecao ? (
          <td
            className={cn("td-select", selectCongelado && "sticky left-0 z-[2]")}
            style={selectCongelado ? { background: stickyBg(on, ri) } : undefined}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <MgCheck aria-label="Selecionar linha" checked={on} onChange={() => onToggle(id)} />
          </td>
        ) : null}
        {columns.map((c, i) => {
          const isFrozen = i < frozenCount;
          const t = cellText(c, r);
          return (
            <td
              key={c.key}
              title={t}
              style={{
                ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : {}),
                ...(isFrozen
                  ? { left: lefts[c.key] ?? leftBase, zIndex: 2, background: stickyBg(on, ri) }
                  : {}),
              }}
              className={cn(
                onOpen && "cursor-pointer",
                isFrozen && "is-frozen",
                i === frozenCount - 1 && frozenCount > 0 && "is-frozen-anchor",
                c.align === "right" && "!text-right tabular-nums",
                c.align === "center" && "text-center",
              )}
            >
              {c.render ? c.render(r) : t || <span className="text-[var(--mg-text-3)]">–</span>}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div ref={scrollRef} className="mg-grid-wrap">
      <table className="mg-grid">
        <thead>
          <tr>
            {colunaSelecao ? (
              <th className={cn("th-select", selectCongelado && "sticky left-0 z-[4]")}>
                <MgCheck
                  aria-label="Selecionar todos"
                  checked={allOn}
                  indeterminate={someOn}
                  onChange={(on) => onToggleAll(on)}
                />
              </th>
            ) : null}
            {columns.map((c, i) => {
              const isFrozen = i < frozenCount;
              const isAnchor = i === frozenCount - 1 && frozenCount > 0;
              const fitOn = Boolean(autoFitKeys?.has(c.key));
              const filterOn = Boolean(filteredKeys?.has(c.key));
              const temIcones = filterOn || fitOn || isAnchor;
              const rotuloFreeze = isAnchor
                ? "Descongelar colunas"
                : isFrozen
                  ? "Congelar até esta coluna"
                  : "Congelar coluna";
              const itens = [
                ...(onFilter
                  ? [{ key: "filter", label: "Abrir filtro avançado", icon: <Filter className="h-4 w-4" /> }]
                  : []),
                ...(onAutoFit
                  ? [
                      {
                        key: "fit",
                        label: fitOn ? "Desativar auto ajustar" : "Auto ajustar coluna",
                        icon: <Scaling className="h-4 w-4" />,
                      },
                    ]
                  : []),
                ...(onFreeze
                  ? [
                      {
                        key: "freeze",
                        label: rotuloFreeze,
                        icon: <PanelLeft className="h-4 w-4" />,
                      },
                    ]
                  : []),
                ...(onHide && columns.length > 1
                  ? [{ key: "hide", label: "Ocultar coluna", icon: <EyeOff className="h-4 w-4" /> }]
                  : []),
              ];
              return (
                <th
                  key={c.key}
                  ref={(el) => {
                    ths.current[c.key] = el;
                  }}
                  style={{
                    ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : { minWidth: 110 }),
                    ...(isFrozen ? { left: lefts[c.key] ?? leftBase, zIndex: 4 } : {}),
                  }}
                  className={cn(
                    "group relative",
                    isFrozen && "is-frozen",
                    isAnchor && "is-frozen-anchor",
                    c.align === "right" && "!text-right",
                  )}
                >
                  <div className="flex h-[30px] items-center gap-1">
                    <button
                      type="button"
                      className={cn(
                        "inline-flex min-w-0 flex-1 items-center gap-1 truncate text-left",
                        !onSort && "cursor-default",
                      )}
                      onClick={() => c.sortable !== false && onSort?.(c.key)}
                      title={c.label}
                    >
                      <span className="truncate">{c.label}</span>
                      {sort?.key === c.key ? (
                        sort.dir === "asc" ? (
                          <ArrowUp className="h-3 w-3 shrink-0 text-[#94a3b8]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3 shrink-0 text-[#94a3b8]" aria-hidden />
                        )
                      ) : null}
                    </button>
                    {temIcones ? (
                      <span className="th-estado">
                        {filterOn ? (
                          <button
                            type="button"
                            className="th-estado-btn is-filter"
                            title="Limpar filtro desta coluna"
                            aria-label={`Limpar filtro de ${c.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onClearFilter?.(c.key);
                            }}
                          >
                            <FilterX className="th-estado-icone" strokeWidth={2.25} />
                          </button>
                        ) : null}
                        {fitOn ? (
                          <button
                            type="button"
                            className="th-estado-btn"
                            title="Desativar auto ajustar"
                            aria-label={`Desativar auto ajustar de ${c.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAutoFit?.(c.key);
                            }}
                          >
                            <Scaling className="th-estado-icone" strokeWidth={2.25} />
                          </button>
                        ) : null}
                        {isAnchor ? (
                          <button
                            type="button"
                            className="th-estado-btn"
                            title="Descongelar colunas"
                            aria-label="Descongelar colunas"
                            onClick={(e) => {
                              e.stopPropagation();
                              onFreeze?.(0);
                            }}
                          >
                            <PanelLeft className="th-estado-icone" strokeWidth={2.25} />
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                    {abrirFiltroDireto ? (
                      <button
                        type="button"
                        data-b1-col-menu={c.key}
                        aria-label={`Abrir filtro da coluna ${c.label}`}
                        aria-haspopup="menu"
                        className={cn("th-menu", filterOn && "is-on")}
                        onClick={() => onFilter(c.key)}
                      >
                        <MoreVertical className="h-3 w-3" strokeWidth={2.25} />
                      </button>
                    ) : itens.length ? (
                      <B1Popover
                        className={cn("w-52 p-1", portalSkin && "b1-portal-compras")}
                        align="start"
                        open={menuFor === c.key}
                        onOpenChange={(o) => setMenuFor(o ? c.key : null)}
                        trigger={
                          <button
                            type="button"
                            data-b1-col-menu={c.key}
                            aria-label={`Abrir menu da coluna ${c.label}`}
                            className="th-menu"
                          >
                            <MoreVertical className="h-3 w-3" strokeWidth={2.25} />
                          </button>
                        }
                      >
                        <MenuList
                          onPick={(k) => {
                            setMenuFor(null);
                            if (k === "filter") onFilter?.(c.key);
                            if (k === "fit") aplicarAutoAjuste(c, i, fitOn);
                            if (k === "freeze") onFreeze?.(isAnchor ? 0 : i + 1);
                            if (k === "hide") onHide?.(c.key);
                          }}
                          items={itens}
                        />
                      </B1Popover>
                    ) : null}
                  </div>
                  <span
                    role="separator"
                    aria-label={`Redimensionar ${c.label}`}
                    title="Arraste para redimensionar · duplo clique para ajustar à largura"
                    onMouseDown={(e) => startResize(e, c)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      ajustarLarguraUmaVez(c, i);
                    }}
                    className="mg-grid-resize-handle"
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, colSpanVazio)} className="!h-24">
                <div className="mg-empty-state" role="status" aria-live="polite">Carregando…</div>
              </td>
            </tr>
          ) : null}
          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, colSpanVazio)} className="!h-24">
                <div className="mg-empty-state">{emptyText}</div>
              </td>
            </tr>
          ) : null}
          {virtualRows
            ? (
              <>
                {padTop > 0 ? (
                  <tr aria-hidden className="mg-grid-virt-spacer">
                    <td colSpan={Math.max(1, colSpanVazio)} style={{ height: padTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {virtualRows.map((vr) => renderRow(rows[vr.index], vr.index))}
                {padBottom > 0 ? (
                  <tr aria-hidden className="mg-grid-virt-spacer">
                    <td colSpan={Math.max(1, colSpanVazio)} style={{ height: padBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </>
            )
            : rows.map((r, ri) => renderRow(r, ri))}
        </tbody>
        {footer ? <tfoot className="mg-grid-foot">{footer}</tfoot> : null}
      </table>
    </div>
  );
}
