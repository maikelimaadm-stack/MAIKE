import React from "react";
import { ArrowLeft } from "lucide-react";

/**
 * Cabeçalho de página cadastro alinhado ao chrome Base1.
 */
export default function CadastroWorkspaceHeader({ title, subtitle, isDetail, onBack, toolbar }) {
  return (
    <header className="mg-card flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {isDetail && onBack ? (
          <button
            type="button"
            className="tb-btn tb-btn-gray w-fit gap-1 -ml-1"
            onClick={onBack}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Voltar à lista
          </button>
        ) : null}
        <h1 className="text-base font-semibold text-[var(--mg-text-1)] truncate">{title}</h1>
        {subtitle ? (
          <p className="text-xs text-[var(--mg-text-2)] leading-snug">{subtitle}</p>
        ) : null}
      </div>
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0 cadastro-b1">{toolbar}</div>
      ) : null}
    </header>
  );
}
