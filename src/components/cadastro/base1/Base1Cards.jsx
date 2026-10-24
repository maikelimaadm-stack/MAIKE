import React, { useEffect, useRef } from "react";
import { Check, LayoutGrid, ListChecks, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { B1Popover, IconBtn, PillBtn } from "./Base1Ui";
import { selectClickOf } from "./selectClick";

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
    if (firstSel) refs.current[firstSel]?.scrollIntoView({ block: "nearest" });
  }, [selected, rows.length]);

  if (loading && !rows.length) {
    return <div className="py-10 text-center text-sm text-slate-500">Carregando…</div>;
  }
  if (!rows.length) {
    return <div className="py-10 text-center text-sm text-slate-500">{emptyText}</div>;
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
              "mg-card b1-card group relative cursor-pointer select-none p-4 transition-shadow hover:shadow-[0_6px_20px_rgba(0,0,0,.09)]",
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
              <span className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-slate-800">
                {code ? <span className="text-slate-500">{code} • </span> : null}
                {t}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
              {shown.map((c) => (
                <React.Fragment key={c.id}>
                  <dt className="truncate text-slate-500">{c.label}:</dt>
                  <dd className="truncate font-medium text-slate-800" title={String(text(c, r))}>
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

const PER_ROW = [
  { n: 1, hint: "Até 5 campos por linha no card" },
  { n: 2, hint: "Até 2 campos por linha no card" },
  { n: 3, hint: "1 campo por linha no card" },
  { n: 4, hint: "1 campo por linha no card" },
];

function RadioRow({ checked, onClick, title, hint }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col rounded-lg px-2 py-2 text-left hover:bg-[var(--mg-gray-fill)]",
        checked && "bg-[var(--mg-accent-light)]",
      )}
    >
      <span className="text-[12.5px] font-semibold text-slate-800">{title}</span>
      <span className="text-[11px] text-slate-500">{hint}</span>
    </button>
  );
}

function CheckRow({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--mg-gray-fill)]">
      <input
        type="checkbox"
        className="rounded border-slate-300"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-[12.5px] text-slate-700">{label}</span>
    </label>
  );
}

/** Popovers de layout/campos dos cards (faixa de filtros Base1). */
export function Base1CardsToolbar({ columns, cardsPrefs }) {
  const { cardsPerRow, setCardsPerRow, cardFields, setCardFields, restoreLayout, restoreFields } =
    cardsPrefs;

  return (
    <>
      <CardsLayoutPopover value={cardsPerRow} onChange={setCardsPerRow} onRestore={restoreLayout} />
      <CardFieldsPopover
        columns={columns}
        value={cardFields}
        onChange={setCardFields}
        onRestore={restoreFields}
      />
    </>
  );
}

function CardsLayoutPopover({ value, onChange, onRestore }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <B1Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <IconBtn
          size="sm"
          aria-label="Configurar layout dos cards"
          title="Configurar layout dos cards"
          active={open}
        >
          <LayoutGrid className="h-4 w-4" />
        </IconBtn>
      }
    >
      <div role="radiogroup" aria-label="Cards por linha">
        {PER_ROW.map((o) => (
          <RadioRow
            key={o.n}
            checked={draft === o.n}
            onClick={() => setDraft(/** @type {1|2|3|4} */ (o.n))}
            title={`${o.n} card${o.n > 1 ? "s" : ""} por linha`}
            hint={o.hint}
          />
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <PillBtn tone="gray" className="flex-1 justify-center" onClick={() => { onRestore(); setOpen(false); }}>
          Restaurar
        </PillBtn>
        <PillBtn
          className="flex-1 justify-center"
          onClick={() => {
            onChange(draft);
            setOpen(false);
          }}
        >
          OK
        </PillBtn>
      </div>
    </B1Popover>
  );
}

function CardFieldsPopover({ columns, value, onChange, onRestore }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <B1Popover
      open={open}
      onOpenChange={setOpen}
      className="w-72"
      trigger={
        <IconBtn
          size="sm"
          aria-label="Configurar campos dos cards"
          title="Configurar campos dos cards"
          active={open}
        >
          <ListChecks className="h-4 w-4" />
        </IconBtn>
      }
    >
      <div className="max-h-72 overflow-auto">
        {[...columns]
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
          .map((c) => (
            <CheckRow
              key={c.id}
              label={c.label}
              checked={draft.includes(c.id)}
              onChange={(on) =>
                setDraft((d) => (on ? [...d, c.id] : d.filter((k) => k !== c.id)))
              }
            />
          ))}
      </div>
      <div className="mt-3 flex gap-2">
        <PillBtn tone="gray" className="flex-1 justify-center" onClick={() => { onRestore(); setOpen(false); }}>
          Restaurar
        </PillBtn>
        <PillBtn
          className="flex-1 justify-center"
          onClick={() => {
            onChange(draft);
            setOpen(false);
          }}
        >
          OK
        </PillBtn>
      </div>
    </B1Popover>
  );
}
