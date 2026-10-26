import React from "react";
import {
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Filter,
  Scaling,
  PanelLeft,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { B1Popover, MenuList, MgCheck } from "./Base1Ui";
import { selectClickOf } from "./selectClick";

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
 * @param {Set<string>} [props.filteredKeys]
 * @param {(r: object) => string} [props.rowKey]
 * @param {string} [props.emptyText]
 * @param {string|null} [props.scrollToId]
 * @param {import('react').ReactNode} [props.footer]
 * @param {boolean} [props.referenceHeaders] menu da coluna abre filtro Excel (frota/equipamentos)
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
  filteredKeys,
  rowKey,
  emptyText = "Nenhum registro encontrado",
  scrollToId,
  footer,
  referenceHeaders = false,
}) {
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

  const measure = React.useCallback(() => {
    const out = {};
    let acc = SELECT_COLUMN_WIDTH;
    for (const c of columns.slice(0, frozenCount)) {
      out[c.key] = acc;
      acc += ths.current[c.key]?.getBoundingClientRect().width ?? c.width ?? 160;
    }
    setLefts((prev) => {
      const keys = Object.keys(out);
      return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === out[k]) ? prev : out;
    });
  }, [columns, frozenCount]);

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

  const startResize = (e, c) => {
    e.preventDefault();
    e.stopPropagation();
    const th = ths.current[c.key];
    if (!th) return;
    const x0 = e.clientX;
    const w0 = th.getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(48, w0 + ev.clientX - x0);
      th.style.width = th.style.minWidth = th.style.maxWidth = `${w}px`;
      measure();
    };
    const up = (ev) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      onResize?.(c.key, Math.round(Math.max(48, w0 + ev.clientX - x0)));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const cellText = (c, r) => (c.text ? c.text(r) : String(r[c.key] ?? ""));

  const stickyBg = (on, ri) =>
    on ? "var(--mg-selection-bg)" : ri % 2 === 1 ? "var(--mg-row-alt)" : "#fff";

  return (
    <div className="mg-grid-wrap">
      <table className="mg-grid">
        <thead>
          <tr>
            <th className="th-select sticky left-0 z-[4]">
              <MgCheck
                aria-label="Selecionar todos"
                checked={allOn}
                indeterminate={someOn}
                onChange={(on) => onToggleAll(on)}
              />
            </th>
            {columns.map((c, i) => {
              const isFrozen = i < frozenCount;
              const isAnchor = i === frozenCount - 1;
              const itens = [
                ...(onFilter
                  ? [{ key: "filter", label: "Abrir filtro avançado", icon: <Filter className="h-4 w-4" /> }]
                  : []),
                ...(onAutoFit
                  ? [{ key: "fit", label: "Auto ajustar coluna", icon: <Scaling className="h-4 w-4" /> }]
                  : []),
                ...(onFreeze
                  ? [
                      {
                        key: "freeze",
                        label: isAnchor
                          ? "Descongelar colunas"
                          : isFrozen
                            ? "Congelar até esta coluna"
                            : "Congelar coluna",
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
                    ...(isFrozen ? { left: lefts[c.key] ?? 0, zIndex: 4 } : {}),
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
                          <ArrowUp className="h-3 w-3 text-[var(--mg-accent)]" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-[var(--mg-accent)]" aria-hidden />
                        )
                      ) : null}
                    </button>
                    {referenceHeaders && onFilter ? (
                      <button
                        type="button"
                        aria-label={`Abrir menu da coluna ${c.label}`}
                        aria-haspopup="menu"
                        className={cn("th-menu", filteredKeys?.has(c.key) && "is-on")}
                        onClick={() => onFilter(c.key)}
                      >
                        {filteredKeys?.has(c.key) ? <Filter /> : <MoreVertical />}
                      </button>
                    ) : itens.length ? (
                      <B1Popover
                        className="w-52 p-1"
                        align="start"
                        open={menuFor === c.key}
                        onOpenChange={(o) => setMenuFor(o ? c.key : null)}
                        trigger={
                          <button
                            type="button"
                            aria-label={`Abrir menu da coluna ${c.label}`}
                            className={cn("th-menu", filteredKeys?.has(c.key) && "is-on")}
                          >
                            {filteredKeys?.has(c.key) ? <Filter /> : <MoreVertical />}
                          </button>
                        }
                      >
                        <MenuList
                          onPick={(k) => {
                            setMenuFor(null);
                            if (k === "filter") onFilter?.(c.key);
                            if (k === "fit") onAutoFit?.(c.key);
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
                    onMouseDown={(e) => startResize(e, c)}
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
              <td colSpan={columns.length + 1} className="!h-24">
                <div className="mg-empty-state" role="status" aria-live="polite">Carregando…</div>
              </td>
            </tr>
          ) : null}
          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="!h-24">
                <div className="mg-empty-state">{emptyText}</div>
              </td>
            </tr>
          ) : null}
          {rows.map((r, ri) => {
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
                <td
                  className="td-select sticky left-0 z-[2]"
                  style={{ background: stickyBg(on, ri) }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <MgCheck aria-label="Selecionar linha" checked={on} onChange={() => onToggle(id)} />
                </td>
                {columns.map((c, i) => {
                  const isFrozen = i < frozenCount;
                  const t = cellText(c, r);
                  return (
                    <td
                      key={c.key}
                      title={t}
                      style={{
                        ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : {}),
                        ...(isFrozen ? { left: lefts[c.key] ?? 0, zIndex: 2, background: stickyBg(on, ri) } : {}),
                      }}
                      className={cn(
                        onOpen && "cursor-pointer",
                        isFrozen && "is-frozen",
                        i === frozenCount - 1 && "is-frozen-anchor",
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
          })}
        </tbody>
        {footer ? <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot> : null}
      </table>
    </div>
  );
}
