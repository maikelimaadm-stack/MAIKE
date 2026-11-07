import React from "react";
import { createPortal } from "react-dom";
import { Pin } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

/**
 * Listagem lateral do módulo, no estilo dos antigos menus do cabeçalho: aparece
 * ao passar o mouse sobre o ícone quando a barra está recolhida.
 *
 * Renderiza num portal (posição fixa) porque o trilho de ícones vive dentro de
 * um container com rolagem — ali um painel absoluto seria cortado.
 *
 * @param {{
 *   titulo: string,
 *   paginas: import("./DesktopSidebar").PaginaMenu[],
 *   currentPath: string,
 *   top: number,
 *   left: number,
 *   onNavegar: (event: React.MouseEvent, path: string) => void,
 *   onFixar: () => void,
 *   onMouseEnter: () => void,
 *   onMouseLeave: () => void,
 * }} props
 */
export default function SidebarModuloFlyout({
  titulo,
  paginas,
  currentPath,
  top,
  left,
  onNavegar,
  onFixar,
  onMouseEnter,
  onMouseLeave,
}) {
  return createPortal(
    <div
      className="mk-sidebar-flyout-anchor fixed z-[120]"
      style={{ top: top - 8, left, paddingTop: 8 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocusCapture={onMouseEnter}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onMouseLeave(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onMouseLeave();
      }}
    >
    <div role="menu" aria-label={titulo}
      style={{ maxHeight: `calc(100dvh - ${top + 12}px)` }}
      className="mk-sidebar-flyout w-[240px] rounded-xl bg-white p-1.5">
      <div className="mk-sidebar-flyout-header">
        <span>{titulo}</span>
        <button type="button" onClick={onFixar} aria-label="Fixar menu" title="Fixar menu"><Pin size={15} aria-hidden /></button>
      </div>
      {paginas.map((page) => {
        const ativo = currentPath === createPageUrl(page.url);
        return (
          <Link
            key={page.id}
            to={createPageUrl(page.url)}
            role="menuitem"
            onClick={(event) => onNavegar(event, createPageUrl(page.url))}
            aria-current={ativo ? "page" : undefined}
            className={`flex h-[32px] items-center rounded-lg px-2.5 text-[12.5px] transition-colors hover:bg-[var(--mk-btn-ativo)] ${
              ativo ? "font-semibold text-[#16a34a]" : "text-[#292a2d]"
            }`}
          >
            <span className="truncate">{page.title}</span>
          </Link>
        );
      })}
    </div>
    </div>,
    document.body,
  );
}
