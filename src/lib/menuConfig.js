export const DEFAULT_MENU = [
  { id: "dashboard", title: "Dashboard", url: "Home", icon: "Home" },
  { id: "pesagens", title: "Pesagens", url: "Pesagens", icon: "Scale" },
  { id: "custos", title: "Custos de Safra", url: "CustosSafra", icon: "TrendingUp" },
  { id: "movimentacoes", title: "Movimentacoes Estoque", url: "MovimentacoesEstoque", icon: "ArrowRightLeft" },
  {
    id: "cotacoes",
    title: "Cotacoes",
    icon: "DollarSign",
    submenu: [
      { id: "cot-produtos", title: "Cotacoes de Produtos", url: "CotacoesPecuaria" },
      { id: "cot-lotes", title: "Lotes de Animais", url: "LotesAnimaisCotacao" },
      { id: "cot-aplicacoes", title: "Aplicacoes de Medicamentos", url: "AplicacoesMedicamentos" },
      { id: "cot-simulacao", title: "Simulacao de Resultados", url: "SimulacaoResultados" },
    ],
  },
  {
    id: "pecuaria",
    title: "Pecuaria",
    icon: "Package",
    submenu: [
      { id: "pec-controle", title: "Controle de Pecuaria", url: "ControlePecuaria" },
      { id: "pec-setores", title: "Cadastro de Setores", url: "CadastroSetores" },
      { id: "pec-lotes", title: "Cadastro de Lotes", url: "CadastroLotes" },
      { id: "pec-mov-lotes", title: "Movimentações de Lotes", url: "MovimentacoesLote" },
      { id: "pec-categorias-manejo", title: "Categorias de Manejo", url: "CategoriasManejo" },
      { id: "pec-dashboard-supl", title: "Dashboard Suplementacao", url: "DashboardSuplementacao" },
      { id: "pec-historico", title: "Historico de Movimentacoes", url: "HistoricoMovimentacoesPecuaria" },
      { id: "pec-pesagens-ind", title: "Pesagens Individuais", url: "PesagensIndividuais" },
      { id: "pec-lanc-pesagens", title: "Lançar Pesagens", url: "LancamentoPesagensIndividuais" },
      { id: "pec-mapa-cadastro", title: "Mapa - Areas/Pontos/Linhas", url: "MapaCadastro" },
      { id: "pec-mapa-geral", title: "Mapa Geral - Manejo", url: "MapaGeral" },
      { id: "pec-relatorio", title: "Relatorio Suplementacao", url: "RelatorioSuplementacao" },
    ],
  },
  {
    id: "maquinas",
    title: "Maquinas",
    icon: "Package",
    submenu: [
      { id: "maq-cadastro", title: "Cadastro de Maquinas", url: "CadastroMaquinas" },
      { id: "maq-operacoes", title: "Operacoes Agricolas", url: "OperacoesAgricolas" },
      { id: "maq-controle-areas", title: "Controle de Areas", url: "ControleAreas" },
      { id: "maq-ficha", title: "Ficha do Operador", url: "FichaOperador" },
      { id: "maq-ficha-impressao", title: "Imprimir Fichas", url: "FichaOperadorImpressao" },
      { id: "maq-ficha-combustivel", title: "Ficha Controle Combustível", url: "FichaControleCombustivel" },
    ],
  },
  {
    id: "gestao-tarefas",
    title: "Gestão de Tarefas",
    icon: "FolderOpen",
    submenu: [
      { id: "gt-grupos", title: "Grupos de Atividades", url: "GruposAtividades" },
      { id: "gt-tipos", title: "Tipos de Tarefa", url: "TiposTarefa" },
      { id: "gt-lancamentos", title: "Lançamentos", url: "LancamentosTarefas" },
    ],
  },
  {
    id: "financeiro",
    title: "Financeiro",
    icon: "DollarSign",
    submenu: [
      { id: "fin-lancamento", title: "Lancamento Financeiro", url: "LancamentoFinanceiro" },
      { id: "fin-caixa-bancos", title: "Caixa & Bancos", url: "CaixaBancos" },
      { id: "fin-plano", title: "Plano de Contas", url: "PlanoContas" },
      { id: "fin-formas", title: "Formas de Pagamento", url: "FormasPagamento" },
      { id: "fin-grupos", title: "Grupos Financeiros", url: "GruposFinanceiros" },
      { id: "fin-fluxo", title: "Fluxo de Caixa", url: "FluxoCaixa" },
      { id: "fin-livro-caixa", title: "Livro-Caixa", url: "LivroCaixa" },
    ],
  },
  {
    id: "fiscal",
    title: "Fiscal",
    icon: "BookOpen",
    submenu: [
      { id: "fiscal-livros", title: "Livros Fiscais", url: "LivrosFiscais" },
    ],
  },
  {
    id: "cadastros",
    title: "Cadastros",
    icon: "FolderOpen",
    submenu: [
      { id: "cad-empresa", title: "Empresa", url: "Empresa" },
      { id: "cad-mapa", title: "Mapa - Areas/Pontos/Linhas", url: "MapaCadastro" },
      { id: "cad-safras", title: "Safras", url: "GerenciarSafras" },
      { id: "cad-fornecedores", title: "Fornecedores/Clientes", url: "Fornecedores" },
      { id: "cad-produtos", title: "Produtos", url: "Produtos" },
      { id: "cad-ativos", title: "Ativos Fixos", url: "AtivosFixos" },
      { id: "cad-cidades", title: "Cidades", url: "GerenciarCidades" },
      { id: "cad-unidades", title: "Unidades de Medida", url: "UnidadesMedida" },
      { id: "cad-categorias", title: "Categorias", url: "Categorias" },
      { id: "cad-locais", title: "Locais de Estoque", url: "LocaisEstoque" },
      { id: "cad-centros", title: "Centros de Custo", url: "CentrosCusto" },
    ],
  },
  {
    id: "relatorios",
    title: "Relatorios",
    icon: "FileText",
    submenu: [
      { id: "rel-estoque", title: "Estoque", url: "RelatoriosEstoque" },
      { id: "rel-pesagens", title: "Pesagens", url: "RelatorioPesagens" },
      { id: "rel-custos-safra", title: "Custos Safra", url: "RelatorioCustosSafra" },
      { id: "rel-entregas", title: "Historico Entregas", url: "RelatorioHistoricoEntregas" },
      { id: "rel-financeiro", title: "Financeiro", url: "RelatorioFinanceiro" },
      { id: "rel-fornecedores", title: "Fornecedores", url: "RelatorioFornecedores" },
      { id: "rel-produtos", title: "Produtos", url: "RelatorioProdutos" },
      { id: "rel-suplementacao", title: "Suplementacao", url: "RelatorioSuplementacao" },
      { id: "rel-movimentacoes-pecuaria", title: "Movimentacoes Pecuaria", url: "RelatorioMovimentacoesPecuaria" },
      { id: "rel-pesagens-ind", title: "Pesagens Individuais", url: "RelatorioPesagensIndividuais" },
      { id: "rel-fichas", title: "Fichas Personalizadas", url: "FichasPersonalizadas" },
      { id: "rel-mapa-pastos", title: "Mapa de Pastos", url: "RelatorioMapaPastos" },
      { id: "rel-pecuaria-lotacao", title: "Lotação Pecuária", url: "RelatorioPecuariaLotacao" },
      { id: "rel-gestao-tarefas", title: "Gestão de Tarefas", url: "RelatorioGestaoTarefas" }
    ],
  },
  { id: "usuarios", title: "Usuarios", url: "Usuarios", icon: "Shield" },
  { id: "editor-visual", title: "Editor Visual", url: "EditorVisualSistema", icon: "Settings" },
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