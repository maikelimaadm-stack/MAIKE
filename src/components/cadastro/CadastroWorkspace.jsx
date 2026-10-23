import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * Shell de cadastro inspirado no workspace Frota (UX-01 piloto).
 *
 * Centraliza cabeçalho, subtítulo e faixa de ações para telas lista/detalhe,
 * sem acoplar a uma entidade específica.
 *
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   mode?: 'list'|'detail',
 *   onBack?: () => void,
 *   toolbar?: import('react').ReactNode,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function CadastroWorkspace({
  title,
  subtitle,
  mode = "list",
  onBack,
  toolbar,
  children,
}) {
  const isDetail = mode === "detail";

  return (
    <div className="flex flex-col gap-3 p-3 md:p-4 min-h-0">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {isDetail && onBack ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="h-7 w-fit gap-1 px-2 text-xs text-slate-600 hover:text-slate-900 -ml-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar à lista
            </Button>
          ) : null}
          <h1 className="text-lg font-semibold text-slate-900 truncate">{title}</h1>
          {subtitle ? (
            <p className="text-xs text-slate-500 leading-snug">{subtitle}</p>
          ) : null}
        </div>
        {toolbar ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{toolbar}</div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
