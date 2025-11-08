import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { Scale, FileText, Users, LogOut, Package, Shield, FolderOpen, Cloud, Thermometer, Building2, TrendingUp, ArrowRightLeft, DollarSign, Home, BookOpen, Settings, Plus, GripVertical, Edit2, Trash2, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const iconsMap = {
  Home, Scale, TrendingUp, ArrowRightLeft, DollarSign, BookOpen, FolderOpen, FileText, Shield, Package, Users
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
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [weather, setWeather] = useState(null);
  const [menuItems, setMenuItems] = useState(() => {
    const saved = localStorage.getItem('custom_menu');
    return saved ? JSON.parse(saved) : DEFAULT_MENU;
  });
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showMenuEditor, setShowMenuEditor] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newMenuItem, setNewMenuItem] = useState({ title: "", url: "", icon: "Home" });
  
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

  const toggleSubmenu = (id) => {
    setExpandedMenus(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const saveMenu = (newMenu) => {
    setMenuItems(newMenu);
    localStorage.setItem('custom_menu', JSON.stringify(newMenu));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(menuItems);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    saveMenu(items);
  };

  const handleAddMenuItem = () => {
    const newItem = {
      id: `custom-${Date.now()}`,
      title: newMenuItem.title,
      url: newMenuItem.url,
      icon: newMenuItem.icon,
    };
    saveMenu([...menuItems, newItem]);
    setNewMenuItem({ title: "", url: "", icon: "Home" });
    setShowAddDialog(false);
  };

  const handleDeleteMenuItem = (id) => {
    saveMenu(menuItems.filter(item => item.id !== id));
  };

  const handleResetMenu = () => {
    if (window.confirm('Resetar menu para o padrão?')) {
      saveMenu(DEFAULT_MENU);
      setShowMenuEditor(false);
    }
  };

  const renderMenuItem = (item, index) => {
    const Icon = iconsMap[item.icon] || Home;
    const isActive = item.url && location.pathname === createPageUrl(item.url);
    const hasActiveSubmenu = item.submenu?.some(sub => sub.url && location.pathname === createPageUrl(sub.url));

    return (
      <SidebarMenuItem key={item.id}>
        {item.submenu ? (
          <div>
            <SidebarMenuButton 
              onClick={() => toggleSubmenu(item.id)}
              className={`hover:bg-green-50 hover:text-green-700 transition-all duration-200 rounded-xl mb-1 ${
                hasActiveSubmenu ? 'bg-green-50 text-green-700 font-medium shadow-sm' : ''
              }`}
            >
              <div className="flex items-center gap-3 px-4 py-3 w-full">
                <Icon className="w-5 h-5" />
                <span className="font-medium flex-1">{item.title}</span>
                <ChevronRight className={`w-4 h-4 transform transition-transform ${expandedMenus[item.id] ? 'rotate-90' : ''}`} />
              </div>
            </SidebarMenuButton>
            {expandedMenus[item.id] && (
              <div className="ml-6 space-y-1">
                {item.submenu.map((subitem) => (
                  <Link 
                    key={subitem.id}
                    to={createPageUrl(subitem.url)}
                    className={`block px-4 py-2 text-sm rounded-lg transition-all ${
                      location.pathname === createPageUrl(subitem.url)
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
              isActive ? 'bg-green-50 text-green-700 font-medium shadow-sm' : ''
            }`}
          >
            <Link to={createPageUrl(item.url)} className="flex items-center gap-3 px-4 py-3">
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.title}</span>
            </Link>
          </SidebarMenuButton>
        )}
      </SidebarMenuItem>
    );
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
              <div className="flex items-center justify-between px-3 py-3">
                <SidebarGroupLabel className="text-xs font-semibold text-green-700 uppercase tracking-wider">
                  Menu Principal
                </SidebarGroupLabel>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6"
                  onClick={() => setShowMenuEditor(true)}
                  title="Personalizar Menu"
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </div>
              <SidebarGroupContent>
                <SidebarMenu>
                  {menuItems.map((item, index) => renderMenuItem(item, index))}
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
              <h1 className="text-xl font-bold text-green-900">{currentPageName || 'Dashboard'}</h1>
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>

      <Dialog open={showMenuEditor} onOpenChange={setShowMenuEditor}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Editor de Menu
            </DialogTitle>
            <DialogDescription>
              Arraste para reordenar, clique com botão direito para editar ou excluir
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-between">
              <Button onClick={() => setShowAddDialog(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Novo Item
              </Button>
              <Button variant="outline" onClick={handleResetMenu}>
                Resetar Padrão
              </Button>
            </div>

            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="menu">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                    {menuItems.map((item, index) => (
                      <Draggable key={item.id} draggableId={item.id} index={index}>
                        {(provided) => (
                          <ContextMenu>
                            <ContextMenuTrigger>
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border hover:bg-slate-100 transition-colors"
                              >
                                <GripVertical className="w-5 h-5 text-slate-400" />
                                {React.createElement(iconsMap[item.icon] || Home, { className: "w-5 h-5 text-slate-600" })}
                                <span className="flex-1 font-medium">{item.title}</span>
                                {item.submenu && <span className="text-xs text-slate-500">({item.submenu.length} subitens)</span>}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => handleDeleteMenuItem(item.id)} className="text-red-600">
                                <Trash2 className="w-4 h-4 mr-2" />
                                Excluir
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Item ao Menu</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={newMenuItem.title} onChange={(e) => setNewMenuItem({ ...newMenuItem, title: e.target.value })} placeholder="Nome do item" />
            </div>
            <div className="space-y-2">
              <Label>Página (URL)</Label>
              <Input value={newMenuItem.url} onChange={(e) => setNewMenuItem({ ...newMenuItem, url: e.target.value })} placeholder="NomeDaPagina" />
            </div>
            <div className="space-y-2">
              <Label>Ícone</Label>
              <Select value={newMenuItem.icon} onValueChange={(v) => setNewMenuItem({ ...newMenuItem, icon: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(iconsMap).map(iconName => (
                    <SelectItem key={iconName} value={iconName}>{iconName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancelar</Button>
              <Button onClick={handleAddMenuItem} disabled={!newMenuItem.title || !newMenuItem.url}>Adicionar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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