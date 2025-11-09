import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { 
  Scale, FileText, Users, LogOut, Package, Shield, FolderOpen, Cloud, 
  Thermometer, Building2, TrendingUp, ArrowRightLeft, DollarSign, Home, 
  BookOpen, Settings, ChevronDown, Bell, User, Menu, X 
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const iconsMap = {
  Home, Scale, TrendingUp, ArrowRightLeft, DollarSign, BookOpen, FolderOpen, 
  FileText, Shield, Package, Users, Settings
};

const DEFAULT_MENU = [
  { id: "dashboard", title: "Dashboard", url: "Home", icon: "Home" },
  { id: "pesagens", title: "Pesagens", url: "Dashboard", icon: "Scale" },
  { id: "custos", title: "Custos de Safra", url: "CustosSafra", icon: "TrendingUp" },
  { id: "movimentacoes", title: "Movimentações Estoque", url: "MovimentacoesEstoque", icon: "ArrowRightLeft" },
  {
    id: "financeiro",
    title: "Financeiro",
    icon: "DollarSign",
    submenu: [
      { id: "fin-controle", title: "Controle Financeiro", url: "Financeiro" },
      { id: "fin-plano", title: "Plano de Contas", url: "PlanoContas" },
      { id: "fin-formas", title: "Formas de Pagamento", url: "FormasPagamento" },
      { id: "fin-grupos", title: "Grupos Financeiros", url: "GruposFinanceiros" },
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
      { id: "cad-safras", title: "Safras", url: "GerenciarSafras" },
      { id: "cad-fornecedores", title: "Fornecedores/Clientes", url: "Fornecedores" },
      { id: "cad-produtos", title: "Produtos", url: "Produtos" },
      { id: "cad-unidades", title: "Unidades de Medida", url: "UnidadesMedida" },
      { id: "cad-categorias", title: "Categorias", url: "Categorias" },
      { id: "cad-locais", title: "Locais de Estoque", url: "LocaisEstoque" },
      { id: "cad-centros", title: "Centros de Custo", url: "CentrosCusto" },
    ],
  },
  {
    id: "relatorios",
    title: "Relatórios",
    icon: "FileText",
    submenu: [
      { id: "rel-pesagens", title: "Relatório de Pesagens", url: "RelatorioPesagens" },
      { id: "rel-custos", title: "Relatório de Custos Safra", url: "RelatorioCustosSafra" },
      { id: "rel-estoque", title: "Relatório de Estoque", url: "RelatorioEstoque" },
      { id: "rel-entregas", title: "Histórico de Entregas", url: "RelatorioHistoricoEntregas" },
      { id: "rel-financeiro", title: "Relatório Financeiro", url: "RelatorioFinanceiro" },
      { id: "rel-fornecedores", title: "Lista de Fornecedores", url: "RelatorioFornecedores" },
      { id: "rel-produtos", title: "Lista de Produtos", url: "RelatorioProdutos" },
    ],
  },
  { id: "usuarios", title: "Usuários", url: "Usuarios", icon: "Shield" },
];

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [weather, setWeather] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [menuItems, setMenuItems] = useState(() => {
    const saved = localStorage.getItem('custom_menu');
    return saved ? JSON.parse(saved) : DEFAULT_MENU;
  });
  
  const [empresaSelecionada, setEmpresaSelecionada] = useState(() => {
    return localStorage.getItem('empresa_selecionada_id') || null;
  });

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

  useEffect(() => {
    if (!empresaSelecionada && empresas.length > 0) {
      const primeiraEmpresa = empresas[0].id;
      setEmpresaSelecionada(primeiraEmpresa);
      localStorage.setItem('empresa_selecionada_id', primeiraEmpresa);
    }
  }, [empresas, empresaSelecionada]);

  const handleEmpresaChange = (empresaId) => {
    setEmpresaSelecionada(empresaId);
    localStorage.setItem('empresa_selecionada_id', empresaId);
    window.location.reload();
  };

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
      } catch (error) {
        console.error("Erro ao carregar usuário:", error);
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
        console.error("Erro ao buscar clima:", error);
      }
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    base44.auth.logout();
  };

  const isActive = (item) => {
    if (item.url) return location.pathname === createPageUrl(item.url);
    if (item.submenu) return item.submenu.some(sub => location.pathname === createPageUrl(sub.url));
    return false;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* TOP NAVIGATION BAR */}
      <nav className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            {/* LOGO */}
            <div className="flex items-center gap-4">
              <Link to={createPageUrl("Home")} className="flex items-center gap-2">
                {empresaAtual?.logotipo_url ? (
                  <img 
                    src={empresaAtual.logotipo_url} 
                    alt={empresaAtual.apelido}
                    className="h-8 w-auto object-contain"
                  />
                ) : (
                  <img 
                    src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                    alt="Logo"
                    className="h-8 w-auto object-contain"
                  />
                )}
                <span className="font-bold text-slate-800 text-sm hidden lg:block">
                  {empresaAtual?.apelido || 'Sistema'}
                </span>
              </Link>
            </div>

            {/* DESKTOP MENU */}
            <div className="hidden md:flex items-center gap-1">
              {menuItems.map((item) => {
                const Icon = iconsMap[item.icon] || Home;
                const active = isActive(item);

                if (item.submenu) {
                  return (
                    <DropdownMenu key={item.id}>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className={`h-9 px-3 gap-1.5 text-xs font-medium ${
                            active 
                              ? 'bg-slate-100 text-slate-900' 
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {item.title}
                          <ChevronDown className="w-3 h-3 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        <DropdownMenuLabel className="text-xs">{item.title}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {item.submenu.map((sub) => (
                          <DropdownMenuItem key={sub.id} asChild>
                            <Link 
                              to={createPageUrl(sub.url)}
                              className={`text-xs cursor-pointer ${
                                location.pathname === createPageUrl(sub.url)
                                  ? 'bg-slate-100 font-medium'
                                  : ''
                              }`}
                            >
                              {sub.title}
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                }

                return (
                  <Link key={item.id} to={createPageUrl(item.url)}>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className={`h-9 px-3 gap-1.5 text-xs font-medium ${
                        active 
                          ? 'bg-slate-100 text-slate-900' 
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {item.title}
                    </Button>
                  </Link>
                );
              })}
            </div>

            {/* RIGHT SIDE */}
            <div className="flex items-center gap-2">
              {/* Weather */}
              {weather && (
                <div className="hidden lg:flex items-center gap-2 px-2 py-1 bg-slate-50 rounded-md text-xs text-slate-600">
                  <Thermometer className="w-3.5 h-3.5" />
                  <span className="font-medium">{weather.temperature}°C</span>
                  {weather.precipitation && <Cloud className="w-3.5 h-3.5 text-blue-500" />}
                </div>
              )}

              {/* Company Selector */}
              {empresas.length > 0 && (
                <Select value={empresaSelecionada || ''} onValueChange={handleEmpresaChange}>
                  <SelectTrigger className="h-9 w-[180px] text-xs hidden lg:flex">
                    <Building2 className="w-3.5 h-3.5 mr-1" />
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

              {/* Notifications */}
              <Button variant="ghost" size="icon" className="h-9 w-9 hidden md:inline-flex">
                <Bell className="w-4 h-4 text-slate-600" />
              </Button>

              {/* Settings */}
              <Link to={createPageUrl("ConfiguracoesGerais")}>
                <Button variant="ghost" size="icon" className="h-9 w-9 hidden md:inline-flex">
                  <Settings className="w-4 h-4 text-slate-600" />
                </Button>
              </Link>

              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 gap-2 px-2">
                    <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center">
                      <span className="text-slate-700 font-semibold text-xs">
                        {user?.full_name?.charAt(0).toUpperCase() || 'U'}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-slate-700 hidden lg:block">
                      {user?.full_name?.split(' ')[0] || 'Usuário'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs">
                    <div className="font-semibold">{user?.full_name}</div>
                    <div className="text-slate-500 font-normal">{user?.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-xs">
                    <User className="w-3.5 h-3.5 mr-2" />
                    Meu Perfil
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="text-xs">
                    <Link to={createPageUrl("ConfiguracoesGerais")}>
                      <Settings className="w-3.5 h-3.5 mr-2" />
                      Configurações
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-xs text-red-600">
                    <LogOut className="w-3.5 h-3.5 mr-2" />
                    Sair do Sistema
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Mobile Menu Button */}
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden">
                    <Menu className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-80">
                  <SheetHeader>
                    <SheetTitle className="text-left">Menu</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6 space-y-1">
                    {menuItems.map((item) => {
                      const Icon = iconsMap[item.icon] || Home;
                      
                      if (item.submenu) {
                        return (
                          <div key={item.id} className="space-y-1">
                            <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700">
                              <Icon className="w-4 h-4" />
                              {item.title}
                            </div>
                            <div className="ml-4 space-y-1">
                              {item.submenu.map((sub) => (
                                <Link 
                                  key={sub.id}
                                  to={createPageUrl(sub.url)}
                                  onClick={() => setMobileMenuOpen(false)}
                                  className={`block px-3 py-2 text-sm rounded-md ${
                                    location.pathname === createPageUrl(sub.url)
                                      ? 'bg-slate-100 font-medium'
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
                          className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md ${
                            location.pathname === createPageUrl(item.url)
                              ? 'bg-slate-100 font-medium'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
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
      </nav>

      {/* MAIN CONTENT */}
      <main className="max-w-[1600px] mx-auto">
        {children}
      </main>
    </div>
  );
}

export const getEmpresaSelecionada = () => {
  return localStorage.getItem('empresa_selecionada_id');
};