export const SYSTEM_MENU = [
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
      { id: "cot-simulacao", title: "Simulacao de Resultados", url: "SimulacaoResultados" }
    ]
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
      { id: "pec-relatorio", title: "Relatorio Suplementacao", url: "RelatorioSuplementacao" }
    ]
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
      { id: "maq-ficha-combustivel", title: "Ficha Controle Combustível", url: "FichaControleCombustivel" }
    ]
  },
  {
    id: "gestao-tarefas",
    title: "Gestão de Tarefas",
    icon: "FolderOpen",
    submenu: [
      { id: "gt-grupos", title: "Grupos de Atividades", url: "GruposAtividades" },
      { id: "gt-tipos", title: "Tipos de Tarefa", url: "TiposTarefa" },
      { id: "gt-lancamentos", title: "Lançamentos", url: "LancamentosTarefas" }
    ]
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
      { id: "fin-livro-caixa", title: "Livro-Caixa", url: "LivroCaixa" }
    ]
  },
  {
    id: "fiscal",
    title: "Fiscal",
    icon: "BookOpen",
    submenu: [
      { id: "fiscal-livros", title: "Livros Fiscais", url: "LivrosFiscais" }
    ]
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
      { id: "cad-centros", title: "Centros de Custo", url: "CentrosCusto" }
    ]
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
    ]
  },
  { id: "usuarios", title: "Usuarios", url: "Usuarios", icon: "Shield" },
  { id: "editor-visual", title: "Editor Visual", url: "EditorVisualSistema", icon: "Settings" }
];

export const EXTRA_PERMISSION_PAGES = [
  { id: "configuracoes-gerais", title: "Configurações Gerais", url: "ConfiguracoesGerais", icon: "Settings", categoria: "Sistema" }
];

export const ACTION_OPTIONS = [
  { id: "view", title: "Visualizar" },
  { id: "create", title: "Criar" },
  { id: "edit", title: "Editar" },
  { id: "delete", title: "Excluir" },
  { id: "export", title: "Exportar" }
];

export const DEFAULT_MOBILE_MENU_ITEMS = ["Home", "Pesagens", "LancamentoFinanceiro", "RelatoriosEstoque"];

export const MODULE_OPTIONS = SYSTEM_MENU.map((item) => ({
  id: item.id,
  title: item.title,
  icon: item.icon
}));

const flatPages = [];

const walkMenu = (items, categoria = "Geral", parentIcon = "Home", parentId = null) => {
  items.forEach((item) => {
    const currentIcon = item.icon || parentIcon;
    const currentCategoria = parentId ? categoria : item.title;

    if (item.url) {
      flatPages.push({
        id: item.id,
        title: item.title,
        url: item.url,
        icon: currentIcon,
        categoria: parentId ? categoria : "Principal",
        moduleId: parentId || item.id
      });
    }

    if (item.submenu) {
      walkMenu(item.submenu, item.title, currentIcon, item.id);
    }
  });
};

walkMenu(SYSTEM_MENU);

export const PAGE_OPTIONS = [
  ...flatPages,
  ...EXTRA_PERMISSION_PAGES.map((page) => ({
    ...page,
    moduleId: page.id
  }))
];

export const MOBILE_SHORTCUT_OPTIONS = PAGE_OPTIONS.filter((page) => page.url !== "Usuarios");

export const getPageOptionByUrl = (url) => PAGE_OPTIONS.find((page) => page.url === url);