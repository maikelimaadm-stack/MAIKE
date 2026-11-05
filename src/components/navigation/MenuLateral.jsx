import React from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Building2, ChevronDown, Folder, LogOut, Search, SlidersHorizontal, X } from "lucide-react";
import { createPageUrl } from "@/utils";
import { flattenMenuPages } from "@/lib/menuConfig";
import { ICONE_MODULO, ICONE_TELA } from "@/components/navigation/MobileModulesView";

/**
 * Menu lateral do Mapa Geral (D-PROD-131): o mapa é a tela de entrada e, no
 * lugar do antigo ✕, o ☰ abre esta gaveta — módulos e telas, troca de
 * fazenda, busca e usuário. Mesma gaveta no celular, no tablet e no computador.
 *
 * Fecha pelo ✕, pelo fundo escuro, pelo Esc e pelo deslizar da borda
 * (`useDeslizarParaFechar` manda Esc ao diálogo aberto de cima).
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   menuItems: Array<{ id: string, title: string, url?: string, submenu?: Array<any> }>,
 *   paginaAtualUrl: string | null,
 *   empresaNome: string,
 *   onTrocarEmpresa?: (() => void) | null,
 *   usuario?: { full_name?: string, email?: string } | null,
 *   mostrarConfiguracoes?: boolean,
 *   onSair: () => void,
 *   onAbrirTela: (event: React.MouseEvent, url: string) => void,
 * }} props
 */
export default function MenuLateral({ open, onClose, menuItems, paginaAtualUrl, empresaNome, onTrocarEmpresa, usuario, mostrarConfiguracoes, onSair, onAbrirTela }) {
  const [busca, setBusca] = React.useState("");
  const [fechados, setFechados] = React.useState(() => new Set());
  const painelRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));

  React.useEffect(() => {
    if (!open) {
      setBusca("");
      return undefined;
    }
    const anterior = /** @type {HTMLElement | null} */ (document.activeElement);
    painelRef.current?.focus({ preventScroll: true });
    return () => anterior?.focus?.({ preventScroll: true });
  }, [open]);

  const modulos = React.useMemo(
    () =>
      menuItems.map((item) => ({
        id: item.id,
        title: item.title,
        pages: flattenMenuPages(/** @type {any} */ (item.submenu?.length ? item.submenu : [item])),
      })),
    [menuItems],
  );

  if (!open || typeof document === "undefined") return null;

  const termo = busca.trim().toLowerCase();
  const visiveis = modulos
    .map((m) => ({ ...m, pages: termo ? m.pages.filter((p) => p.title.toLowerCase().includes(termo)) : m.pages }))
    .filter((m) => m.pages.length > 0);

  const alternar = (id) =>
    setFechados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const nome = usuario?.full_name || "Usuário";

  return createPortal(
    <div className="mk-menu-lat" data-state="open">
      <div className="mk-menu-lat__fundo" onClick={onClose} aria-hidden />
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        data-state="open"
        tabIndex={-1}
        className="mk-menu-lat__painel"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="mk-menu-lat__topo">
          <img src="/brand/mak-gestao-icon-192.png" alt="" className="mk-menu-lat__logo" />
          <div className="mk-menu-lat__marca">
            <span className="mk-menu-lat__produto">MAK Gestão</span>
            <span className="mk-menu-lat__desc">Mapa Geral e Manejo</span>
          </div>
          <button type="button" className="mk-menu-lat__fechar" onClick={onClose} aria-label="Fechar menu" title="Fechar menu">
            <X size={18} aria-hidden />
          </button>
        </div>

        {onTrocarEmpresa ? (
          <button
            type="button"
            className="mk-menu-lat__fazenda"
            onClick={() => {
              onClose();
              onTrocarEmpresa();
            }}
            aria-label="Trocar empresa"
          >
            <span className="mk-menu-lat__fazenda-ic" aria-hidden>
              <Building2 size={16} />
            </span>
            <span className="mk-menu-lat__fazenda-txt">
              <span className="mk-menu-lat__rotulo">Fazenda</span>
              <span className="mk-menu-lat__fazenda-nome">{empresaNome}</span>
            </span>
            <ChevronDown size={16} aria-hidden />
          </button>
        ) : null}

        <label className="mk-menu-lat__busca">
          <Search size={16} aria-hidden />
          <input
            type="text"
            inputMode="search"
            autoComplete="off"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar tela"
            aria-label="Buscar tela"
          />
          {busca ? (
            <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca">
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </label>

        <nav className="mk-menu-lat__lista" aria-label="Módulos e telas">
          {visiveis.map((m) => {
            const IconeModulo = ICONE_MODULO[m.id] || Folder;
            const aberto = Boolean(termo) || !fechados.has(m.id);
            return (
              <section key={m.id} className="mk-menu-lat__grupo">
                <button type="button" className="mk-menu-lat__modulo" aria-expanded={aberto} onClick={() => alternar(m.id)}>
                  <IconeModulo size={15} aria-hidden />
                  <span>{m.title}</span>
                  <ChevronDown size={14} aria-hidden className={aberto ? "" : "-rotate-90"} />
                </button>
                {aberto
                  ? m.pages.map((p) => {
                      const Icone = ICONE_TELA[p.url] || Folder;
                      const atual = p.url === paginaAtualUrl;
                      return (
                        <Link
                          key={p.id}
                          to={createPageUrl(p.url)}
                          aria-current={atual ? "page" : undefined}
                          className={`mk-menu-lat__tela${atual ? " is-atual" : ""}`}
                          onClick={(e) => {
                            onAbrirTela(e, p.url);
                            onClose();
                          }}
                        >
                          <Icone size={16} aria-hidden />
                          <span>{p.title}</span>
                        </Link>
                      );
                    })
                  : null}
              </section>
            );
          })}
          {!visiveis.length ? <p className="mk-menu-lat__vazio">Nenhuma tela encontrada.</p> : null}
        </nav>

        <div className="mk-menu-lat__rodape">
          <span className="mk-menu-lat__avatar" aria-hidden>
            {nome.charAt(0).toUpperCase()}
          </span>
          <span className="mk-menu-lat__usuario">
            <span className="mk-menu-lat__usuario-nome">{nome}</span>
            {usuario?.email ? <span className="mk-menu-lat__usuario-email">{usuario.email}</span> : null}
          </span>
          {mostrarConfiguracoes ? (
            <Link
              to={createPageUrl("ConfiguracoesGerais")}
              className="mk-menu-lat__acao"
              aria-label="Configurações Gerais"
              title="Configurações Gerais"
              onClick={(e) => {
                onAbrirTela(e, "ConfiguracoesGerais");
                onClose();
              }}
            >
              <SlidersHorizontal size={16} aria-hidden />
            </Link>
          ) : null}
          <button type="button" className="mk-menu-lat__acao mk-menu-lat__acao--sair" onClick={onSair} aria-label="Sair" title="Sair">
            <LogOut size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
