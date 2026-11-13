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
      { id: "sup-tipos-atividade", title: "Tipos de Atividade", url: "TiposAtividade" },
      // D-PROD-184 — a EXECUÇÃO de um Tipo de Atividade, logo abaixo do cadastro dos tipos.
      { id: "op-apontamentos-atividade", title: "Apontamentos de Atividade", url: "ApontamentosAtividade" },
      { id: "sup-grupos-atividades", title: "Grupos de Atividades", url: "GruposAtividades" },
    ],
  },
  {
    // D-PROD-146 — Gestão Rural P1: só cadastros (sem financeiro, lançamento ou estoque).
    id: "gestao-rural",
    title: "Gestão Rural",
    icon: "Briefcase",
    submenu: [
      { id: "ges-parceiros", title: "Parceiros", url: "Parceiros" },
      { id: "ges-centros-custo", title: "Centros de Custo", url: "CentrosCusto" },
      { id: "ges-centros-resultado", title: "Centros de Resultado", url: "CentrosResultado" },
      // D-PROD-153 — Gestão Rural P2: catálogo gerencial (não é plano de contas nem lançamento).
      { id: "ges-naturezas-financeiras", title: "Naturezas Financeiras", url: "NaturezasFinanceiras" },
      // D-PROD-155 — Gestão Rural P3-01: Central Única de Lançamentos (documento gerencial nativo).
      { id: "ges-lancamentos-financeiros", title: "Lançamentos Financeiros", url: "LancamentosFinanceiros" },
    ],
  },
  {
    // D-PROD-157 — Patrimônio e Frota P1-01: cadastros e inventário. Catálogos são do tenant; bens, da empresa.
    // D-PROD-159 — P1-02: abastecimentos e consumo da frota (sem manutenção nem financeiro).
    // D-PROD-162 — só Bens Patrimoniais (famílias, tipos e os Produtos aceitos pelos tanques
    // ficam DENTRO do cadastro do bem) e Abastecimentos (baixa exata na unidade do Produto, L ou KG).
    // D-PROD-169 — sem família na tela ("Tipo de bem" + Tipo); Produtos aceitos em L, KG ou SACO (SACO abastece em kg).
    id: "patrimonio",
    title: "Patrimônio e Frota",
    icon: "Truck",
    submenu: [
      { id: "pat-bens-patrimoniais", title: "Bens Patrimoniais", url: "BensPatrimoniais" },
      { id: "pat-abastecimentos", title: "Abastecimentos", url: "Abastecimentos" },
    ],
  },
  {
    id: "administracao",
    title: "Administração",
    icon: "Shield",
    submenu: [
      { id: "adm-empresa", title: "Empresa", url: "Empresa" },
      { id: "adm-usuarios", title: "Usuários", url: "Usuarios" },
      { id: "adm-permissoes", title: "Permissões", url: "Permissoes" },
      { id: "adm-configuracoes", title: "Configurações Gerais", url: "ConfiguracoesGerais" },
    ],
  },
];

/**
 * Telas que só o administrador da fazenda vê no menu e abre (D-PROD-77). O
 * backend já recusa as ações (403); aqui elas nem aparecem para os demais.
 */
export const PAGINAS_SO_ADMINISTRADOR = Object.freeze(['adm-usuarios', 'adm-permissoes', 'adm-configuracoes']);

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
