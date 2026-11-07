import React from "react";
import { createPortal } from "react-dom";
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
  onMouseEnter,
  onMouseLeave,
}) {
  return createPortal(
    <div
      role="menu"
      aria-label={titulo}
      style={{ top, left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-[80] w-[224px] rounded-xl border border-[#e9edf2] bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold tracking-[0.15px] text-[#64748b]">{titulo}</div>
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
    </div>,
    document.body,
  );
}
