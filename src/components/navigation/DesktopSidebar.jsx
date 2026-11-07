import React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Folder, Home, PanelLeft, Search } from "lucide-react";
import { createPageUrl } from "@/utils";
import { ICONE_MODULO } from "@/components/navigation/MobileModulesView";

/** Ícone de cada módulo — o mesmo mapa da tela de Módulos do celular. */
const ICONE_DO_MODULO = /** @type {Record<string, React.ComponentType<any>>} */ (ICONE_MODULO);

const PAGINA_INICIAL = "MapaGeral";

/** Classes compartilhadas dos itens da barra (protótipo "menu inspirado no ChatGPT"). */
const ITEM_BASE =
  "flex h-[38px] w-full items-center gap-[11px] rounded-[9px] px-3 text-left whitespace-nowrap transition-colors hover:bg-[#eaeeeb]";
const ITEM_ATIVO = "bg-[#e5f4e9] font-semibold text-[#158b3b]";
const ICONE_ITEM = "h-[19px] w-[19px] shrink-0 text-[#617167]";

/**
 * @typedef {{ id: string, title: string, url?: string }} PaginaMenu
 * @typedef {{ id: string, title: string, url?: string, submenu?: PaginaMenu[] }} ItemMenu
 */

/**
 * Menu lateral do desktop (lg+), no estilo do protótipo "inspirado no ChatGPT":
 * fundo cinza-claro, marca no topo, atalhos (Início/Pesquisar), módulos em
 * acordeão e faixa de ícones quando recolhido.
 *
 * Recolhido, cada módulo vira um ícone e as telas aparecem num painel ao lado.
 *
 * @param {{
 *   items: ItemMenu[],
 *   currentPath: string,
 *   onNavigate: (event: React.MouseEvent, path: string) => void,
 *   collapsed: boolean,
 *   onToggle: () => void,
 *   onSearch: () => void,
 * }} props
 */
export default function DesktopSidebar({ items, currentPath, onNavigate, collapsed, onToggle, onSearch }) {
  const telasDoModulo = (item) =>
    item.submenu?.length
      ? item.submenu.filter((sub) => Boolean(sub.url))
      : item.url
        ? [{ id: item.id, title: item.title, url: item.url }]
        : [];

  const iconeDoModulo = (id) => ICONE_DO_MODULO[id] || Folder;
  const paginaAtual = (page) => currentPath === createPageUrl(page.url);

  const moduloAtualId = items.find((item) => telasDoModulo(item).some(paginaAtual))?.id || null;
  const [abertoId, setAbertoId] = React.useState(moduloAtualId);

  React.useEffect(() => {
    setAbertoId(moduloAtualId);
  }, [moduloAtualId]);

  const inicioAtivo = currentPath === createPageUrl(PAGINA_INICIAL);

  return (
    <nav
      id="app-shell-sidebar"
      aria-label="Módulos"
      data-collapsed={collapsed ? "true" : "false"}
      className={`relative hidden shrink-0 flex-col border-r border-[#e7ebe8] bg-[#f8f9f8] transition-[width] duration-300 lg:flex ${
        collapsed ? "w-[68px]" : "w-[322px]"
      }`}
    >
      {/* Marca + recolher */}
      <div className={collapsed ? "px-3.5 pb-2 pt-[19px]" : "px-[15px] pb-2 pt-[19px]"}>
        <div className={`flex h-10 min-w-0 items-center gap-2.5 ${collapsed ? "justify-center" : ""}`}>
          <span className="relative grid h-[38px] w-[38px] shrink-0 place-items-center overflow-hidden rounded-xl bg-[#163825]">
            <span className="absolute -left-2.5 -top-2.5 h-[21px] w-[21px] rounded-full bg-[#32d65e] opacity-55 blur-[13px]" aria-hidden />
            <img src="/brand/mak-gestao-simbolo.png" alt="" className="relative z-10 h-[25px] w-[25px] object-contain" />
          </span>
          {collapsed ? null : (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate text-[15px] font-bold tracking-[-0.55px] text-[#1d2923]">MAK Gestão</strong>
                <span className="mt-0.5 truncate text-[10px] tracking-[0.2px] text-[#778179]">Plataforma de gestão rural</span>
              </div>
              <button
                type="button"
                onClick={onToggle}
                aria-label="Recolher menu"
                title="Recolher menu"
                className="flex h-[33px] w-[33px] shrink-0 items-center justify-center rounded-[9px] text-[#778179] transition-colors hover:bg-[#eaeeeb] hover:text-[#1d2923]"
              >
                <PanelLeft size={19} aria-hidden />
              </button>
            </>
          )}
        </div>
        {collapsed ? (
          <div className="mt-1 flex justify-center">
            <button
              type="button"
              onClick={onToggle}
              aria-label="Expandir menu"
              title="Expandir menu"
              className="flex h-[33px] w-[33px] items-center justify-center rounded-[9px] text-[#778179] transition-colors hover:bg-[#eaeeeb] hover:text-[#1d2923]"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      {/* Atalhos */}
      <div className={`flex flex-col gap-1 border-b border-[#e7ebe8] pb-3 pt-4 ${collapsed ? "px-2.5" : "px-3"}`}>
        <Link
          to={createPageUrl(PAGINA_INICIAL)}
          onClick={(event) => onNavigate(event, createPageUrl(PAGINA_INICIAL))}
          title="Início"
          aria-current={inicioAtivo ? "page" : undefined}
          className={`${ITEM_BASE} ${inicioAtivo ? ITEM_ATIVO : "text-[#1d2923]"} ${collapsed ? "justify-center px-0" : ""}`}
        >
          <Home size={19} className={ICONE_ITEM} aria-hidden />
          {collapsed ? null : <span className="truncate text-[12.5px]">Início</span>}
        </Link>
        <button
          type="button"
          onClick={onSearch}
          title="Pesquisar telas"
          className={`${ITEM_BASE} text-[#1d2923] ${collapsed ? "justify-center px-0" : ""}`}
        >
          <Search size={19} className={ICONE_ITEM} aria-hidden />
          {collapsed ? null : (
            <>
              <span className="truncate text-[12.5px]">Pesquisar telas</span>
              <kbd className="ml-auto rounded-[5px] border border-[#e7ebe8] px-[5px] py-0.5 text-[10px] text-[#778179]">
                Ctrl K
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Módulos */}
      <div className={`flex-1 overflow-y-auto pb-6 ${collapsed ? "px-2.5 pt-3" : "px-3 pt-3.5"}`}>
        {collapsed ? null : (
          <div className="px-[11px] pb-2 pt-[11px] text-[11px] font-semibold tracking-[0.15px] text-[#778179]">Módulos</div>
        )}
        <div className={collapsed ? "flex flex-col items-center gap-2" : "flex flex-col gap-[5px]"}>
          {items.map((item) => {
            const Icon = iconeDoModulo(item.id);
            const telas = telasDoModulo(item);
            const atual = telas.some(paginaAtual);

            if (collapsed) {
              return (
                <div key={item.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      setAbertoId(item.id);
                      onToggle();
                    }}
                    aria-label={`Abrir menu ${item.title}`}
                    title={item.title}
                    className={`flex h-11 w-11 items-center justify-center rounded-[9px] transition-colors ${
                      atual ? "bg-[#e5f4e9] text-[#158b3b]" : "text-[#617167] hover:bg-[#eaeeeb] hover:text-[#1d2923]"
                    }`}
                  >
                    <Icon size={20} aria-hidden />
                  </button>
                  <div className="absolute left-full top-0 z-50 hidden pl-2 group-hover:block group-focus-within:block">
                    <div className="w-56 rounded-xl border border-[#e7ebe8] bg-white p-1.5 shadow-[0_12px_36px_rgba(18,34,21,.08)]">
                      <div className="px-[11px] pb-2 pt-2 text-[11px] font-semibold text-[#778179]">{item.title}</div>
                      {telas.map((page) => {
                        const ativo = paginaAtual(page);
                        return (
                          <Link
                            key={page.id}
                            to={createPageUrl(page.url)}
                            onClick={(event) => onNavigate(event, createPageUrl(page.url))}
                            aria-current={ativo ? "page" : undefined}
                            className={`relative flex h-[34px] items-center rounded-lg pl-[26px] pr-3 text-[12.5px] transition-colors hover:bg-[#eaeeeb] ${
                              ativo ? "font-semibold text-[#158b3b]" : "text-[#778179]"
                            }`}
                          >
                            <span
                              className={`absolute left-3.5 h-1 w-1 rounded-full ${ativo ? "bg-[#158b3b]" : "bg-current opacity-55"}`}
                              aria-hidden
                            />
                            <span className="truncate">{page.title}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            const aberto = abertoId === item.id;
            return (
              <section key={item.id}>
                <button
                  type="button"
                  onClick={() => setAbertoId(aberto ? null : item.id)}
                  aria-expanded={aberto}
                  title={item.title}
                  className={`flex h-[37px] w-full items-center gap-[11px] rounded-[9px] px-3 text-left transition-colors hover:bg-[#eaeeeb] ${
                    atual ? "font-semibold text-[#1d2923]" : "font-medium text-[#1d2923]"
                  }`}
                >
                  <Icon size={19} className={atual ? "shrink-0 text-[#158b3b]" : ICONE_ITEM} aria-hidden />
                  <span className="flex-1 truncate text-[12.7px]">{item.title}</span>
                  <ChevronDown
                    size={15}
                    className={`shrink-0 text-[#778179] transition-transform ${aberto ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>
                {aberto ? (
                  <div className="flex flex-col gap-0.5 py-1">
                    {telas.map((page) => {
                      const ativo = paginaAtual(page);
                      return (
                        <Link
                          key={page.id}
                          to={createPageUrl(page.url)}
                          onClick={(event) => onNavigate(event, createPageUrl(page.url))}
                          aria-current={ativo ? "page" : undefined}
                          className={`relative flex h-[34px] items-center rounded-lg pl-[42px] pr-3 text-[12.5px] transition-colors hover:bg-[#eaeeeb] ${
                            ativo ? "font-semibold text-[#158b3b]" : "text-[#778179]"
                          }`}
                        >
                          <span
                            className={`absolute left-[28px] h-1 w-1 rounded-full ${
                              ativo ? "bg-[#158b3b]" : "bg-current opacity-55"
                            }`}
                            aria-hidden
                          />
                          <span className="truncate">{page.title}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>

      {/* Faixa app-shell: clique/arraste na borda recolhe ou expande a barra. */}
      <button
        type="button"
        aria-controls="app-shell-sidebar"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Exibir barra lateral" : "Recolher barra lateral"}
        title={collapsed ? "Exibir barra lateral" : "Recolher barra lateral"}
        onClick={onToggle}
        className={`absolute inset-y-0 -right-1 z-20 w-2 bg-transparent outline-none transition-colors hover:bg-[#32d65e]/40 focus-visible:bg-[#32d65e]/60 ${
          collapsed ? "cursor-e-resize" : "cursor-w-resize"
        }`}
      />
    </nav>
  );
}
