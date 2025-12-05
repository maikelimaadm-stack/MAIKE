import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { 
  Scale, FileText, Users, LogOut, Package, Shield, FolderOpen, Cloud, 
  Thermometer, Building2, TrendingUp, ArrowRightLeft, DollarSign, Home, 
  BookOpen, Settings, ChevronDown, Bell, User, Menu, CloudRain, CloudOff, Wifi, Search, X, ChevronRight, EyeOff, Eye, Beef
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const iconsMap = {
  Home, Scale, TrendingUp, ArrowRightLeft, DollarSign, BookOpen, FolderOpen, 
  FileText, Shield, Package, Users, Settings, Beef
};

const DEFAULT_MENU = [
  { id: "dashboard", title: "Dashboard", url: "Home", icon: "Home" },
  { id: "pesagens", title: "Pesagens", url: "Pesagens", icon: "Scale" },
  { id: "custos", title: "Custos de Safra", url: "CustosSafra", icon: "TrendingUp" },
  { id: "movimentacoes", title: "Movimentacoes Estoque", url: "MovimentacoesEstoque", icon: "ArrowRightLeft" },
  {
      id: "pecuaria",
      title: "Pecuaria",
      icon: "Beef",
      submenu: [
        { id: "pec-controle", title: "Controle de Pecuaria", url: "ControlePecuaria" },
        { id: "pec-setores", title: "Cadastro de Setores", url: "CadastroSetores" },
        { id: "pec-lotes", title: "Cadastro de Lotes", url: "CadastroLotes" },
        { id: "pec-categorias-manejo", title: "Categorias de Manejo", url: "CategoriasManejo" },
      { id: "pec-fatores", title: "Configuracao Fatores Consumo", url: "ConfiguracaoFatoresConsumo" },
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
      { id: "rel-pesagens", title: "Relatorio de Pesagens", url: "RelatorioPesagens" },
      { id: "rel-custos", title: "Relatorio de Custos Safra", url: "RelatorioCustosSafra" },
      { id: "rel-estoque", title: "Relatorio de Estoque", url: "RelatorioEstoque" },
      { id: "rel-entregas", title: "Historico de Entregas", url: "RelatorioHistoricoEntregas" },
      { id: "rel-financeiro", title: "Relatorio Financeiro", url: "RelatorioFinanceiro" },
      { id: "rel-fornecedores", title: "Lista de Fornecedores", url: "RelatorioFornecedores" },
      { id: "rel-produtos", title: "Lista de Produtos", url: "RelatorioProdutos" },
      { id: "rel-suplementacao", title: "Relatorio de Suplementacao", url: "RelatorioSuplementacao" },
      { id: "rel-movimentacoes-pecuaria", title: "Relatorio Mov. Pecuaria", url: "RelatorioMovimentacoesPecuaria" },
          { id: "rel-pesagens-ind", title: "Relatorio Pesagens Individuais", url: "RelatorioPesagensIndividuais" },
          { id: "rel-fichas", title: "Fichas Personalizadas", url: "FichasPersonalizadas" },
        ],
      },
  { id: "usuarios", title: "Usuarios", url: "Usuarios", icon: "Shield" },
];

// Itens da barra de navegação inferior (mobile)
const BOTTOM_NAV_ITEMS = [
  { id: "home", title: "Início", url: "Home", icon: Home },
  { id: "pecuaria", title: "Pecuária", url: "ControlePecuaria", icon: Beef },
  { id: "pesagens", title: "Pesagens", url: "LancamentoPesagensIndividuais", icon: Scale },
  { id: "financeiro", title: "Financeiro", url: "LancamentoFinanceiro", icon: DollarSign },
  { id: "menu", title: "Menu", icon: Menu, isMenu: true },
];

const getAllPages = (menuItems) => {
  const pages = [];
  
  const traverse = (items, categoria = '') => {
    items.forEach(item => {
      if (item.url) {
        pages.push({
          id: item.id,
          title: item.title,
          url: item.url,
          categoria: categoria || 'Geral'
        });
      }
      if (item.submenu) {
        traverse(item.submenu, item.title);
      }
    });
  };
  
  traverse(menuItems);
  return pages;
};

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [weather, setWeather] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userPermissions, setUserPermissions] = useState(null);
  const isChangingEmpresa = useRef(false);
  const [menuOculto, setMenuOculto] = useState(() => {
    return localStorage.getItem('menu_oculto') === 'true';
  });

  // Prevenir tradução automática do navegador
  React.useEffect(() => {
    document.documentElement.setAttribute('translate', 'no');
    document.documentElement.setAttribute('lang', 'pt-BR');
  }, []);
  
  const [menuItems, setMenuItems] = useState(() => {
    const saved = localStorage.getItem('custom_menu');
    const menuVersion = localStorage.getItem('menu_version');
    const CURRENT_VERSION = '2025-12-03-v1';
    
    if (!saved || menuVersion !== CURRENT_VERSION) {
      localStorage.setItem('custom_menu', JSON.stringify(DEFAULT_MENU));
      localStorage.setItem('menu_version', CURRENT_VERSION);
      return DEFAULT_MENU;
    }
    
    try {
      return JSON.parse(saved);
    } catch {
      return DEFAULT_MENU;
    }
  });
  
  const [empresaSelecionada, setEmpresaSelecionada] = useState(() => {
    return localStorage.getItem('empresa_selecionada_id') || null;
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('custom_menu');
      if (saved) {
        try {
          setMenuItems(JSON.parse(saved));
        } catch (e) {
          console.error('Erro ao parsear menu:', e);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const empresaAtual = React.useMemo(() => {
    if (!empresaSelecionada || !empresas.length) return null;
    return empresas.find(e => e.id === empresaSelecionada) || null;
  }, [empresaSelecionada, empresas]);

  useEffect(() => {
    if (!empresaSelecionada && empresas.length > 0 && !isChangingEmpresa.current) {
      const primeiraEmpresa = empresas[0].id;
      setEmpresaSelecionada(primeiraEmpresa);
      localStorage.setItem('empresa_selecionada_id', primeiraEmpresa);
    }
  }, [empresas.length]);

  const handleEmpresaChange = (empresaId) => {
    if (empresaId === empresaSelecionada) return;
    isChangingEmpresa.current = true;
    setEmpresaSelecionada(empresaId);
    localStorage.setItem('empresa_selecionada_id', empresaId);
  };

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
        try {
          const allPermissoes = await base44.entities.Permissao.list();
          const permissao = allPermissoes.find(p => p.user_email === currentUser.email);
          setUserPermissions(permissao);
        } catch (error) {
          setUserPermissions(null);
        }
      } catch (error) {
        setUser(null);
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=-15.0067&longitude=-59.9533&current=temperature_2m,precipitation&timezone=America/Cuiaba`
        );
        const data = await response.json();
        setWeather({
          temperature: Math.round(data.current.temperature_2m),
          precipitation: data.current.precipitation > 0,
        });
      } catch (error) {
        console.error("Erro clima:", error);
      }
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    base44.auth.logout();
  };

  const hasAccess = (itemId) => {
    if (user?.role === 'admin' || userPermissions?.is_admin) return true;
    if (!userPermissions) return true;
    return userPermissions.modulos_permitidos?.includes(itemId);
  };

  const filterMenuByPermissions = (items) => {
    return items
      .filter(item => hasAccess(item.id))
      .map(item => {
        if (item.submenu) {
          const filteredSubmenu = filterMenuByPermissions(item.submenu);
          if (filteredSubmenu.length === 0) return null;
          return { ...item, submenu: filteredSubmenu };
        }
        return item;
      })
      .filter(Boolean);
  };

  const menuItemsFiltered = React.useMemo(() => {
    if (!menuItems) return [];
    return filterMenuByPermissions(menuItems);
  }, [menuItems, user?.role, userPermissions?.is_admin, userPermissions?.modulos_permitidos]);

  const isActive = (item) => {
    if (item.url) return location.pathname === createPageUrl(item.url);
    if (item.submenu) return item.submenu.some(sub => {
      if (sub.url) return location.pathname === createPageUrl(sub.url);
      if (sub.submenu) return sub.submenu.some(subsub => location.pathname === createPageUrl(subsub.url));
      return false;
    });
    return false;
  };

  const isBottomNavActive = (item) => {
    if (item.isMenu) return false;
    return location.pathname === createPageUrl(item.url);
  };

  const allPages = getAllPages(menuItemsFiltered);
  const filteredPages = searchTerm 
    ? allPages.filter(p => 
        p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.categoria.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : allPages;

  const pagesByCategory = filteredPages.reduce((acc, page) => {
    if (!acc[page.categoria]) acc[page.categoria] = [];
    acc[page.categoria].push(page);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50 pb-16 md:pb-0" translate="no">
      {/* HEADER - Compacto no mobile */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4 py-1.5 md:py-2">
          <div className="flex items-center justify-between">
            {/* Logo e Nome da Empresa */}
            <div className="flex items-center gap-2 min-w-0">
              {empresaAtual?.logotipo_url && (
                <img src={empresaAtual.logotipo_url} alt="" className="h-6 w-6 md:h-8 md:w-8 object-contain rounded flex-shrink-0" />
              )}
              <div className="min-w-0">
                <h1 className="font-bold text-slate-900 text-xs md:text-base leading-tight truncate">
                  {empresaAtual?.apelido || empresaAtual?.nome || 'MakGestão'}
                </h1>
                <p className="text-[10px] text-slate-500 hidden md:block">Sistema de Gestão</p>
              </div>
            </div>

            {/* Info do clima - apenas desktop */}
            <div className="hidden lg:flex items-center gap-4">
              {weather && (
                <>
                  <div className="flex items-center gap-1.5">
                    {weather.precipitation ? (
                      <CloudRain className="w-3.5 h-3.5 text-blue-500" />
                    ) : (
                      <CloudOff className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span className="text-xs text-slate-600">
                      {weather.precipitation ? 'Chuva' : 'Sem chuva'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Thermometer className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs text-slate-600">{weather.temperature}°C</span>
                  </div>
                </>
              )}
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-slate-600">Online</span>
              </div>
            </div>

            {/* Ações do Header */}
            <div className="flex items-center gap-1">
              {/* Seletor de Empresa - Desktop */}
              {empresas.length > 0 && (
                <Select value={empresaSelecionada || ''} onValueChange={handleEmpresaChange}>
                  <SelectTrigger className="h-7 w-32 md:w-40 text-xs hidden md:flex border-slate-300">
                    <SelectValue placeholder="Empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((empresa) => (
                      <SelectItem key={empresa.id} value={empresa.id} className="text-xs">
                        {empresa.apelido || empresa.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Botão Buscar */}
              <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8" onClick={() => setSearchOpen(true)}>
                <Search className="w-4 h-4 text-slate-600" />
              </Button>

              {/* Botão Ocultar Menu - Desktop */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 hidden md:inline-flex" 
                onClick={() => {
                  const novoEstado = !menuOculto;
                  setMenuOculto(novoEstado);
                  localStorage.setItem('menu_oculto', novoEstado.toString());
                }}
              >
                {menuOculto ? <Eye className="w-4 h-4 text-slate-600" /> : <EyeOff className="w-4 h-4 text-slate-600" />}
              </Button>

              {/* Configurações - Desktop */}
              <Link to={createPageUrl("ConfiguracoesGerais")} className="hidden md:inline-flex">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Settings className="w-4 h-4 text-slate-600" />
                </Button>
              </Link>

              {/* Menu do Usuário */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 md:h-8 gap-1 px-1.5 md:px-2">
                    <div className="w-5 h-5 md:w-6 md:h-6 bg-emerald-100 rounded-full flex items-center justify-center">
                      <span className="text-emerald-700 font-semibold text-[10px] md:text-xs">
                        {user?.full_name?.charAt(0).toUpperCase() || 'U'}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-slate-700 hidden lg:block">
                      {user?.full_name?.split(' ')[0] || 'Usuario'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">
                    <div className="font-semibold">{user?.full_name}</div>
                    <div className="text-slate-500 font-normal truncate">{user?.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* Seletor de Empresa - Mobile */}
                  {empresas.length > 0 && (
                    <div className="px-2 py-1.5 md:hidden">
                      <Select value={empresaSelecionada || ''} onValueChange={handleEmpresaChange}>
                        <SelectTrigger className="h-8 text-xs w-full">
                          <SelectValue placeholder="Empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          {empresas.map((empresa) => (
                            <SelectItem key={empresa.id} value={empresa.id} className="text-xs">
                              {empresa.apelido || empresa.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <DropdownMenuItem asChild className="text-xs">
                    <Link to={createPageUrl("ConfiguracoesGerais")}>
                      <Settings className="w-3 h-3 mr-2" />
                      Configurações
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-xs text-red-600">
                    <LogOut className="w-3 h-3 mr-2" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* MENU HORIZONTAL - Desktop */}
      <nav className={`sticky top-[41px] md:top-[49px] z-30 bg-white border-b border-slate-200 shadow-sm transition-all duration-300 hidden md:block ${menuOculto ? 'h-0 overflow-hidden border-0' : ''}`}>
        <div className="max-w-[1600px] mx-auto px-4">
          <div className="flex items-center gap-0.5 h-9 overflow-x-auto">
            {menuItemsFiltered.map((item) => {
              const Icon = iconsMap[item.icon] || Home;
              const active = isActive(item);

              if (item.submenu) {
                return (
                  <div key={item.id} className="relative group">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className={`h-7 px-2 gap-1 text-xs font-medium rounded whitespace-nowrap ${
                        active 
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700' 
                          : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {item.title}
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </Button>
                    
                    <div className="absolute left-0 mt-1 w-52 bg-white rounded-md shadow-lg border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                      <div className="py-1 max-h-80 overflow-y-auto">
                        {item.submenu.sort((a, b) => a.title.localeCompare(b.title)).map((sub) => (
                          <Link 
                            key={sub.id}
                            to={createPageUrl(sub.url)}
                            className={`block px-3 py-1.5 text-xs hover:bg-slate-50 ${
                              location.pathname === createPageUrl(sub.url)
                                ? 'bg-emerald-50 text-emerald-800 font-medium'
                                : 'text-slate-700'
                            }`}
                          >
                            {sub.title}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <Link key={item.id} to={createPageUrl(item.url)}>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className={`h-7 px-2 gap-1 text-xs font-medium rounded whitespace-nowrap ${
                      active 
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700' 
                        : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {item.title}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* DIALOG DE BUSCA */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col mx-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Search className="w-4 h-4 text-emerald-600" />
              Buscar no sistema
            </DialogTitle>
          </DialogHeader>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Digite para buscar..."
              className="pl-9 h-9 text-sm"
              autoFocus
            />
            {searchTerm && (
              <Button 
                variant="ghost" 
                size="icon"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchTerm("")}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-auto mt-3">
            {Object.keys(pagesByCategory).length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Search className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhuma página encontrada</p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(pagesByCategory)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([categoria, pages]) => (
                  <div key={categoria}>
                    <h3 className="text-[10px] font-semibold text-slate-500 uppercase mb-1 px-1">{categoria}</h3>
                    <div className="space-y-0.5">
                      {pages.sort((a, b) => a.title.localeCompare(b.title)).map((page) => (
                        <Link
                          key={page.id}
                          to={createPageUrl(page.url)}
                          onClick={() => { setSearchOpen(false); setSearchTerm(""); }}
                          className="block px-2 py-1.5 text-xs hover:bg-emerald-50 rounded transition-colors"
                        >
                          <div className="font-medium text-slate-800">{page.title}</div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* MENU LATERAL MOBILE (Sheet) */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="right" className="w-72 flex flex-col p-0">
          <SheetHeader className="p-3 border-b">
            <SheetTitle className="text-left text-sm">Menu Completo</SheetTitle>
          </SheetHeader>
          
          <div className="flex-1 overflow-y-auto p-2">
            {menuItemsFiltered.map((item) => {
              const Icon = iconsMap[item.icon] || Home;
              
              if (item.submenu) {
                return (
                  <div key={item.id} className="mb-2">
                    <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded">
                      <Icon className="w-3.5 h-3.5" />
                      {item.title}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {item.submenu.sort((a, b) => a.title.localeCompare(b.title)).map((sub) => (
                        <Link 
                          key={sub.id}
                          to={createPageUrl(sub.url)}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`block px-3 py-1.5 text-xs rounded ${
                            location.pathname === createPageUrl(sub.url)
                              ? 'bg-emerald-100 text-emerald-800 font-medium'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {sub.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              }

              return (
                <Link 
                  key={item.id}
                  to={createPageUrl(item.url)}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded mb-1 ${
                    location.pathname === createPageUrl(item.url)
                      ? 'bg-emerald-100 text-emerald-800 font-medium'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.title}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="max-w-[1600px] mx-auto">
        {children}
      </main>

      {/* BARRA DE NAVEGAÇÃO INFERIOR - Mobile */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 md:hidden safe-area-bottom">
        <div className="grid grid-cols-5 h-14">
          {BOTTOM_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isBottomNavActive(item);
            
            if (item.isMenu) {
              return (
                <button
                  key={item.id}
                  onClick={() => setMobileMenuOpen(true)}
                  className="flex flex-col items-center justify-center gap-0.5 text-slate-500"
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px]">{item.title}</span>
                </button>
              );
            }

            return (
              <Link
                key={item.id}
                to={createPageUrl(item.url)}
                className={`flex flex-col items-center justify-center gap-0.5 ${
                  active ? 'text-emerald-600' : 'text-slate-500'
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'text-emerald-600' : ''}`} />
                <span className={`text-[10px] ${active ? 'font-medium' : ''}`}>{item.title}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* CSS para safe area no iPhone */}
      <style>{`
        .safe-area-bottom {
          padding-bottom: env(safe-area-inset-bottom, 0);
        }
      `}</style>
    </div>
  );
}

export const getEmpresaSelecionada = () => {
  return localStorage.getItem('empresa_selecionada_id');
};