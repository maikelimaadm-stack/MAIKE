
import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { Scale, FileText, Users, LogOut, Package, Shield, FolderOpen, Cloud, Thermometer, Building2, ChevronDown, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const navigationItems = [
  {
    title: "Pesagens",
    url: createPageUrl("Dashboard"),
    icon: Scale,
  },
  {
    title: "Custos de Safra",
    url: createPageUrl("CustosSafra"),
    icon: TrendingUp,
  },
  {
    title: "Cadastros",
    icon: FolderOpen,
    submenu: [
      {
        title: "Empresa",
        url: createPageUrl("Empresa"),
      },
      {
        title: "Fornecedores/Clientes",
        url: createPageUrl("Fornecedores"),
      },
      {
        title: "Produtos",
        url: createPageUrl("Produtos"),
      },
      {
        title: "Unidades de Medida",
        url: createPageUrl("UnidadesMedida"),
      },
      {
        title: "Categorias",
        url: createPageUrl("Categorias"),
      },
      {
        title: "Locais de Estoque",
        url: createPageUrl("LocaisEstoque"),
      },
    ],
  },
  {
    title: "Relatórios",
    icon: FileText,
    submenu: [
      {
        title: "Relatório de Pesagens",
        url: createPageUrl("RelatorioPesagens"),
      },
      {
        title: "Lista de Fornecedores",
        url: createPageUrl("RelatorioFornecedores"),
      },
      {
        title: "Lista de Produtos",
        url: createPageUrl("RelatorioProdutos"),
      },
    ],
  },
  {
    title: "Usuários",
    url: createPageUrl("Usuarios"),
    icon: Shield,
  },
];

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState({});
  const [weather, setWeather] = useState(null);
  
  // Estado para empresa selecionada
  const [empresaSelecionada, setEmpresaSelecionada] = useState(() => {
    return localStorage.getItem('empresa_selecionada_id') || null;
  });

  // Buscar todas as empresas
  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    initialData: [],
  });

  // Buscar dados da empresa selecionada
  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual', empresaSelecionada],
    queryFn: async () => {
      if (!empresaSelecionada) return null;
      const empresa = empresas.find(e => e.id === empresaSelecionada);
      return empresa || null;
    },
    enabled: !!empresaSelecionada && empresas.length > 0,
  });

  // Auto-selecionar primeira empresa se não tiver nenhuma selecionada
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
    window.location.reload(); // Recarregar para atualizar todos os dados
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

  const toggleSubmenu = (title) => {
    setExpandedMenus(prev => ({
      ...prev,
      [title]: !prev[title]
    }));
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-to-br from-green-50 via-emerald-50 to-green-100">
        <Sidebar className="border-r border-green-200 bg-white">
          <SidebarHeader className="border-b border-green-200 p-4">
            <div className="flex items-center gap-3 mb-3">
              {empresaAtual?.logotipo_url ? (
                <img 
                  src={empresaAtual.logotipo_url} 
                  alt={empresaAtual.apelido}
                  className="w-12 h-12 object-contain"
                />
              ) : (
                <img 
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                  alt="Logo"
                  className="w-12 h-12 object-contain"
                />
              )}
              <div>
                <h2 className="font-bold text-green-900 text-lg">
                  {empresaAtual?.apelido || 'Sistema'}
                </h2>
                <p className="text-xs text-green-700">Sistema de Gestão</p>
              </div>
            </div>

            {/* Seletor de Empresa */}
            {empresas.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Empresa Ativa:</label>
                <Select value={empresaSelecionada || ''} onValueChange={handleEmpresaChange}>
                  <SelectTrigger className="w-full bg-green-50 border-green-300">
                    <Building2 className="w-4 h-4 mr-2 text-green-600" />
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((empresa) => (
                      <SelectItem key={empresa.id} value={empresa.id}>
                        {empresa.apelido || empresa.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </SidebarHeader>
          
          <SidebarContent className="p-3">
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-semibold text-green-700 uppercase tracking-wider px-3 py-3">
                Menu Principal
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      {item.submenu ? (
                        <div>
                          <SidebarMenuButton 
                            onClick={() => toggleSubmenu(item.title)}
                            className={`hover:bg-green-50 hover:text-green-700 transition-all duration-200 rounded-xl mb-1 ${
                              Object.values(item.submenu).some(subitem => location.pathname === subitem.url) ? 'bg-green-50 text-green-700 font-medium shadow-sm' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3 px-4 py-3 w-full">
                              <item.icon className="w-5 h-5" />
                              <span className="font-medium flex-1">{item.title}</span>
                              <span className={`transform transition-transform text-xs ${expandedMenus[item.title] ? 'rotate-90' : ''}`}>
                                ▶
                              </span>
                            </div>
                          </SidebarMenuButton>
                          {expandedMenus[item.title] && (
                            <div className="ml-6 space-y-1">
                              {item.submenu.map((subitem) => (
                                <Link 
                                  key={subitem.title}
                                  to={subitem.url}
                                  className={`block px-4 py-2 text-sm rounded-lg transition-all ${
                                    location.pathname === subitem.url 
                                      ? 'bg-green-100 text-green-800 font-medium' 
                                      : 'text-slate-600 hover:bg-green-50 hover:text-green-700'
                                  }`}
                                >
                                  {subitem.title}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <SidebarMenuButton 
                          asChild 
                          className={`hover:bg-green-50 hover:text-green-700 transition-all duration-200 rounded-xl mb-1 ${
                            location.pathname === item.url ? 'bg-green-50 text-green-700 font-medium shadow-sm' : ''
                          }`}
                        >
                          <Link to={item.url} className="flex items-center gap-3 px-4 py-3">
                            <item.icon className="w-5 h-5" />
                            <span className="font-medium">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {weather && (
              <div className="px-4 py-3 space-y-3 mt-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 flex items-center gap-2">
                      <Thermometer className="w-4 h-4" />
                      Temperatura
                    </span>
                    <span className="font-semibold text-slate-700">{weather.temperature}°C</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 flex items-center gap-2">
                      <Cloud className="w-4 h-4" />
                      Chuva
                    </span>
                    <span className="font-semibold text-slate-700">{weather.precipitation ? 'Sim' : 'Não'}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Sistema Online</span>
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  </div>
                </div>
              </div>
            )}
          </SidebarContent>

          <SidebarFooter className="border-t border-green-200 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-green-100 to-green-200 rounded-xl flex items-center justify-center">
                <span className="text-green-700 font-bold text-sm">
                  {user?.full_name?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm truncate">
                  {user?.full_name || 'Usuário'}
                </p>
                <p className="text-xs text-green-600 truncate">
                  {user?.role === 'admin' ? 'Administrador' : 'Operador'}
                </p>
              </div>
            </div>
            <Button 
              variant="outline" 
              className="w-full gap-2 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => setShowLogoutDialog(true)}
            >
              <LogOut className="w-4 h-4" />
              Sair do Sistema
            </Button>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white/80 backdrop-blur-sm border-b border-green-200 px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
            <SidebarTrigger className="md:hidden hover:bg-green-100 p-2 rounded-lg transition-colors duration-200" />
            <div>
              <h1 className="text-xl font-bold text-green-900">{currentPageName || 'Pesagens'}</h1>
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do Sistema</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja sair do sistema? Você precisará fazer login novamente para acessar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="bg-red-600 hover:bg-red-700">
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}

export const getEmpresaSelecionada = () => {
  return localStorage.getItem('empresa_selecionada_id');
};
