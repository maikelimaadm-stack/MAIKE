import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { Scale, FileText, TrendingUp, Users, LogOut, Package, Shield, FolderOpen, Cloud, Thermometer, ChevronLeft, ChevronRight } from "lucide-react";
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
    title: "Cadastros",
    icon: FolderOpen,
    submenu: [
      {
        title: "Fornecedores/Clientes",
        url: createPageUrl("Fornecedores"),
      },
      {
        title: "Produtos",
        url: createPageUrl("Produtos"),
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [weather, setWeather] = useState(null);

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
    // Buscar clima para Vila Bela da Santíssima Trindade, MT
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
    // Atualizar a cada 30 minutos
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
        <Sidebar className={`border-r border-green-200 bg-white transition-all duration-300 ${sidebarCollapsed ? 'w-16' : ''}`}>
          <SidebarHeader className="border-b border-green-200 p-4">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-3">
                <img 
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                  alt="Fazenda Palmital"
                  className="w-12 h-12 object-contain"
                />
                <div>
                  <h2 className="font-bold text-green-900 text-lg">Fazenda Palmital</h2>
                  <p className="text-xs text-green-700">Sistema de Gestão</p>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                alt="Logo"
                className="w-10 h-10 object-contain mx-auto"
              />
            )}
          </SidebarHeader>
          
          <SidebarContent className="p-3">
            <SidebarGroup>
              {!sidebarCollapsed && (
                <SidebarGroupLabel className="text-xs font-semibold text-green-700 uppercase tracking-wider px-3 py-3">
                  Menu Principal
                </SidebarGroupLabel>
              )}
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
                            title={sidebarCollapsed ? item.title : ''}
                          >
                            <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : 'px-4'} py-3 w-full`}>
                              <item.icon className="w-5 h-5" />
                              {!sidebarCollapsed && (
                                <>
                                  <span className="font-medium flex-1">{item.title}</span>
                                  <span className={`transform transition-transform text-xs ${expandedMenus[item.title] ? 'rotate-90' : ''}`}>
                                    ▶
                                  </span>
                                </>
                              )}
                            </div>
                          </SidebarMenuButton>
                          {!sidebarCollapsed && expandedMenus[item.title] && (
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
                          title={sidebarCollapsed ? item.title : ''}
                        >
                          <Link to={item.url} className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : 'px-4'} py-3`}>
                            <item.icon className="w-5 h-5" />
                            {!sidebarCollapsed && <span className="font-medium">{item.title}</span>}
                          </Link>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {!sidebarCollapsed && (
              <>
                {/* Clima */}
                {weather && (
                  <SidebarGroup className="mt-4">
                    <SidebarGroupLabel className="text-xs font-semibold text-green-700 uppercase tracking-wider px-3 py-3">
                      Clima Atual
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                      <div className="px-4 py-3 space-y-2 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl border border-blue-200">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-blue-700 flex items-center gap-2">
                            <Thermometer className="w-4 h-4 text-blue-600" />
                            Temperatura
                          </span>
                          <span className="font-bold text-blue-900">{weather.temperature}°C</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-blue-700 flex items-center gap-2">
                            <Cloud className="w-4 h-4 text-blue-600" />
                            Chuva
                          </span>
                          <span className="font-bold text-blue-900">{weather.precipitation ? 'Sim' : 'Não'}</span>
                        </div>
                        <div className="text-xs text-blue-600 pt-2 border-t border-blue-200">
                          Vila Bela da Ss. Trindade - MT
                        </div>
                      </div>
                    </SidebarGroupContent>
                  </SidebarGroup>
                )}

                <SidebarGroup className="mt-6">
                  <SidebarGroupLabel className="text-xs font-semibold text-green-700 uppercase tracking-wider px-3 py-3">
                    Informações
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <div className="px-4 py-3 space-y-2 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-green-700 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-green-600" />
                          Sistema Online
                        </span>
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      </div>
                      <div className="text-xs text-green-600 pt-2 border-t border-green-200">
                        <p className="font-semibold">Fazenda Palmital</p>
                        <p className="text-green-500">Vila Bela da Santíssima Trindade (MT)</p>
                      </div>
                    </div>
                  </SidebarGroupContent>
                </SidebarGroup>
              </>
            )}
          </SidebarContent>

          <SidebarFooter className="border-t border-green-200 p-4 space-y-3">
            {!sidebarCollapsed && (
              <>
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
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-full hover:bg-green-50"
            >
              {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
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