import React, { useEffect, useRef } from "react";
import { Check, LayoutGrid, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconBtn } from "./Base1Ui";
import { selectClickOf } from "./selectClick";
import {
  ConfiguracaoCamposCardsB1Dialog,
  ConfiguracaoLayoutCardsB1Dialog,
} from "./ConfiguracaoCardsB1Dialogs";

const initials = (s) =>
  String(s || "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .slice(0, 3)
    .toUpperCase() || "—";

const gridCls = {
  1: "grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 xl:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
};

/**
 * @param {object} props
 * @param {object[]} props.rows
 * @param {Array<{ id: string; label: string }>} props.columns
 * @param {string[]} props.fields
 * @param {1|2|3|4} props.perRow
 * @param {boolean} [props.loading]
 * @param {(row: object) => void} [props.onOpen]
 * @param {Set<string>} props.selected
 * @param {(id: string, mod: { ctrl: boolean; shift: boolean }) => void} props.onSelectClick
 * @param {(row: object, colId: string) => string} props.getFieldValue
 * @param {(row: object, colId: string) => import('react').ReactNode} [props.renderCell]
 * @param {(row: object) => string} [props.rowKey]
 * @param {string} [props.titleColId]
 * @param {string} [props.codeColId]
 * @param {string} [props.emptyText]
 */
export function Base1Cards({
  rows,
  columns,
  fields,
  perRow,
  loading,
  onOpen,
  selected,
  onSelectClick,
  getFieldValue,
  renderCell,
  rowKey,
  titleColId,
  codeColId,
  emptyText = "Nenhum registro encontrado",
}) {
  const byKey = new Map(columns.map((c) => [c.id, c]));
  const idOf = rowKey ?? ((r) => String(r.id));
  const titleCol =
    (titleColId && byKey.get(titleColId)) ||
    byKey.get("nome") ||
    byKey.get("name") ||
    byKey.get("descricao") ||
    columns.find((c) => c.id !== codeColId) ||
    columns[0];
  const codeCol = (codeColId && byKey.get(codeColId)) || byKey.get("numero") || byKey.get("code");
  const shown = fields
    .map((k) => byKey.get(k))
    .filter((c) => c && c !== titleCol && c !== codeCol);

  const refs = useRef(/** @type {Record<string, HTMLDivElement | null>} */ ({}));

  useEffect(() => {
    const firstSel = [...selected][0];
    if (firstSel) refs.current[firstSel]?.scrollIntoView({ block: "center" });
  }, [selected, rows.length]);

  if (loading && !rows.length) {
    return (
      <div className="cadastro-b1 mg-empty-state" role="status" aria-live="polite">
        Carregando…
      </div>
    );
  }
  if (!rows.length) {
    return <div className="cadastro-b1 mg-empty-state">{emptyText}</div>;
  }

  const text = (col, r) => {
    if (renderCell) {
      const node = renderCell(r, col.id);
      if (node != null && typeof node !== "object") return String(node);
    }
    return getFieldValue(r, col.id) || "–";
  };

  return (
    <div
      className={cn("grid grid-cols-1 gap-3", gridCls[perRow] || gridCls[4])}
      role="listbox"
      aria-multiselectable
      onSelectStart={(e) => e.preventDefault()}
      onMouseDown={() => {
        const sel = window.getSelection?.();
        if (sel && sel.rangeCount > 0) sel.removeAllRanges();
      }}
    >
      {rows.map((r) => {
        const id = idOf(r);
        const on = selected.has(id);
        const t = titleCol ? text(titleCol, r) : "";
        const code = codeCol ? text(codeCol, r) : "";
        return (
          <div
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            data-testid="b1-card"
            role="option"
            tabIndex={0}
            aria-selected={on}
            className={cn(
              "mg-card b1-card group relative cursor-pointer select-none p-4",
              on && "is-selected",
            )}
            onClick={(e) => onSelectClick(id, selectClickOf(e))}
            onDoubleClick={() => onOpen?.(r)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onOpen?.(r);
              } else if (e.key === " ") {
                e.preventDefault();
                onSelectClick(id, selectClickOf(e));
              }
            }}
          >
            {on ? (
              <span className="b1-card__badge" aria-hidden>
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--mg-accent)] text-[11px] font-bold text-white">
                {initials(typeof t === "string" ? t : getFieldValue(r, titleCol?.id))}
              </span>
              <span className="mg-b1-card__title">
                {code ? <span className="mg-b1-card__code">{code} • </span> : null}
                {t}
              </span>
            </div>
            <dl className="mg-b1-card__fields">
              {shown.map((c) => (
                <React.Fragment key={c.id}>
                  <dt className="mg-b1-card__label">{c.label}:</dt>
                  <dd className="mg-b1-card__value" title={String(text(c, r))}>
                    {renderCell ? renderCell(r, c.id) : text(c, r)}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Diálogos de layout/campos dos cards (menu Mais opções / faixa Base1).
 *
 * @param {object} props
 * @param {Array<{ id: string; label: string }>} props.columns
 * @param {ReturnType<import('@/hooks/useCadastroCardsPrefs').useCadastroCardsPrefs>} props.cardsPrefs
 * @param {boolean} [props.layoutOpen]
 * @param {(open: boolean) => void} [props.onLayoutOpenChange]
 * @param {boolean} [props.fieldsOpen]
 * @param {(open: boolean) => void} [props.onFieldsOpenChange]
 * @param {boolean} [props.showToolbarTriggers] botões na faixa (fora do menu ⚡)
 */
export function Base1CardsToolbar({
  columns,
  cardsPrefs,
  layoutOpen,
  onLayoutOpenChange,
  fieldsOpen,
  onFieldsOpenChange,
  showToolbarTriggers = false,
}) {
  const { cardsPerRow, setCardsPerRow, cardFields, setCardFields, restoreLayout, restoreFields } =
    cardsPrefs;

  const [layoutInternal, setLayoutInternal] = React.useState(false);
  const [fieldsInternal, setFieldsInternal] = React.useState(false);

  const layoutDialogOpen = layoutOpen ?? layoutInternal;
  const setLayoutDialogOpen = onLayoutOpenChange ?? setLayoutInternal;
  const fieldsDialogOpen = fieldsOpen ?? fieldsInternal;
  const setFieldsDialogOpen = onFieldsOpenChange ?? setFieldsInternal;

  return (
    <>
      {showToolbarTriggers ? (
        <>
          <IconBtn
            size="sm"
            aria-label="Configurar layout dos cards"
            title="Configurar layout dos cards"
            active={layoutDialogOpen}
            onClick={() => setLayoutDialogOpen(true)}
          >
            <LayoutGrid className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            size="sm"
            aria-label="Configurar campos dos cards"
            title="Configurar campos dos cards"
            active={fieldsDialogOpen}
            onClick={() => setFieldsDialogOpen(true)}
          >
            <ListChecks className="h-4 w-4" />
          </IconBtn>
        </>
      ) : null}
      <ConfiguracaoLayoutCardsB1Dialog
        open={layoutDialogOpen}
        onFechar={() => setLayoutDialogOpen(false)}
        value={cardsPerRow}
        onAplicar={setCardsPerRow}
        onRestaurar={restoreLayout}
      />
      <ConfiguracaoCamposCardsB1Dialog
        open={fieldsDialogOpen}
        onFechar={() => setFieldsDialogOpen(false)}
        columns={columns}
        value={cardFields}
        onAplicar={setCardFields}
        onRestaurar={restoreFields}
      />
    </>
  );
}
