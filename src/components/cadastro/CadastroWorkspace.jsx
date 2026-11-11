import React from "react";
import CadastroWorkspaceHeader from "@/components/cadastro/base1/CadastroWorkspaceHeader";
import { useMovimentoBase1 } from "@/components/cadastro/base1/movimentoBase1";
import { useCascoBase1 } from "@/components/cadastro/base1/telaBase1";

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
  // Movimento do design (toque, janelas que nascem do botão) enquanto a tela Base1 está aberta (D-PROD-165).
  useMovimentoBase1(pageLayout === "base1-list");
  const casco = useCascoBase1();

  if (pageLayout === "base1-list") {
    return (
      <div ref={casco} className="cadastro-b1 cadastro-b1--full-page flex h-full min-h-0 min-w-0 flex-1 flex-col gap-1.5">
        {title ? (
          <h1 className="cadastro-b1__page-title truncate px-0.5" title={title}>
            {title}
          </h1>
        ) : null}
        {/* Desktop (D-PROD-164): o h1 fica só para leitores de tela e o título visível é este. */}
        {title ? (
          <span className="b1-tb-titulo" aria-hidden="true">
            {title}
          </span>
        ) : null}
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
