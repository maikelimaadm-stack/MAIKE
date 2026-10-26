import React, { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { painelCalendarioCentralVendas } from "./B1CalendarioDoSistema";

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad = (n) => String(n).padStart(2, "0");

export const isoToBR = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

export const brToISO = (s) => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  let ano = Number(m[3]);
  if (ano < 100) ano += 2000;
  const iso = `${ano}-${pad(m[2])}-${pad(m[1])}`;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[1]) ? "" : iso;
};

const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const fmtInput = (raw) => {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
};

function PainelMgDpPadrao({ cursor, setCursor, view, setView, sel, today, pick }) {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const yearStart = y - 5;
  const title =
    view === "days" ? `${MONTHS[m]} de ${y}` : view === "months" ? String(y) : `${yearStart} – ${yearStart + 11}`;
  const nav = (dir) =>
    setCursor(view === "days" ? new Date(y, m + dir, 1) : view === "months" ? new Date(y + dir, m, 1) : new Date(y + dir * 12, m, 1));
  const layerOffset = { days: 0, months: 1, years: 2 }[view];

  return (
    <>
      <div className="mg-dp-header">
        <button type="button" className="mg-dp-nav" aria-label="Anterior" onClick={() => nav(-1)}>
          <ChevronLeft />
        </button>
        <button type="button" className="mg-dp-title" onClick={() => setView(view === "days" ? "months" : "years")}>
          {title}
        </button>
        <button type="button" className="mg-dp-nav" aria-label="Próximo" onClick={() => nav(1)}>
          <ChevronRight />
        </button>
      </div>
      <div className="mg-dp-body">
        <div className="mg-dp-viewport">
          <div className="mg-dp-view-track" style={{ transform: `translate3d(0, -${layerOffset * 272}px, 0)` }}>
            <div className="mg-dp-view-layer mg-dp-view-layer--days">
              <div className="mg-dp-weekdays">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="mg-dp-wd">{w}</div>
                ))}
              </div>
              <div className="mg-dp-days">
                {cells.map((d) => {
                  const other = d.getMonth() !== m;
                  const isSel = sel ? toISO(d) === toISO(sel) : false;
                  const isToday = toISO(d) === toISO(today);
                  return (
                    <button
                      type="button"
                      key={toISO(d)}
                      disabled={other}
                      className={cn("mg-dp-day", other && "other", isToday && "today", isSel && "selected")}
                      onClick={() => pick(d)}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mg-dp-view-layer mg-dp-view-layer--grid">
              <div className="mg-dp-grid">
                {MONTHS_SHORT.map((mm, i) => (
                  <button
                    type="button"
                    key={mm}
                    className={cn("mg-dp-pick", i === m && "selected")}
                    onClick={() => {
                      setCursor(new Date(y, i, 1));
                      setView("days");
                    }}
                  >
                    {mm}
                  </button>
                ))}
              </div>
            </div>
            <div className="mg-dp-view-layer mg-dp-view-layer--grid">
              <div className="mg-dp-grid">
                {Array.from({ length: 12 }, (_, i) => yearStart + i).map((yy) => (
                  <button
                    type="button"
                    key={yy}
                    className={cn("mg-dp-pick", yy === y && "selected")}
                    onClick={() => {
                      setCursor(new Date(yy, m, 1));
                      setView("months");
                    }}
                  >
                    {yy}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Calendário Base1 (port `MgDatePicker` — valor ISO AAAA-MM-DD).
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(iso: string) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.id]
 * @param {string} [props.name]
 * @param {string} [props.className]
 * @param {(o: boolean) => void} [props.onOpenChange]
 * @param {string} [props.placeholder]
 * @param {'central'|'mg'} [props.variant] `central` = painel vidro da central de vendas
 */
export function MgDatePicker({
  value,
  onChange,
  disabled,
  id,
  name,
  className,
  onOpenChange,
  placeholder,
  variant = "central",
}) {
  const painel = variant === "central" ? painelCalendarioCentralVendas : null;
  const [open, setOpenState] = useState(false);
  const [view, setView] = useState("days");
  const ancora = useRef(null);
  const [text, setText] = useState(isoToBR(value));
  useEffect(() => {
    setText(isoToBR(value));
  }, [value]);

  const today = new Date();
  const sel = value && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(`${value.slice(0, 10)}T00:00:00`) : null;
  const [cursor, setCursor] = useState(sel ?? today);

  const setOpen = (o) => {
    if (disabled) return;
    if (o) {
      setCursor(sel ?? today);
      setView("days");
    }
    setOpenState(o);
    onOpenChange?.(o);
  };

  const pick = (d) => {
    onChange(toISO(d));
    setOpen(false);
  };

  const commitText = () => {
    if (!text) {
      if (value) onChange("");
      return;
    }
    const iso = brToISO(text);
    if (iso) {
      if (iso !== value) onChange(iso);
    } else setText(isoToBR(value));
  };

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitText();
      setOpen(false);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const base = sel ?? today;
      const d = new Date(base);
      d.setDate(d.getDate() + (e.key === "ArrowUp" ? -7 : 7));
      onChange(toISO(d));
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div ref={ancora} className={cn("relative flex w-full items-center", className)}>
          <input
            id={id}
            name={name}
            type="text"
            inputMode="numeric"
            className="mg-dp-field"
            value={text}
            placeholder={placeholder ?? " "}
            disabled={disabled}
            onChange={(e) => setText(fmtInput(e.target.value))}
            onBlur={commitText}
            onKeyDown={onKey}
            onClick={() => setOpen(true)}
            onFocus={(e) => {
              if (!open && e.currentTarget.matches(":focus-visible")) setOpen(true);
            }}
            autoComplete="off"
          />
          {!painel?.semIcone ? (
            <span className="mg-dp-icon">
              <Calendar />
            </span>
          ) : null}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        {painel ? (
          <Popover.Content
            align="start"
            sideOffset={4}
            className={painel.className}
            aria-label={painel.rotulo}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (e.target instanceof Node && ancora.current?.contains(e.target)) e.preventDefault();
            }}
          >
            {painel.desenhar({
              valor: value,
              escolher: (iso) => {
                onChange(iso);
                setOpen(false);
              },
            })}
          </Popover.Content>
        ) : (
          <Popover.Content
            align="start"
            sideOffset={4}
            className="mg-b1-glass-pop mg-dp-panel outline-none"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <PainelMgDpPadrao
              cursor={cursor}
              setCursor={setCursor}
              view={view}
              setView={setView}
              sel={sel}
              today={today}
              pick={pick}
            />
          </Popover.Content>
        )}
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Campo de data para formulários Base1 (hidden ISO + picker central de vendas).
 */
export function B1DatePicker({ value, onChange, disabled, id, className, onOpenChange }) {
  return (
    <>
      <input type="hidden" value={value} readOnly />
      <MgDatePicker
        id={id}
        className={className}
        value={value}
        onChange={onChange}
        disabled={disabled}
        onOpenChange={onOpenChange}
        variant="central"
      />
    </>
  );
}
