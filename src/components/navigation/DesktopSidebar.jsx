import React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Folder, Home, PanelLeft, PanelRight, Search } from "lucide-react";
import { createPageUrl } from "@/utils";
import { ICONE_MODULO } from "@/components/navigation/MobileModulesView";
import SidebarTooltip from "@/components/navigation/SidebarTooltip";

/** Ícone de cada módulo — o mesmo mapa da tela de Módulos do celular. */
const ICONE_DO_MODULO = /** @type {Record<string, React.ComponentType<any>>} */ (ICONE_MODULO);

const PAGINA_INICIAL = "MapaGeral";

/**
 * Classes compartilhadas dos itens da barra, com a paleta do sistema
 * (superfície branca, tinta #292a2d, cinza #64748b e verde #16a34a).
 */
const ITEM_BASE =
  "flex h-[38px] w-full items-center gap-[11px] rounded-[9px] px-3 text-left whitespace-nowrap transition-colors hover:bg-[var(--mk-btn-ativo)]";
const ITEM_ATIVO = "bg-[rgba(64,222,99,0.14)] font-semibold text-[#16a34a]";
const ICONE_ITEM = "h-[19px] w-[19px] shrink-0 text-[#64748b]";

/**
 * @typedef {{ id: string, title: string, url?: string }} PaginaMenu
 * @typedef {{ id: string, title: string, url?: string, submenu?: PaginaMenu[] }} ItemMenu
 */

/**
 * Menu lateral do desktop (lg+), no estilo do protótipo "inspirado no ChatGPT":
 * marca no topo, atalhos, módulos em acordeão e faixa de ícones quando recolhido.
 *
 * Dois modos de abertura ao clicar no topo:
 * - a logo (ícone) abre o menu completo sobre a página, sem mover o conteúdo, e
 *   clicar fora fecha de volta para a faixa de ícones;
 * - o botão de recolher/expandir fixa o estado — fica aberto até ser recolhido.
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
  // Recolhido: a logo mostra o ícone de expandir enquanto o mouse (ou foco) está nela.
  const [marcaEmHover, setMarcaEmHover] = React.useState(false);

  const expandido = !collapsed;

  // Ao recolher/expandir, a marca volta a mostrar a logo (sem herdar o hover anterior).
  React.useEffect(() => {
    setMarcaEmHover(false);
  }, [collapsed]);

  // Menu aberto a partir do ícone do módulo (barra recolhida): a seleção de uma
  // tela fecha o menu de novo. Aberto pelo botão, ele fica aberto.
  const [abertoPeloModulo, setAbertoPeloModulo] = React.useState(false);

  const alternar = () => {
    setAbertoPeloModulo(false);
    onToggle();
  };

  const navegar = (event, path) => {
    onNavigate(event, path);
    if (abertoPeloModulo) {
      setAbertoPeloModulo(false);
      if (!collapsed) onToggle();
    }
  };

  const pesquisar = () => {
    onSearch();
  };

  return (
    <>
      <div
        className={`hidden shrink-0 transition-[width] duration-300 lg:block ${
          collapsed ? "w-[68px]" : "w-[322px]"
        }`}
      >
        <nav
          id="app-shell-sidebar"
          aria-label="Módulos"
          data-collapsed={expandido ? "false" : "true"}
          className={`flex h-full flex-col border-r border-[#f1f3f5] bg-[var(--mk-sup-cartao)] ${
            expandido ? "w-[322px]" : "w-[68px]"
          } relative`}
        >
          {/* Marca: recolhido, a logo vira o botão de expandir ao passar o mouse. */}
          <div className={expandido ? "px-3 pb-2 pt-[19px]" : "px-3.5 pb-2 pt-[19px]"}>
            {expandido ? (
              <div className="flex h-10 items-center gap-2">
                <span className="grid h-[38px] w-[38px] shrink-0 place-items-center">
                  <img src="/brand/mak-gestao-simbolo.png" alt="" className="h-[32px] w-[32px] object-contain" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <strong className="truncate text-[15px] font-bold tracking-[-0.55px] text-[#292a2d]">MAK Gestão</strong>
                  <span className="mt-0.5 truncate text-[10px] tracking-[0.2px] text-[#64748b]">Plataforma de gestão rural</span>
                </div>
                <button
                  type="button"
                  onClick={pesquisar}
                  aria-label="Pesquisar telas"
                  title="Pesquisar telas (Ctrl K)"
                  className="flex h-[33px] w-[33px] shrink-0 items-center justify-center rounded-[9px] text-[#64748b] transition-colors hover:bg-[var(--mk-btn-ativo)] hover:text-[#292a2d]"
                >
                  <Search size={19} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={alternar}
                  aria-label="Ocultar menu principal"
                  title="Ocultar menu principal"
                  className="flex h-[33px] w-[33px] shrink-0 items-center justify-center rounded-[9px] text-[#64748b] transition-colors hover:bg-[var(--mk-btn-ativo)] hover:text-[#292a2d]"
                >
                  <PanelLeft size={19} aria-hidden />
                </button>
              </div>
            ) : (
              <div className="flex justify-center">
                <SidebarTooltip label="Alternar barra lateral" atalhos={["Ctrl", "Shift", "S"]}>
                  <button
                    type="button"
                    onClick={alternar}
                    onMouseMove={() => setMarcaEmHover(true)}
                    onMouseLeave={() => setMarcaEmHover(false)}
                    onFocus={() => setMarcaEmHover(true)}
                    onBlur={() => setMarcaEmHover(false)}
                    aria-label="Mostrar menu principal"
                    className="relative grid h-[38px] w-[38px] place-items-center rounded-xl text-[#64748b] transition-colors hover:bg-[var(--mk-btn-ativo)] hover:text-[#292a2d]"
                  >
                    <img
                      src="/brand/mak-gestao-simbolo.png"
                      alt=""
                      className={`h-[32px] w-[32px] object-contain transition-opacity duration-150 ${
                        marcaEmHover ? "opacity-0" : "opacity-100"
                      }`}
                    />
                    <span
                      className={`pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-150 ${
                        marcaEmHover ? "opacity-100" : "opacity-0"
                      }`}
                      aria-hidden
                    >
                      <PanelRight size={20} />
                    </span>
                  </button>
                </SidebarTooltip>
              </div>
            )}
          </div>

          {/* Atalhos */}
          <div className={`flex flex-col gap-1 border-b border-[var(--mk-sup-borda)] pb-3 pt-4 ${expandido ? "px-3" : "px-2.5"}`}>
            {expandido ? null : (
              <SidebarTooltip label="Pesquisar telas" atalhos={["Ctrl", "K"]}>
                <button
                  type="button"
                  onClick={pesquisar}
                  aria-label="Pesquisar telas"
                  className={`${ITEM_BASE} justify-center px-0 text-[#292a2d]`}
                >
                  <Search size={19} className={ICONE_ITEM} aria-hidden />
                </button>
              </SidebarTooltip>
            )}
            <SidebarTooltip label="Início" ativo={!expandido}>
              <Link
                to={createPageUrl(PAGINA_INICIAL)}
                onClick={(event) => navegar(event, createPageUrl(PAGINA_INICIAL))}
                aria-current={inicioAtivo ? "page" : undefined}
                aria-label={expandido ? undefined : "Início"}
                className={`${ITEM_BASE} ${inicioAtivo ? ITEM_ATIVO : "text-[#292a2d]"} ${expandido ? "" : "justify-center px-0"}`}
              >
                <Home size={19} className={inicioAtivo ? "shrink-0 text-[#16a34a]" : ICONE_ITEM} aria-hidden />
                {expandido ? <span className="truncate text-[12.5px]">Início</span> : null}
              </Link>
            </SidebarTooltip>
          </div>

          {/* Módulos */}
          <div className={`flex-1 overflow-y-auto pb-6 ${expandido ? "px-3 pt-3.5" : "px-2.5 pt-3"}`}>
            {expandido ? (
              <div className="px-[11px] pb-2 pt-[11px] text-[11px] font-semibold tracking-[0.15px] text-[#64748b]">Módulos</div>
            ) : null}
            <div className={expandido ? "flex flex-col gap-[5px]" : "flex flex-col items-center gap-2"}>
              {items.map((item) => {
                const Icon = iconeDoModulo(item.id);
                const telas = telasDoModulo(item);
                const atual = telas.some(paginaAtual);

                if (!expandido) {
                  return (
                    <SidebarTooltip key={item.id} label={item.title}>
                      <button
                        type="button"
                        onClick={() => {
                          setAbertoId(item.id);
                          setAbertoPeloModulo(true);
                          onToggle();
                        }}
                        aria-label={`Abrir menu ${item.title}`}
                        className={`flex h-11 w-11 items-center justify-center rounded-[9px] transition-colors ${
                          atual
                            ? "bg-[rgba(64,222,99,0.14)] text-[#16a34a]"
                            : "text-[#64748b] hover:bg-[var(--mk-btn-ativo)] hover:text-[#292a2d]"
                        }`}
                      >
                        <Icon size={20} aria-hidden />
                      </button>
                    </SidebarTooltip>
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
                      className={`flex h-[37px] w-full items-center gap-[11px] rounded-[9px] px-3 text-left text-[#292a2d] transition-colors hover:bg-[var(--mk-btn-ativo)] ${
                        atual ? "font-semibold" : "font-medium"
                      }`}
                    >
                      <Icon size={19} className={atual ? "shrink-0 text-[#16a34a]" : ICONE_ITEM} aria-hidden />
                      <span className="flex-1 truncate text-[12.7px]">{item.title}</span>
                      <ChevronDown
                        size={15}
                        className={`shrink-0 text-[#64748b] transition-transform ${aberto ? "rotate-180" : ""}`}
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
                              onClick={(event) => navegar(event, createPageUrl(page.url))}
                              aria-current={ativo ? "page" : undefined}
                              className={`relative flex h-[34px] items-center rounded-lg pl-[42px] pr-3 text-[12.5px] transition-colors hover:bg-[var(--mk-btn-ativo)] ${
                                ativo ? "font-semibold text-[#16a34a]" : "text-[#64748b]"
                              }`}
                            >
                              <span
                                className={`absolute left-[28px] h-1 w-1 rounded-full ${
                                  ativo ? "bg-[#16a34a]" : "bg-current opacity-55"
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
            onClick={alternar}
            className={`absolute inset-y-0 -right-1 z-20 w-2 bg-transparent outline-none transition-colors hover:bg-[#32d65e]/40 focus-visible:bg-[#32d65e]/60 ${
              collapsed ? "cursor-e-resize" : "cursor-w-resize"
            }`}
          />
        </nav>
      </div>
    </>
  );
}
