import React from "react";
import { Check, FileText, Table2, LayoutGrid } from "lucide-react";

/** Reexportações SSOT Base1 (fecha `gate:source-closure` nos controles compartilhados). */
export { MgSelect } from "./MgSelect";
export { MgDatePicker, B1DatePicker, isoToBR, brToISO } from "./MgDatePicker";
export { default as B1Switch } from "./B1Switch";
export { default as B1ChaveRow } from "./B1ChaveRow";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** @typedef {import('react').ComponentPropsWithoutRef<'button'> & { active?: boolean; size?: 'sm'|'md'; danger?: boolean; title?: string; }} IconBtnProps */
/** @type {import('react').ForwardRefRenderFunction<HTMLButtonElement, IconBtnProps>} */
const IconBtnRender = ({ className, active, size = "md", danger, children, title, ...p }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      title={title ?? p["aria-label"]}
      className={cn(
        "tb-btn tb-btn-icon",
        size === "sm" && "tb-btn-sm",
        active && "is-active",
        danger && "is-danger",
        className,
      )}
      {...p}
    >
      {children}
    </button>
  );
};
export const IconBtn = React.forwardRef(IconBtnRender);
IconBtn.displayName = "IconBtn";

/** @typedef {import('react').ComponentPropsWithoutRef<'button'> & { tone?: 'green'|'gray'|'red'|'outline'; title?: string; }} PillBtnProps */
/** @type {import('react').ForwardRefRenderFunction<HTMLButtonElement, PillBtnProps>} */
const PillBtnRender = ({ className, tone = "green", children, title, ...p }, ref) => {
  const toneClass =
    { green: "tb-btn-green", gray: "tb-btn-gray", red: "tb-btn-red", outline: "tb-btn-outline" }[tone] ??
    "tb-btn-green";
  return (
    <button ref={ref} type="button" title={title} className={cn("tb-btn", toneClass, className)} {...p}>
      {children}
    </button>
  );
};
export const PillBtn = React.forwardRef(PillBtnRender);
PillBtn.displayName = "PillBtn";

/**
 * @param {object} props
 * @param {'record'|'table'|'cards'} props.value
 * @param {(m: 'record'|'table'|'cards') => void} props.onChange
 * @param {boolean} [props.recordDisabled]
 * @param {boolean} [props.cardsDisabled]
 */
export function ViewSwitch({ value, onChange, recordDisabled, cardsDisabled }) {
  const item = (m, label, Icon, disabled) => (
    <button
      key={m}
      type="button"
      aria-label={label}
      aria-pressed={value === m}
      disabled={disabled}
      onClick={() => onChange(m)}
    >
      <Icon aria-hidden />
    </button>
  );
  return (
    <div className="view-seg" role="group" aria-label="Modo de visualização">
      {item("record", "Registro", FileText, recordDisabled)}
      {item("table", "Tabela", Table2, false)}
      {item("cards", "Cards", LayoutGrid, cardsDisabled)}
    </div>
  );
}

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.trigger
 * @param {boolean} [props.open]
 * @param {(o: boolean) => void} [props.onOpenChange]
 * @param {import('react').ReactNode} props.children
 * @param {import('react').ReactNode} [props.footer]
 * @param {string} [props.className]
 * @param {'start'|'center'|'end'} [props.align]
 * @param {string} [props.title]
 */
export function B1Popover({
  trigger,
  open,
  onOpenChange,
  children,
  footer,
  className,
  align = "end",
  title,
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* @ts-expect-error PopoverContent forwardRef sem props tipadas no ui/popover */}
      <PopoverContent
        align={align}
        sideOffset={6}
        className={cn(
          "mg-b1-glass-pop z-50 w-72 rounded-[14px] border-0 p-3 text-[12.5px] shadow-none outline-none",
          className,
        )}
      >
        {title ? <div className="mb-2 text-[12px] font-semibold text-slate-700">{title}</div> : null}
        {children}
        {footer ? <div className="mt-3 flex items-center gap-2">{footer}</div> : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.checked
 * @param {() => void} props.onClick
 * @param {string} props.title
 * @param {string} [props.hint]
 */
export function RadioRow({ checked, onClick, title, hint }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left hover:bg-[var(--mg-gray-fill)]"
    >
      <span
        className={cn(
          "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-[var(--mg-accent)] bg-[var(--mg-accent)]" : "border-slate-300 bg-white",
        )}
      >
        {checked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
      </span>
      <span>
        <span className="block text-[12.5px] font-medium text-slate-800">{title}</span>
        {hint ? <span className="block text-[11px] text-slate-500">{hint}</span> : null}
      </span>
    </button>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(checked: boolean) => void} props.onChange
 * @param {import('react').ReactNode} props.label
 * @param {string} [props.hint]
 */
export function CheckRow({ checked, onChange, label, hint }) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-[var(--mg-gray-fill)]"
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-white",
          checked ? "border-[var(--mg-accent)] bg-[var(--mg-accent)]" : "border-slate-300 bg-white",
        )}
        aria-hidden
      >
        {checked ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-6" />
          </svg>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] text-slate-800">{label}</span>
      {hint ? <span className="ml-auto shrink-0 text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

/** @param {{ items: { key: string; label: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean }[]; onPick: (key: string) => void }} props */
export function MenuList({ items, onPick }) {
  return (
    <div className="flex flex-col" role="menu">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          role="menuitem"
          disabled={i.disabled}
          onClick={() => onPick(i.key)}
          className={cn(
            "flex h-[30px] items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-slate-700 hover:bg-[var(--mg-gray-fill)] disabled:opacity-40",
            i.danger && "text-red-600",
          )}
        >
          {i.icon ? <span className="text-[var(--mg-icon)]">{i.icon}</span> : null}
          {i.label}
        </button>
      ))}
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.checked
 * @param {boolean} [props.indeterminate]
 * @param {(checked: boolean) => void} [props.onChange]
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 */
export function MgCheck({ checked, indeterminate, onChange, disabled, className, ...p }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [indeterminate, checked]);
  return (
    <span
      className={cn(
        "mg-check",
        checked && "is-checked",
        indeterminate && !checked && "is-indeterminate",
        disabled && "is-locked",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        className="mg-check__input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          e.stopPropagation();
          onChange?.(e.target.checked);
        }}
        onClick={(e) => e.stopPropagation()}
        {...p}
      />
      {checked ? (
        <Check className="mg-check__icon" strokeWidth={2.5} aria-hidden />
      ) : indeterminate ? (
        <span className="mg-check__dash" aria-hidden />
      ) : null}
    </span>
  );
}
