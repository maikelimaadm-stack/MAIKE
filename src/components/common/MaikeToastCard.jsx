import React from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cartão de notificação no modelo Base1 (foto: ícone circular + título + descrição + X).
 * @param {{
 *   tone?: 'success'|'warning'|'error'|'info';
 *   title: string;
 *   description?: string;
 *   onClose?: () => void;
 *   className?: string;
 * }} props
 */
export default function MaikeToastCard({
  tone = "success",
  title,
  description,
  onClose,
  className,
}) {
  const Icon =
    tone === "warning" || tone === "error"
      ? AlertTriangle
      : tone === "info"
        ? Info
        : Check;

  return (
    <div className={cn("mg-toast", `mg-toast--${tone}`, className)} role="status">
      <span className={cn("mg-toast__icon", `mg-toast__icon--${tone}`)} aria-hidden>
        <Icon className="mg-toast__glyph" strokeWidth={2.5} />
      </span>
      <div className="mg-toast__body">
        <div className="mg-toast__title">{title}</div>
        {description ? <div className="mg-toast__desc">{description}</div> : null}
      </div>
      {onClose ? (
        <button
          type="button"
          className="mg-toast__close"
          aria-label="Fechar"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
