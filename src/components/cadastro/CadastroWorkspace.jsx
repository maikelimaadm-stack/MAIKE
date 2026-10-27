import React from "react";
import CadastroWorkspaceHeader from "@/components/cadastro/base1/CadastroWorkspaceHeader";

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
 *   pageLayout?: 'default' | 'base1-list',
 *   onBack?: () => void,
 *   toolbar?: import('react').ReactNode,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function CadastroWorkspace({
  title,
  subtitle,
  mode = "list",
  pageLayout = "default",
  onBack,
  toolbar,
  children,
}) {
  const isDetail = mode === "detail";

  if (pageLayout === "base1-list") {
    return (
      <div className="cadastro-b1 cadastro-b1--full-page flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2">
        {title ? <h1 className="sr-only">{title}</h1> : null}
        {children}
      </div>
    );
  }

  return (
    <div className="cadastro-b1 flex flex-col gap-2 p-3 md:p-4 min-h-0">
      <CadastroWorkspaceHeader
        title={title}
        subtitle={subtitle}
        isDetail={isDetail}
        onBack={onBack}
        toolbar={toolbar}
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
