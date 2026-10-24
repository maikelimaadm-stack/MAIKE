import React from "react";
import { Check, FileText, Table2, LayoutGrid } from "lucide-react";

/** Reexportações SSOT Base1 (fecha `gate:source-closure` nos controles compartilhados). */
export { MgSelect } from "./MgSelect";
export { MgDatePicker, B1DatePicker, isoToBR, brToISO } from "./MgDatePicker";
export { default as B1Switch } from "./B1Switch";
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
 * @param {string} [props.className]
 * @param {'start'|'center'|'end'} [props.align]
 * @param {string} [props.title]
 */
export function B1Popover({ trigger, open, onOpenChange, children, className, align = "end", title }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* @ts-expect-error PopoverContent forwardRef sem props tipadas no ui/popover */}
      <PopoverContent
        align={align}
        sideOffset={6}
        className={cn(
          "mg-b1-glass-pop z-50 w-72 rounded-[14px] p-3 text-[12.5px] outline-none",
          className,
        )}
      >
        {title ? <div className="mb-2 text-[12px] font-semibold text-slate-700">{title}</div> : null}
        {children}
      </PopoverContent>
    </Popover>
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
