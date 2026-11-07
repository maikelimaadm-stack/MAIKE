import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Folder } from "lucide-react";
import { createPageUrl } from "@/utils";
import { ICONE_MODULO } from "@/components/navigation/MobileModulesView";

/** Ícone de cada módulo — o mesmo mapa da tela de Módulos do celular. */
const ICONE_DO_MODULO = /** @type {Record<string, React.ComponentType<any>>} */ (ICONE_MODULO);

/**
 * @typedef {{ id: string, title: string, url?: string }} PaginaMenu
 * @typedef {{ id: string, title: string, url?: string, submenu?: PaginaMenu[] }} ItemMenu
 */

/**
 * Menu lateral do desktop (lg+), no estilo app-shell: uma barra vertical com os
 * módulos e suas telas que recolhe e expande pela faixa na borda direita — a
 * mesma faixa (e o mesmo estado `menu_oculto`) usada pelo botão do cabeçalho.
 *
 * Recolhido, o módulo vira um ícone e as telas aparecem num painel ao lado.
 *
 * @param {{
 *   items: ItemMenu[],
 *   currentPath: string,
 *   onNavigate: (event: React.MouseEvent, path: string) => void,
 *   collapsed: boolean,
 *   onToggle: () => void,
 * }} props
 */
export default function DesktopSidebar({ items, currentPath, onNavigate, collapsed, onToggle }) {
  const telasDoModulo = (item) =>
    item.submenu?.length
      ? item.submenu.filter((sub) => Boolean(sub.url))
      : item.url
        ? [{ id: item.id, title: item.title, url: item.url }]
        : [];

  const iconeDoModulo = (id) => ICONE_DO_MODULO[id] || Folder;

  const linkDaTela = (page, compacto) => {
    const ativo = currentPath === createPageUrl(page.url);
    return (
      <Link
        key={page.id}
        to={createPageUrl(page.url)}
        onClick={(event) => onNavigate(event, createPageUrl(page.url))}
        aria-current={ativo ? "page" : undefined}
        className={`block rounded-md ${compacto ? "px-2 py-1.5" : "px-3 py-2"} text-xs font-medium transition-colors ${
          ativo ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        {page.title}
      </Link>
    );
  };

  return (
    <nav
      id="app-shell-sidebar"
      aria-label="Módulos"
      data-collapsed={collapsed ? "true" : "false"}
      className={`relative hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-300 lg:flex ${
        collapsed ? "w-[76px]" : "w-[264px]"
      }`}
    >
      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto py-4">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expandir menu"
            title="Expandir menu"
            className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ChevronRight size={18} aria-hidden />
          </button>
          {items.map((item) => {
            const Icon = iconeDoModulo(item.id);
            const telas = telasDoModulo(item);
            const moduloAtivo = telas.some((page) => currentPath === createPageUrl(page.url));
            return (
              <div key={item.id} className="group relative">
                <button
                  type="button"
                  onClick={onToggle}
                  aria-label={`Abrir menu ${item.title}`}
                  title={item.title}
                  className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                    moduloAtivo ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon size={20} aria-hidden />
                </button>
                <div className="absolute left-full top-0 z-50 hidden pl-2 group-hover:block group-focus-within:block">
                  <div className="w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                    <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {item.title}
                    </div>
                    {telas.map((page) => linkDaTela(page, true))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Menu</span>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Recolher menu"
              title="Recolher menu"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
          </div>
          {items.map((item) => {
            const Icon = iconeDoModulo(item.id);
            return (
              <div key={item.id} className="mb-5">
                <div className="flex items-center gap-2 px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Icon size={14} aria-hidden />
                  <span>{item.title}</span>
                </div>
                <ul className="space-y-0.5">{telasDoModulo(item).map((page) => linkDaTela(page, false))}</ul>
              </div>
            );
          })}
        </div>
      )}

      {/* Faixa app-shell: clique/arraste na borda recolhe ou expande a barra. */}
      <button
        type="button"
        aria-controls="app-shell-sidebar"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Exibir barra lateral" : "Recolher barra lateral"}
        title={collapsed ? "Exibir barra lateral" : "Recolher barra lateral"}
        onClick={onToggle}
        className={`absolute inset-y-0 -right-1 z-20 w-2 bg-transparent outline-none transition-colors hover:bg-emerald-200 focus-visible:bg-emerald-300 ${
          collapsed ? "cursor-e-resize" : "cursor-w-resize"
        }`}
      />
    </nav>
  );
}
