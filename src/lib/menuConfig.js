/**
 * menuConfig.js — SSOT de navegação do produto.
 *
 * Escopo: Pecuária — Mapa Geral + Manejo. Toda `url` aqui precisa existir em
 * `allowedPages` de `config/mapa-manejo-scope.json` (gate:product-scope).
 */
export const DEFAULT_MENU = [
  {
    id: "mapa",
    title: "Mapa",
    icon: "Map",
    submenu: [
      { id: "pec-mapa-geral", title: "Mapa Geral", url: "MapaGeral" },
      { id: "pec-mapa-cadastro", title: "Cadastro do Mapa", url: "MapaCadastro" },
    ],
  },
  {
    id: "manejo",
    title: "Manejo",
    icon: "Package",
    submenu: [
      { id: "pec-lotes", title: "Lotes", url: "CadastroLotes" },
      { id: "pec-setores", title: "Setores", url: "CadastroSetores" },
      { id: "pec-categorias-manejo", title: "Categorias de Manejo", url: "CategoriasManejo" },
      { id: "pec-bebedouros", title: "Bebedouros", url: "Bebedouros" },
    ],
  },
  {
    id: "suporte-mapa",
    title: "Suporte do Mapa",
    icon: "FolderOpen",
    submenu: [
      { id: "sup-produtos", title: "Produtos", url: "Produtos" },
      { id: "sup-categorias", title: "Categorias de Produto", url: "Categorias" },
      { id: "sup-marcas", title: "Marcas", url: "Marcas" },
      { id: "sup-unidades", title: "Unidades de Medida", url: "UnidadesMedida" },
      { id: "sup-locais", title: "Locais de Estoque", url: "LocaisEstoque" },
      { id: "sup-tipos-tarefa", title: "Tipos de Tarefa", url: "TiposTarefa" },
      { id: "sup-grupos-atividades", title: "Grupos de Atividades", url: "GruposAtividades" },
    ],
  },
  {
    id: "administracao",
    title: "Administração",
    icon: "Shield",
    submenu: [
      { id: "adm-empresa", title: "Empresa", url: "Empresa" },
      { id: "adm-usuarios", title: "Usuários e Permissões", url: "Usuarios" },
      { id: "adm-configuracoes", title: "Configurações Gerais", url: "ConfiguracoesGerais" },
    ],
  },
];

export const flattenMenuPages = (menuItems = DEFAULT_MENU) => {
  const pages = [];

  const traverse = (items, parentModule = null) => {
    items.forEach((item) => {
      const moduleRef = parentModule || { id: item.id, title: item.title, icon: item.icon };

      if (item.url) {
        pages.push({
          id: item.id,
          title: item.title,
          url: item.url,
          icon: item.icon || moduleRef.icon,
          moduleId: moduleRef.id,
          moduleTitle: moduleRef.title,
        });
      }

      if (item.submenu?.length) {
        traverse(item.submenu, { id: item.id, title: item.title, icon: item.icon });
      }
    });
  };

  traverse(menuItems);
  return pages;
};

export const getAllPages = (menuItems = DEFAULT_MENU) =>
  flattenMenuPages(menuItems).map((page) => ({
    id: page.id,
    title: page.title,
    url: page.url,
    categoria: page.moduleTitle || "Geral",
  }));

export const findMenuItemByUrl = (menuItems = DEFAULT_MENU, url = "") =>
  flattenMenuPages(menuItems).find((item) => item.url === url);

export const getMenuModules = (menuItems = DEFAULT_MENU) =>
  menuItems.map((item) => ({
    id: item.id,
    title: item.title,
    icon: item.icon,
    pages: flattenMenuPages(item.submenu?.length ? item.submenu : [item]).map((page) => ({
      ...page,
      moduleId: item.id,
      moduleTitle: item.title,
      icon: page.icon || item.icon,
    })),
  }));
