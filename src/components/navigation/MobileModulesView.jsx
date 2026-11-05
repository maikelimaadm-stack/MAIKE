import React from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  ChevronRight,
  Droplet,
  Folder,
  Layers,
  LayoutGrid,
  ListChecks,
  Map,
  Package,
  Pen,
  Ruler,
  Search,
  Shield,
  SlidersHorizontal,
  Tag,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { flattenMenuPages } from "@/lib/menuConfig";

/** Ícone de cada módulo (id do `menuConfig`). */
export const ICONE_MODULO = { mapa: Map, manejo: LayoutGrid, "suporte-mapa": Package, administracao: Shield };

/** Ícone de cada tela (url do `menuConfig`). */
const ICONE_TELA = {
  MapaGeral: Map,
  MapaCadastro: Pen,
  CadastroLotes: LayoutGrid,
  CadastroSetores: Layers,
  CategoriasManejo: Tag,
  Bebedouros: Droplet,
  Produtos: Package,
  Categorias: Tag,
  Marcas: Tag,
  UnidadesMedida: Ruler,
  LocaisEstoque: Warehouse,
  TiposTarefa: ListChecks,
  GruposAtividades: Folder,
  Empresa: Building2,
  Usuarios: Users,
  Permissoes: Shield,
  ConfiguracoesGerais: SlidersHorizontal,
};

const contarTelas = (n) => `${n} ${n === 1 ? "tela" : "telas"}`;

/**
 * Tela de Módulos do celular — aberta pela aba "Módulos" da barra inferior ou
 * pelo voltar de uma tela. Grade com os módulos; ao tocar, as telas do módulo.
 *
 * @param {{
 *   menuItems: Array<{ id: string, title: string, submenu?: Array<{ id: string, title: string, url?: string }> }>,
 *   moduloId: string | null,
 *   onModulo: (id: string | null) => void,
 *   moduloAtualId: string | null,
 *   paginaAtualUrl: string | null,
 *   onAbrirTela: (event: React.MouseEvent, url: string) => void,
 * }} props
 */
export default function MobileModulesView({ menuItems, moduloId, onModulo, moduloAtualId, paginaAtualUrl, onAbrirTela }) {
  const [busca, setBusca] = React.useState("");
  const termo = busca.trim().toLowerCase();

  const modulos = React.useMemo(
    () =>
      menuItems.map((item) => ({
        id: item.id,
        title: item.title,
        pages: flattenMenuPages(/** @type {any} */ (item.submenu?.length ? item.submenu : [item])),
      })),
    [menuItems],
  );

  const modulo = moduloId ? modulos.find((m) => m.id === moduloId) || null : null;
  const resultados = termo
    ? modulos.flatMap((m) =>
        m.pages.filter((p) => p.title.toLowerCase().includes(termo)).map((p) => ({ ...p, moduleTitle: m.title })),
      )
    : [];

  const linhaTela = (page, sub = null) => {
    const Icon = ICONE_TELA[page.url] || Folder;
    const aberta = page.url === paginaAtualUrl;
    return (
      <Link
        key={page.id}
        to={createPageUrl(page.url)}
        onClick={(event) => onAbrirTela(event, page.url)}
        aria-current={aberta ? "page" : undefined}
        className="mk-mods__row"
      >
        <span className="mk-mods__row-icon" aria-hidden>
          <Icon size={16} />
        </span>
        <span className="mk-mods__row-label">
          {page.title}
          {sub ? <span className="mk-mods__row-sub">{sub}</span> : null}
        </span>
        {aberta ? <span className="mk-mods__open">Aberta</span> : null}
        <span className="mk-mods__chev" aria-hidden>
          <ChevronRight size={15} />
        </span>
      </Link>
    );
  };

  return (
    <div className="mk-mods lg:hidden" role="dialog" aria-label="Módulos">
      <div className="mk-mods__inner">
        <div className="mk-pill" role="search">
          {busca ? (
            <button type="button" className="mk-pill__clear" aria-label="Limpar busca" onClick={() => setBusca("")}>
              <X size={16} />
            </button>
          ) : (
            <span className="mk-pill__icon" aria-hidden>
              <Search size={16} />
            </span>
          )}
          <input
            type="text"
            inputMode="search"
            autoComplete="off"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar tela"
            aria-label="Buscar tela"
          />
        </div>

        {termo ? (
          <div className="mk-mods__list">
            {resultados.map((page) => linhaTela(page, page.moduleTitle))}
            {!resultados.length ? <div className="mk-mods__empty">Nenhuma tela encontrada.</div> : null}
          </div>
        ) : modulo ? (
          <>
            <div className="mk-mods__head">
              <span className="mk-mods__badge" aria-hidden>
                {React.createElement(ICONE_MODULO[modulo.id] || Folder, { size: 19 })}
              </span>
              <div className="min-w-0 flex-1">
                <div className="mk-mods__head-eyebrow">Módulo</div>
                <div className="mk-mods__head-name">{modulo.title}</div>
              </div>
              <span className="mk-mods__count">{contarTelas(modulo.pages.length)}</span>
            </div>
            <div className="mk-mods__list">{modulo.pages.map((page) => linhaTela(page))}</div>
          </>
        ) : (
          <>
            <div className="mk-mods__grid">
              {modulos.map((m) => {
                const Icon = ICONE_MODULO[m.id] || Folder;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`mk-mods__tile${m.id === moduloAtualId ? " is-current" : ""}`}
                    onClick={() => onModulo(m.id)}
                  >
                    <span className="mk-mods__badge" aria-hidden>
                      <Icon size={19} />
                    </span>
                    <span className="mk-mods__tile-name">{m.title}</span>
                    <span className="mk-mods__tile-count">{contarTelas(m.pages.length)}</span>
                  </button>
                );
              })}
            </div>
            <div className="mk-mods__hint">Toque no módulo para ver as telas dele.</div>
          </>
        )}
      </div>
    </div>
  );
}
