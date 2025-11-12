import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Palette, Menu, Settings, Users, Save, RotateCcw, Plus, GripVertical, Edit2, Trash2, Check, ChevronRight, ChevronDown, ArrowUpAZ } from "lucide-react";
import { toast } from "sonner";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const ICONS_DISPONIVEIS = [
  'Home', 'Scale', 'TrendingUp', 'ArrowRightLeft', 'DollarSign', 'BookOpen',
  'FolderOpen', 'FileText', 'Shield', 'Package', 'Users', 'Settings'
];

export default function ConfiguracoesGerais() {
  const [menuItems, setMenuItems] = useState(() => {
    const saved = localStorage.getItem('custom_menu');
    return saved ? JSON.parse(saved) : DEFAULT_MENU;
  });

  const [expandedMenus, setExpandedMenus] = useState({});
  const [showAddMenuItem, setShowAddMenuItem] = useState(false);
  const [showAddSubmenu, setShowAddSubmenu] = useState(false);
  const [showEditMenuItem, setShowEditMenuItem] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [parentMenuForSubmenu, setParentMenuForSubmenu] = useState(null);

  const [newMenuItem, setNewMenuItem] = useState({ title: "", url: "", icon: "Home" });
  const [newSubmenuItem, setNewSubmenuItem] = useState({ title: "", url: "" });

  const saveMenu = (newMenu) => {
    setMenuItems(newMenu);
    localStorage.setItem('custom_menu', JSON.stringify(newMenu));
    toast.success('✅ Menu atualizado! Recarregue a página.');
  };

  const toggleMenu = (menuId) => {
    setExpandedMenus(prev => ({ ...prev, [menuId]: !prev[menuId] }));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(menuItems);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    saveMenu(items);
  };

  const handleAddMenuItem = () => {
    if (!newMenuItem.title || !newMenuItem.url) {
      toast.error('Preencha título e URL!');
      return;
    }

    const newItem = {
      id: `custom-${Date.now()}`,
      title: newMenuItem.title,
      url: newMenuItem.url,
      icon: newMenuItem.icon,
    };

    saveMenu([...menuItems, newItem]);
    setNewMenuItem({ title: "", url: "", icon: "Home" });
    setShowAddMenuItem(false);
  };

  const handleEditMenuItem = () => {
    if (!editingItem.title) {
      toast.error('Preencha o título!');
      return;
    }

    const updatedMenu = menuItems.map(item =>
      item.id === editingItem.id
        ? { ...item, title: editingItem.title, icon: editingItem.icon, url: editingItem.url }
        : item
    );

    saveMenu(updatedMenu);
    setShowEditMenuItem(false);
    setEditingItem(null);
    toast.success('✅ Menu editado!');
  };

  const handleAddSubmenuItem = () => {
    if (!newSubmenuItem.title || !newSubmenuItem.url || !parentMenuForSubmenu) {
      toast.error('Preencha título e URL!');
      return;
    }

    const updatedMenu = menuItems.map(item => {
      if (item.id === parentMenuForSubmenu) {
        const newSubmenu = [
          ...(item.submenu || []),
          { id: `submenu-${Date.now()}`, title: newSubmenuItem.title, url: newSubmenuItem.url }
        ];

        return { ...item, submenu: newSubmenu };
      }
      return item;
    });

    saveMenu(updatedMenu);
    setNewSubmenuItem({ title: "", url: "" });
    setParentMenuForSubmenu(null);
    setShowAddSubmenu(false);
  };

  const handleOrdenarAlfabeticamente = () => {
    if (window.confirm('Ordenar todos os menus e submenus alfabeticamente?')) {
      const sortRecursive = (items) => {
        return items.map(item => {
          const newItem = { ...item };
          if (newItem.submenu) {
            newItem.submenu = sortRecursive(newItem.submenu);
          }
          return newItem;
        }).sort((a, b) => a.title.localeCompare(b.title));
      };

      saveMenu(sortRecursive(menuItems));
      toast.success('✅ Menus ordenados alfabeticamente!');
    }
  };

  const handleDeleteMenuItem = (id) => {
    if (window.confirm('Deseja excluir este item?')) {
      saveMenu(menuItems.filter(item => item.id !== id));
    }
  };

  const handleDeleteSubmenuItem = (menuId, submenuId) => {
    if (window.confirm('Deseja excluir este subitem?')) {
      const updatedMenu = menuItems.map(item => {
        if (item.id === menuId) {
          return {
            ...item,
            submenu: item.submenu.filter(sub => sub.id !== submenuId)
          };
        }
        return item;
      });
      saveMenu(updatedMenu);
    }
  };

  const handleResetMenu = () => {
    if (window.confirm('⚠️ Resetar menu? Todas personalizações serão perdidas.')) {
      saveMenu(DEFAULT_MENU);
      toast.success('Menu resetado!');
    }
  };

  const handleReloadPage = () => {
    window.location.reload();
  };

  const openEditDialog = (item) => {
    setEditingItem({ ...item });
    setShowEditMenuItem(true);
  };

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div className="bg-white border-b border-slate-200 -m-6 mb-6 p-6">
        <h1 className="text-2xl font-bold text-slate-900">Configurações Gerais</h1>
        <p className="text-sm text-slate-600 mt-1">Personalize menus, aparência e parâmetros do sistema</p>
      </div>

      <Tabs defaultValue="menus" className="w-full">
        <TabsList className="grid w-full max-w-3xl grid-cols-4 bg-white border border-slate-200">
          <TabsTrigger value="menus" className="gap-2 text-sm">
            <Menu className="w-4 h-4" />
            Menus
          </TabsTrigger>
          <TabsTrigger value="identidade" className="gap-2 text-sm">
            <Palette className="w-4 h-4" />
            Identidade
          </TabsTrigger>
          <TabsTrigger value="parametros" className="gap-2 text-sm">
            <Settings className="w-4 h-4" />
            Parâmetros
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-2 text-sm">
            <Users className="w-4 h-4" />
            Usuários
          </TabsTrigger>
        </TabsList>

        {/* ABA MENUS */}
        <TabsContent value="menus" className="space-y-4 mt-6">
          <Card className="shadow-lg border-slate-200">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-emerald-50 border-b">
              <CardTitle className="text-lg">Editor de Menus</CardTitle>
              <CardDescription className="text-sm">
                Arraste para reordenar ou use os botões de ação
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => setShowAddMenuItem(true)} size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-4 h-4" />
                  Novo Menu Principal
                </Button>
                <Button onClick={() => setShowAddSubmenu(true)} variant="outline" size="sm" className="gap-2">
                  <Plus className="w-4 h-4" />
                  Novo Submenu
                </Button>
                <Button onClick={handleOrdenarAlfabeticamente} variant="outline" size="sm" className="gap-2">
                  <ArrowUpAZ className="w-4 h-4" />
                  Ordenar A-Z
                </Button>
                <Button onClick={handleResetMenu} variant="outline" size="sm" className="gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Resetar Padrão
                </Button>
                <Button onClick={handleReloadPage} variant="outline" size="sm" className="gap-2 ml-auto">
                  <Save className="w-4 h-4" />
                  Recarregar Página
                </Button>
              </div>

              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="menu">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                      {menuItems.map((item, index) => (
                        <Draggable key={item.id} draggableId={item.id} index={index}>
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                            >
                              <div className="flex items-center gap-3">
                                <div {...provided.dragHandleProps}>
                                  <GripVertical className="w-5 h-5 text-slate-400 cursor-move hover:text-slate-600" />
                                </div>
                                
                                {item.submenu && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => toggleMenu(item.id)}
                                    className="h-8 w-8"
                                  >
                                    {expandedMenus[item.id] ? (
                                      <ChevronDown className="w-4 h-4" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4" />
                                    )}
                                  </Button>
                                )}
                                
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-sm text-slate-900">{item.title}</div>
                                  {item.url && <div className="text-xs text-slate-500">Página: {item.url}</div>}
                                  {item.submenu && (
                                    <div className="text-xs text-emerald-600 font-medium mt-0.5">
                                      {item.submenu.length} subitem{item.submenu.length !== 1 ? 's' : ''}
                                    </div>
                                  )}
                                </div>
                                
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditDialog(item)}
                                  className="h-8 w-8 text-blue-600 hover:bg-blue-50"
                                  title="Editar"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteMenuItem(item.id)}
                                  className="h-8 w-8 text-red-600 hover:bg-red-50"
                                  title="Excluir"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>

                              {/* SUBMENU */}
                              {item.submenu && item.submenu.length > 0 && expandedMenus[item.id] && (
                                <div className="ml-12 mt-3 space-y-2 border-l-2 border-emerald-200 pl-4">
                                  {item.submenu.map((sub) => (
                                    <div key={sub.id} className="flex items-center justify-between py-2 px-3 bg-emerald-50 rounded-lg border border-emerald-100">
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-slate-900">{sub.title}</div>
                                        {sub.url && <div className="text-xs text-slate-500">Página: {sub.url}</div>}
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDeleteSubmenuItem(item.id, sub.id)}
                                        className="h-7 w-7 text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA IDENTIDADE */}
        <TabsContent value="identidade" className="space-y-4 mt-6">
          <Card className="shadow-lg border-slate-200">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-purple-50 border-b">
              <CardTitle className="text-lg">Identidade Visual</CardTitle>
              <CardDescription className="text-sm">
                Configure logo, cores e tema do sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Logo do Sistema</Label>
                <Input type="file" accept="image/*" className="cursor-pointer" />
                <p className="text-xs text-slate-500">Formato recomendado: PNG transparente, 200x50px</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Cor Principal</Label>
                  <div className="flex gap-3">
                    <Input type="color" defaultValue="#10b981" className="w-16 h-10" />
                    <Input defaultValue="#10b981" className="flex-1" />
                  </div>
                </div>
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Cor Secundária</Label>
                  <div className="flex gap-3">
                    <Input type="color" defaultValue="#3b82f6" className="w-16 h-10" />
                    <Input defaultValue="#3b82f6" className="flex-1" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="space-y-1">
                  <Label className="text-sm font-semibold">Modo Escuro</Label>
                  <p className="text-xs text-slate-500">Ativar tema escuro no sistema</p>
                </div>
                <Switch />
              </div>

              <div className="pt-4 border-t">
                <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                  <Save className="w-4 h-4" />
                  Salvar Alterações
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA PARÂMETROS */}
        <TabsContent value="parametros" className="space-y-4 mt-6">
          <Card className="shadow-lg border-slate-200">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 border-b">
              <CardTitle className="text-lg">Parâmetros do Sistema</CardTitle>
              <CardDescription className="text-sm">
                Configurações gerais e preferências
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Nome da Empresa</Label>
                <Input placeholder="Digite o nome da empresa" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Fuso Horário</Label>
                  <Select defaultValue="america-sp">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="america-sp">América/São Paulo (GMT-3)</SelectItem>
                      <SelectItem value="america-manaus">América/Manaus (GMT-4)</SelectItem>
                      <SelectItem value="america-cuiaba">América/Cuiabá (GMT-4)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Idioma</Label>
                  <Select defaultValue="pt-br">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pt-br">Português (BR)</SelectItem>
                      <SelectItem value="en">English (US)</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="pt-4 border-t">
                <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                  <Save className="w-4 h-4" />
                  Salvar Parâmetros
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA USUÁRIOS */}
        <TabsContent value="usuarios" className="space-y-4 mt-6">
          <Card className="shadow-lg border-slate-200">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-amber-50 border-b">
              <CardTitle className="text-lg">Gestão de Usuários</CardTitle>
              <CardDescription className="text-sm">
                Controle de acessos e permissões
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-slate-700">
                  Para gerenciar usuários e permissões, acesse a página <Link to={createPageUrl("Usuarios")} className="font-semibold text-blue-600 hover:underline">Usuários</Link> no menu principal.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* DIALOG: NOVO MENU PRINCIPAL */}
      <Dialog open={showAddMenuItem} onOpenChange={setShowAddMenuItem}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg">Novo Menu Principal</DialogTitle>
            <DialogDescription>Adicione um novo item ao menu de navegação</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Título do Menu *</Label>
              <Input 
                value={newMenuItem.title} 
                onChange={(e) => setNewMenuItem({ ...newMenuItem, title: e.target.value })} 
                placeholder="Ex: Relatórios" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Página (URL) *</Label>
              <Input 
                value={newMenuItem.url} 
                onChange={(e) => setNewMenuItem({ ...newMenuItem, url: e.target.value })} 
                placeholder="Ex: Relatorios" 
              />
              <p className="text-xs text-slate-500">Nome da página sem espaços</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Ícone</Label>
              <Select value={newMenuItem.icon} onValueChange={(v) => setNewMenuItem({ ...newMenuItem, icon: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ICONS_DISPONIVEIS.map(iconName => (
                    <SelectItem key={iconName} value={iconName}>{iconName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowAddMenuItem(false)}>Cancelar</Button>
              <Button onClick={handleAddMenuItem} className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Menu
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: NOVO SUBMENU */}
      <Dialog open={showAddSubmenu} onOpenChange={setShowAddSubmenu}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg">Novo Submenu</DialogTitle>
            <DialogDescription>Adicione um item dentro de um menu existente</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Menu Principal *</Label>
              <Select value={parentMenuForSubmenu || ''} onValueChange={setParentMenuForSubmenu}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o menu principal" />
                </SelectTrigger>
                <SelectContent>
                  {menuItems.map(item => (
                    <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Título do Submenu *</Label>
              <Input 
                value={newSubmenuItem.title} 
                onChange={(e) => setNewSubmenuItem({ ...newSubmenuItem, title: e.target.value })} 
                placeholder="Ex: Plano de Contas" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Página (URL) *</Label>
              <Input 
                value={newSubmenuItem.url} 
                onChange={(e) => setNewSubmenuItem({ ...newSubmenuItem, url: e.target.value })} 
                placeholder="Ex: PlanoContas" 
              />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowAddSubmenu(false)}>Cancelar</Button>
              <Button onClick={handleAddSubmenuItem} className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Submenu
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: EDITAR MENU */}
      <Dialog open={showEditMenuItem} onOpenChange={setShowEditMenuItem}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg">Editar Menu</DialogTitle>
            <DialogDescription>Altere as propriedades do menu</DialogDescription>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Título *</Label>
                <Input 
                  value={editingItem.title} 
                  onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })} 
                />
              </div>
              {editingItem.url !== undefined && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Página (URL)</Label>
                  <Input 
                    value={editingItem.url || ''} 
                    onChange={(e) => setEditingItem({ ...editingItem, url: e.target.value })} 
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Ícone</Label>
                <Select value={editingItem.icon} onValueChange={(v) => setEditingItem({ ...editingItem, icon: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICONS_DISPONIVEIS.map(iconName => (
                      <SelectItem key={iconName} value={iconName}>{iconName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setShowEditMenuItem(false)}>Cancelar</Button>
                <Button onClick={handleEditMenuItem} className="bg-emerald-600 hover:bg-emerald-700">
                  <Check className="w-4 h-4 mr-2" />
                  Salvar Alterações
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const getEmpresaSelecionada = () => {
  return localStorage.getItem('empresa_selecionada_id');
};