import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { LogOut, Menu, ChevronDown, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import PWAInstaller from "@/components/PWAInstaller";
import OfflineManager from "@/components/offline/OfflineManager";
import CacheManager from "@/components/offline/CacheManager";
import OfflineIndicator from "@/components/offline/OfflineIndicator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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

const DEFAULT_MENU = [
  { id: "dashboard", title: "INICIO", url: "Home" },
  { id: "pesagens", title: "PESAGENS", url: "Pesagens" },
  { id: "custos", title: "CUSTOS SAFRA", url: "CustosSafra" },
  { id: "movimentacoes", title: "ESTOQUE", url: "MovimentacoesEstoque" },
  {
    id: "pecuaria",
    title: "PECUARIA",
    submenu: [
      { id: "pec-lotes", title: "Lotes", url: "CadastroLotes" },
      { id: "pec-categorias-manejo", title: "Categorias Manejo", url: "CategoriasManejo" },
      { id: "pec-fatores", title: "Fatores Consumo", url: "ConfiguracaoFatoresConsumo" },
      { id: "pec-dashboard-supl", title: "Suplementacao", url: "DashboardSuplementacao" },
      { id: "pec-historico", title: "Historico Mov.", url: "HistoricoMovimentacoesPecuaria" },
      { id: "pec-mapa-cadastro", title: "Mapa Cadastro", url: "MapaCadastro" },
      { id: "pec-mapa-geral", title: "Mapa Manejo", url: "MapaGeral" },
      { id: "pec-relatorio", title: "Rel. Suplementacao", url: "RelatorioSuplementacao" },
    ],
  },
  {
    id: "maquinas",
    title: "MAQUINAS",
    submenu: [
      { id: "maq-cadastro", title: "Cadastro", url: "CadastroMaquinas" },
      { id: "maq-operacoes", title: "Operacoes", url: "OperacoesAgricolas" },
      { id: "maq-controle-areas", title: "Controle Areas", url: "ControleAreas" },
      { id: "maq-ficha", title: "Ficha Operador", url: "FichaOperador" },
      { id: "maq-ficha-impressao", title: "Imprimir Fichas", url: "FichaOperadorImpressao" },
    ],
  },
  {
    id: "financeiro",
    title: "FINANCEIRO",
    submenu: [
      { id: "fin-lancamento", title: "Lancamentos", url: "LancamentoFinanceiro" },
      { id: "fin-caixa-bancos", title: "Caixa/Bancos", url: "CaixaBancos" },
      { id: "fin-plano", title: "Plano Contas", url: "PlanoContas" },
      { id: "fin-formas", title: "Formas Pgto", url: "FormasPagamento" },
      { id: "fin-grupos", title: "Grupos", url: "GruposFinanceiros" },
      { id: "fin-fluxo", title: "Fluxo Caixa", url: "FluxoCaixa" },
      { id: "fin-livro-caixa", title: "Livro-Caixa", url: "LivroCaixa" },
    ],
  },
  {
    id: "fiscal",
    title: "FISCAL",
    submenu: [
      { id: "fiscal-livros", title: "Livros Fiscais", url: "LivrosFiscais" },
    ],
  },
  {
    id: "cadastros",
    title: "CADASTROS",
    submenu: [
      { id: "cad-empresa", title: "Empresa", url: "Empresa" },
      { id: "cad-mapa", title: "Mapa", url: "MapaCadastro" },
      { id: "cad-safras", title: "Safras", url: "GerenciarSafras" },
      { id: "cad-fornecedores", title: "Fornecedores", url: "Fornecedores" },
      { id: "cad-produtos", title: "Produtos", url: "Produtos" },
      { id: "cad-ativos", title: "Ativos Fixos", url: "AtivosFixos" },
      { id: "cad-cidades", title: "Cidades", url: "GerenciarCidades" },
      { id: "cad-unidades", title: "Unidades Med.", url: "UnidadesMedida" },
      { id: "cad-categorias", title: "Categorias", url: "Categorias" },
      { id: "cad-locais", title: "Locais Estoque", url: "LocaisEstoque" },
      { id: "cad-centros", title: "Centros Custo", url: "CentrosCusto" },
    ],
  },
  {
    id: "relatorios",
    title: "RELATORIOS",
    submenu: [
      { id: "rel-pesagens", title: "Pesagens", url: "RelatorioPesagens" },
      { id: "rel-custos", title: "Custos Safra", url: "RelatorioCustosSafra" },
      { id: "rel-estoque", title: "Estoque", url: "RelatorioEstoque" },
      { id: "rel-entregas", title: "Entregas", url: "RelatorioHistoricoEntregas" },
      { id: "rel-financeiro", title: "Financeiro", url: "RelatorioFinanceiro" },
      { id: "rel-fornecedores", title: "Fornecedores", url: "RelatorioFornecedores" },
      { id: "rel-produtos", title: "Produtos", url: "RelatorioProdutos" },
      { id: "rel-suplementacao", title: "Suplementacao", url: "RelatorioSuplementacao" },
    ],
  },
  { id: "usuarios", title: "USUARIOS", url: "Usuarios" },
  { id: "config", title: "CONFIG", url: "ConfiguracoesGerais" },
];

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [weather, setWeather] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userPermissions, setUserPermissions] = useState(null);
  const isChangingEmpresa = useRef(false);

  // Prevenir tradução automática do navegador
  React.useEffect(() => {
    document.documentElement.setAttribute('translate', 'no');
    document.documentElement.setAttribute('lang', 'pt-BR');
  }, []);
  
  const [menuItems, setMenuItems] = useState(() => {
    const saved = localStorage.getItem('custom_menu');
    return saved ? JSON.parse(saved) : DEFAULT_MENU;
  });
  
  const [empresaSelecionada, setEmpresaSelecionada] = useState(() => {
    return localStorage.getItem('empresa_selecionada_id') || null;
  });

  // ATUALIZAR MENU - SEM LOOP!
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
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    initialData: [],
  });

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual', empresaSelecionada],
    queryFn: async () => {
      if (!empresaSelecionada) return null;
      const empresa = empresas.find(e => e.id === empresaSelecionada);
      return empresa || null;
    },
    enabled: !!empresaSelecionada && empresas.length > 0,
  });

  // Selecionar primeira empresa SOMENTE UMA VEZ
  useEffect(() => {
    if (!empresaSelecionada && empresas.length > 0 && !isChangingEmpresa.current) {
      const primeiraEmpresa = empresas[0].id;
      setEmpresaSelecionada(primeiraEmpresa);
      localStorage.setItem('empresa_selecionada_id', primeiraEmpresa);
    }
  }, [empresas.length]); // Apenas quando o tamanho mudar

  const handleEmpresaChange = (empresaId) => {
    isChangingEmpresa.current = true;
    setEmpresaSelecionada(empresaId);
    localStorage.setItem('empresa_selecionada_id', empresaId);
    
    // Usar timeout para evitar loops
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
        
        // Carregar permissões do usuário
        try {
          const allPermissoes = await base44.entities.Permissao.list();
          const permissao = allPermissoes.find(p => p.user_email === currentUser.email);
          setUserPermissions(permissao);
        } catch (error) {
          console.error("Erro ao carregar permissões:", error);
          setUserPermissions(null);
        }
      } catch (error) {
        console.error("Erro ao carregar usuário:", error);
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
    // Admin sempre tem acesso
    if (user?.role === 'admin' || userPermissions?.is_admin) return true;
    
    // Se não tem permissões configuradas, libera tudo (comportamento padrão)
    if (!userPermissions) return true;
    
    // Verifica se o módulo está nas permissões
    return userPermissions.modulos_permitidos?.includes(itemId);
  };

  const filterMenuByPermissions = (items) => {
    return items.filter(item => {
      if (!hasAccess(item.id)) return false;
      
      if (item.submenu) {
        item.submenu = filterMenuByPermissions(item.submenu);
        return item.submenu.length > 0;
      }
      
      return true;
    });
  };

  const menuItemsFiltered = filterMenuByPermissions(menuItems);

  const isActive = (item) => {
    if (item.url) return location.pathname === createPageUrl(item.url);
    if (item.submenu) return item.submenu.some(sub => {
      if (sub.url) return location.pathname === createPageUrl(sub.url);
      if (sub.submenu) return sub.submenu.some(subsub => location.pathname === createPageUrl(subsub.url));
      return false;
    });
    return false;
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
    <div className="min-h-screen bg-slate-50" translate="no">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="font-bold text-slate-900 text-base leading-tight">
                  {empresaAtual?.apelido || empresaAtual?.nome || 'FAZENDA PALMITAL'}
                </h1>
                <p className="text-xs text-slate-600">Sistema de Gestao</p>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-6">
              {weather && (
                <>
                  <div className="flex items-center gap-2">
                    {weather.precipitation ? (
                      <CloudRain className="w-4 h-4 text-blue-500" />
                    ) : (
                      <CloudOff className="w-4 h-4 text-slate-400" />
                    )}
                    <span className="text-xs text-slate-700 font-medium">
                      {weather.precipitation ? 'Chuva' : 'Sem chuva'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Thermometer className="w-4 h-4 text-orange-500" />
                    <span className="text-xs text-slate-700 font-medium">
                      {weather.temperature}°C
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-slate-500" />
                    <span className="text-xs text-slate-700 font-medium">
                      Cuiaba - MT
                    </span>
                  </div>
                </>
              )}

              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-slate-700 font-medium">Sistema Online</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {empresas.length > 0 && (
                <Select value={empresaSelecionada || ''} onValueChange={handleEmpresaChange}>
                  <SelectTrigger className="h-8 w-[160px] text-xs hidden lg:flex border-slate-300">
                    <SelectValue placeholder="Selecione" />
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

              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearchOpen(true)}>
                <Search className="w-4 h-4 text-slate-600" />
              </Button>

              <Button variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex">
                <Bell className="w-4 h-4 text-slate-600" />
              </Button>

              <Link to={createPageUrl("ConfiguracoesGerais")}>
                <Button variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex">
                  <Settings className="w-4 h-4 text-slate-600" />
                </Button>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-2 px-2">
                    <div className="w-6 h-6 bg-slate-200 rounded-full flex items-center justify-center">
                      <span className="text-slate-700 font-semibold text-xs">
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
                    <div className="text-slate-500 font-normal">{user?.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-xs">
                    <User className="w-3 h-3 mr-2" />
                    Meu Perfil
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="text-xs">
                    <Link to={createPageUrl("ConfiguracoesGerais")}>
                      <Settings className="w-3 h-3 mr-2" />
                      Configuracoes
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-xs text-red-600">
                    <LogOut className="w-3 h-3 mr-2" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden">
                    <Menu className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72">
                  <SheetHeader>
                    <SheetTitle className="text-left text-sm">Menu</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 space-y-1">
                    {menuItemsFiltered.map((item) => {
                      const Icon = iconsMap[item.icon] || Home;
                      
                      if (item.submenu) {
                        return (
                          <div key={item.id} className="space-y-1">
                            <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-slate-700">
                              <Icon className="w-3.5 h-3.5" />
                              {item.title}
                            </div>
                            <div className="ml-3 space-y-0.5">
                              {item.submenu.sort((a, b) => a.title.localeCompare(b.title)).map((sub) => (
                                <Link 
                                  key={sub.id}
                                  to={createPageUrl(sub.url)}
                                  onClick={() => setMobileMenuOpen(false)}
                                  className={`block px-2 py-1.5 text-xs rounded ${
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
                          className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded ${
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
            </div>
          </div>
        </div>
      </div>

      <nav className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4">
          <div className="flex items-center gap-0.5 h-10">
            <div className="hidden md:flex items-center gap-0.5">
              {menuItemsFiltered.map((item) => {
                const Icon = iconsMap[item.icon] || Home;
                const active = isActive(item);

                if (item.submenu) {
                  return (
                    <div key={item.id} className="relative group">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className={`h-8 px-2.5 gap-1 text-xs font-medium rounded ${
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
                        <div className="py-1">
                          {item.submenu.sort((a, b) => a.title.localeCompare(b.title)).map((sub) => {
                            if (sub.submenu && sub.submenu.length > 0) {
                              return (
                                <div key={sub.id} className="relative group/sub">
                                  <div className={`flex items-center justify-between px-4 py-2 text-xs hover:bg-slate-50 cursor-pointer ${
                                    location.pathname === createPageUrl(sub.url)
                                      ? 'bg-emerald-50 text-emerald-800 font-medium'
                                      : 'text-slate-700'
                                  }`}>
                                    <span>{sub.title}</span>
                                    <ChevronRight className="w-3 h-3 opacity-50" />
                                  </div>
                                  
                                  <div className="absolute left-full top-0 ml-1 w-52 bg-white rounded-md shadow-lg border border-slate-200 opacity-0 invisible group-hover/sub:opacity-100 group-hover/sub:visible transition-all duration-200 z-50">
                                    <div className="py-1">
                                      {sub.submenu.sort((a, b) => a.title.localeCompare(b.title)).map((subsub) => (
                                        <Link 
                                          key={subsub.id}
                                          to={createPageUrl(subsub.url)}
                                          className={`block px-4 py-2 text-xs hover:bg-slate-50 ${
                                            location.pathname === createPageUrl(subsub.url)
                                              ? 'bg-emerald-50 text-emerald-800 font-medium'
                                              : 'text-slate-700'
                                          }`}
                                        >
                                          {subsub.title}
                                        </Link>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <Link 
                                key={sub.id}
                                to={createPageUrl(sub.url)}
                                className={`block px-4 py-2 text-xs hover:bg-slate-50 ${
                                  location.pathname === createPageUrl(sub.url)
                                    ? 'bg-emerald-50 text-emerald-800 font-medium'
                                    : 'text-slate-700'
                                }`}
                              >
                                {sub.title}
                              </Link>
                            );
                          })}
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
                      className={`h-8 px-2.5 gap-1 text-xs font-medium rounded ${
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
        </div>
      </nav>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Search className="w-4 h-4 text-emerald-600" />
              Buscar em todo o sistema
            </DialogTitle>
          </DialogHeader>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Digite para buscar paginas..."
              className="pl-10 h-10"
              autoFocus
            />
            {searchTerm && (
              <Button 
                variant="ghost" 
                size="icon"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8"
                onClick={() => setSearchTerm("")}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-auto mt-4">
            {Object.keys(pagesByCategory).length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Nenhuma pagina encontrada</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(pagesByCategory)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([categoria, pages]) => (
                  <div key={categoria}>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2 px-2">{categoria}</h3>
                    <div className="space-y-1">
                      {pages.sort((a, b) => a.title.localeCompare(b.title)).map((page) => (
                        <Link
                          key={page.id}
                          to={createPageUrl(page.url)}
                          onClick={() => { setSearchOpen(false); setSearchTerm(""); }}
                          className="block px-3 py-2 text-sm hover:bg-emerald-50 rounded-md transition-colors"
                        >
                          <div className="font-medium text-slate-900">{page.title}</div>
                          <div className="text-xs text-slate-500">{categoria}</div>
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

      <main className="max-w-[1600px] mx-auto">
        {children}
      </main>

      <PWAInstaller />
      <OfflineManager />
      <CacheManager />
      <OfflineIndicator />
      </div>
      );
      }

export const getEmpresaSelecionada = () => {
  return localStorage.getItem('empresa_selecionada_id');
};