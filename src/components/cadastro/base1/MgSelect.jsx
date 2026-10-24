import React, { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * @param {object} props
 * @param {{ value: string; label: string; code?: string | null; title?: string | null }[]} props.options
 * @param {string} [props.value]
 * @param {(o: { value: string; label: string }) => void} props.onPick
 * @param {string} props.search
 * @param {(s: string) => void} props.onSearch
 * @param {boolean} [props.searchable]
 * @param {boolean} [props.loading]
 * @param {string} [props.emptyText]
 * @param {string} [props.placeholder]
 * @param {boolean} [props.autoFocus]
 * @param {number} [props.destaqueAoAbrir]
 */
function CmdPanel({
  options,
  value,
  onPick,
  search,
  onSearch,
  searchable = true,
  loading,
  emptyText = "Nenhuma opção",
  placeholder = "Pesquisar...",
  autoFocus = true,
  destaqueAoAbrir = 0,
}) {
  const [hi, setHi] = useState(destaqueAoAbrir);
  useEffect(() => {
    setHi(search ? 0 : destaqueAoAbrir);
  }, [search, options.length, destaqueAoAbrir]);
  const listRef = useRef(null);
  useEffect(() => {
    const el = listRef.current?.children[hi];
    el?.scrollIntoView?.({ block: "nearest" });
  }, [hi]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(options.length - 1, h + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const o = options[hi];
      if (o) onPick(o);
    }
  };

  return (
    <div onKeyDown={onKey}>
      {searchable ? (
        <input
          autoFocus={autoFocus}
          className="cmd-panel__search"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Pesquisar opção"
        />
      ) : null}
      <div ref={listRef} className="cmd-panel-options" role="listbox">
        {loading ? <div className="cmd-panel__empty">Carregando…</div> : null}
        {!loading && options.length === 0 ? <div className="cmd-panel__empty">{emptyText}</div> : null}
        {options.map((o, i) => (
          <button
            type="button"
            key={o.value}
            role="option"
            aria-selected={o.value === value}
            className={cn("cmd-option", o.value === value && "selected", i === hi && "highlighted")}
            title={o.title ?? undefined}
            onMouseEnter={() => setHi(i)}
            onClick={() => onPick(o)}
          >
            {o.code ? <span className="cmd-option__code">{o.code}</span> : null}
            <span className="truncate">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** @type {import('react').ForwardRefRenderFunction<HTMLButtonElement, import('react').ComponentPropsWithoutRef<'button'> & { className?: string; placeholder?: string; empty?: boolean; onClear?: () => void; children?: React.ReactNode; disabled?: boolean; wrapClassName?: string }>} */
const CmdDisplayRender = (
  { className, placeholder = "Selecione", empty, onClear, children, disabled, wrapClassName, ...p },
  ref,
) => (
    <span className={cn("relative flex w-full min-w-0 items-center", wrapClassName)}>
      <button
        ref={ref}
        type="button"
        role="combobox"
        disabled={disabled}
        className={cn("cmd-display", empty && "is-empty", className)}
        {...p}
      >
        {empty ? <span className="cmd-display-placeholder">{placeholder}</span> : children}
      </button>
      {!empty && onClear && !disabled ? (
        <X
          className="cmd-clear"
          aria-label="Limpar"
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        />
      ) : null}
      <ChevronDown className="cmd-chevron" aria-hidden />
    </span>
);
const CmdDisplay = React.forwardRef(CmdDisplayRender);
CmdDisplay.displayName = "CmdDisplay";

/**
 * Seletor Base1 com painel vidro (port `MgSelect` / cmd-display — CONTROLE-DE-ESTOQUE).
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(v: string) => void} props.onChange
 * @param {{ value: string; label: string; code?: string | null; title?: string | null }[]} props.options
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.allowEmpty]
 * @param {string} [props.id]
 * @param {(o: boolean) => void} [props.onOpenChange]
 * @param {string} [props.className]
 * @param {string} [props.wrapClassName]
 * @param {string} [props.contentClassName]
 * @param {import("@radix-ui/react-popover").PopoverContentProps["side"]} [props.popoverSide]
 * @param {string} [props.ariaLabel]
 */
export function MgSelect({
  value,
  onChange,
  options,
  placeholder = "Selecione",
  disabled,
  allowEmpty,
  id,
  onOpenChange,
  className,
  wrapClassName,
  contentClassName,
  popoverSide = "bottom",
  ariaLabel,
}) {
  const [open, setOpenState] = useState(false);
  const [search, setSearch] = useState("");
  const setOpen = (o) => {
    if (disabled) return;
    setOpenState(o);
    onOpenChange?.(o);
    if (!o) setSearch("");
  };
  const cur = options.find((o) => o.value === value);
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <CmdDisplay
          id={id}
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          empty={!cur}
          placeholder={placeholder}
          onClear={allowEmpty ? () => onChange("") : undefined}
          className={className}
          wrapClassName={wrapClassName}
        >
          {cur?.label}
        </CmdDisplay>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side={popoverSide}
          sideOffset={4}
          className={cn(
            "cmd-panel mg-b1-glass-pop z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[220px] outline-none",
            contentClassName,
          )}
          onOpenAutoFocus={(e) => {
            if (options.length <= 8) e.preventDefault();
          }}
        >
          <CmdPanel
            options={filtered}
            value={value}
            search={search}
            onSearch={setSearch}
            searchable={options.length > 8}
            autoFocus={options.length > 8}
            onPick={(o) => {
              onChange(o.value);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
