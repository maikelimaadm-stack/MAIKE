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
  if (embedded) {
    return <div className={`min-h-0 ${className}`.trim()}>{children}</div>;
  }

  return (
    <div className={`cadastro-b1 min-h-0 ${className}`}>
      <div className="mg-card overflow-hidden">
        {title ? (
          <div className="mg-b1-form-header">
            <h2 className="mg-card-title">{title}</h2>
            {subtitle ? <p className="mg-b1-form-header__subtitle">{subtitle}</p> : null}
          </div>
        ) : null}
        <div className="p-3">{children}</div>
      </div>
    </div>
  );
}
