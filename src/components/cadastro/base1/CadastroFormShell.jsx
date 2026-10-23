import React from "react";

/**
 * Superfície de formulário cadastro Base1 (mg-card). Inclui wrapper `.cadastro-b1`.
 *
 * @param {object} props
 * @param {string} [props.title]
 * @param {string} [props.subtitle]
 * @param {boolean} [props.embedded]
 * @param {import("react").ReactNode} props.children
 * @param {string} [props.className]
 */
export default function CadastroFormShell({
  title,
  subtitle,
  embedded = false,
  children,
  className = "",
}) {
  return (
    <div className={`cadastro-b1 min-h-0 ${className}`}>
      <div className="mg-card overflow-hidden">
        {!embedded && title ? (
          <div className="border-b border-[var(--mg-divider)] px-3 py-2 bg-slate-50/90">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle ? <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p> : null}
          </div>
        ) : null}
        <div className={embedded ? "p-3 pt-2" : "p-3"}>{children}</div>
      </div>
    </div>
  );
}
