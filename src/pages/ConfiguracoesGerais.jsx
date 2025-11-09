import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Palette, Menu, Settings, Users, Save, RotateCcw, Plus, GripVertical, Edit2, Trash2, Check, X } from "lucide-react";
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
        return {
          ...item,
          submenu: [
            ...(item.submenu || []),
            { id: `submenu-${Date.now()}`, title: newSubmenuItem.title, url: newSubmenuItem.url }
          ]
        };
      }
      return item;
    });

    saveMenu(updatedMenu);
    setNewSubmenuItem({ title: "", url: "" });
    setParentMenuForSubmenu(null);
    setShowAddSubmenu(false);
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
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Configurações Gerais</h1>
        <p className="text-xs text-slate-600">Personalize menus, aparência e parâmetros</p>
      </div>

      <Tabs defaultValue="menus" className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-4 h-8">
          <TabsTrigger value="menus" className="gap-1.5 text-xs h-7">
            <Menu className="w-3 h-3" />
            Menus
          </TabsTrigger>
          <TabsTrigger value="identidade" className="gap-1.5 text-xs h-7">
            <Palette className="w-3 h-3" />
            Identidade
          </TabsTrigger>
          <TabsTrigger value="parametros" className="gap-1.5 text-xs h-7">
            <Settings className="w-3 h-3" />
            Parâmetros
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-1.5 text-xs h-7">
            <Users className="w-3 h-3" />
            Usuários
          </TabsTrigger>
        </TabsList>

        <TabsContent value="menus" className="space-y-3 mt-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Editor de Menus</CardTitle>
              <CardDescription className="text-xs">
                Arraste para reordenar, edite ou adicione novos itens
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button onClick={() => setShowAddMenuItem(true)} size="sm" className="h-8 gap-1 text-xs">
                  <Plus className="w-3 h-3" />
                  Novo Menu
                </Button>
                <Button onClick={() => setShowAddSubmenu(true)} variant="outline" size="sm" className="h-8 gap-1 text-xs">
                  <Plus className="w-3 h-3" />
                  Novo Submenu
                </Button>
                <Button onClick={handleResetMenu} variant="outline" size="sm" className="h-8 text-xs">
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Resetar
                </Button>
                <Button onClick={handleReloadPage} variant="outline" size="sm" className="h-8 text-xs ml-auto">
                  Recarregar
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
                              className="bg-white border rounded p-2.5 space-y-1.5 shadow-sm"
                            >
                              <div className="flex items-center gap-2">
                                <div {...provided.dragHandleProps}>
                                  <GripVertical className="w-3.5 h-3.5 text-slate-400 cursor-move" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-xs">{item.title}</div>
                                  {item.url && <div className="text-[10px] text-slate-500">URL: {item.url}</div>}
                                  {item.submenu && (
                                    <div className="text-[10px] text-slate-500">
                                      {item.submenu.length} subitem(ns)
                                    </div>
                                  )}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditDialog(item)}
                                  className="h-7 w-7 text-blue-600 hover:bg-blue-50"
                                  title="Editar"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteMenuItem(item.id)}
                                  className="h-7 w-7 text-red-600 hover:bg-red-50"
                                  title="Excluir"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>

                              {item.submenu && item.submenu.length > 0 && (
                                <div className="ml-6 space-y-1 border-l-2 border-slate-200 pl-2">
                                  {item.submenu.map((sub) => (
                                    <div key={sub.id} className="flex items-center justify-between py-1">
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium">{sub.title}</div>
                                        <div className="text-[10px] text-slate-500">URL: {sub.url}</div>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDeleteSubmenuItem(item.id, sub.id)}
                                        className="h-6 w-6 text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 className="w-3 h-3" />
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

        <TabsContent value="identidade" className="space-y-3 mt-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Identidade Visual</CardTitle>
              <CardDescription className="text-xs">
                Configure logo, cores e tema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Logo do Sistema</Label>
                <Input type="file" accept="image/*" className="h-8 text-xs" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Cor Principal</Label>
                  <Input type="color" defaultValue="#10b981" className="h-8" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Cor Secundária</Label>
                  <Input type="color" defaultValue="#3b82f6" className="h-8" />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-xs">Modo Escuro</Label>
                  <p className="text-[10px] text-slate-500">Ativar tema escuro</p>
                </div>
                <Switch />
              </div>

              <Button size="sm" className="h-8 gap-1 text-xs">
                <Save className="w-3 h-3" />
                Salvar
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parametros" className="space-y-3 mt-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Parâmetros Gerais</CardTitle>
              <CardDescription className="text-xs">
                Configurações globais
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Nome da Empresa</Label>
                <Input placeholder="Minha Empresa" className="h-8 text-xs" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fuso Horário</Label>
                  <Select defaultValue="america-sp">
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="america-sp" className="text-xs">América/São Paulo</SelectItem>
                      <SelectItem value="america-manaus" className="text-xs">América/Manaus</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Idioma</Label>
                  <Select defaultValue="pt-br">
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pt-br" className="text-xs">Português (BR)</SelectItem>
                      <SelectItem value="en" className="text-xs">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button size="sm" className="h-8 gap-1 text-xs">
                <Save className="w-3 h-3" />
                Salvar
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usuarios" className="space-y-3 mt-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Usuários e Permissões</CardTitle>
              <CardDescription className="text-xs">
                Gerencie acessos
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">
                Configure na aba <strong>Usuários</strong> do menu.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* DIALOG: ADICIONAR MENU */}
      <Dialog open={showAddMenuItem} onOpenChange={setShowAddMenuItem}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Novo Menu</DialogTitle>
            <DialogDescription className="text-xs">
              Crie um novo item no menu principal
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            <div className="space-y-1.5">
              <Label className="text-xs">Título *</Label>
              <Input
                value={newMenuItem.title}
                onChange={(e) => setNewMenuItem({ ...newMenuItem, title: e.target.value })}
                placeholder="Ex: Relatórios"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Página (URL) *</Label>
              <Input
                value={newMenuItem.url}
                onChange={(e) => setNewMenuItem({ ...newMenuItem, url: e.target.value })}
                placeholder="Ex: Relatorios"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ícone</Label>
              <Select value={newMenuItem.icon} onValueChange={(v) => setNewMenuItem({ ...newMenuItem, icon: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ICONS_DISPONIVEIS.map(iconName => (
                    <SelectItem key={iconName} value={iconName} className="text-xs">{iconName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddMenuItem(false)} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={handleAddMenuItem} size="sm" className="h-8 text-xs">
                Adicionar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: EDITAR MENU */}
      <Dialog open={showEditMenuItem} onOpenChange={setShowEditMenuItem}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Editar Menu</DialogTitle>
            <DialogDescription className="text-xs">
              Altere o título, URL ou ícone
            </DialogDescription>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <Label className="text-xs">Título *</Label>
                <Input
                  value={editingItem.title}
                  onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              {editingItem.url !== undefined && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Página (URL)</Label>
                  <Input
                    value={editingItem.url || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, url: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Ícone</Label>
                <Select value={editingItem.icon} onValueChange={(v) => setEditingItem({ ...editingItem, icon: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICONS_DISPONIVEIS.map(iconName => (
                      <SelectItem key={iconName} value={iconName} className="text-xs">{iconName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowEditMenuItem(false)} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button onClick={handleEditMenuItem} size="sm" className="h-8 text-xs">
                  <Check className="w-3 h-3 mr-1" />
                  Salvar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG: ADICIONAR SUBMENU */}
      <Dialog open={showAddSubmenu} onOpenChange={setShowAddSubmenu}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Novo Submenu</DialogTitle>
            <DialogDescription className="text-xs">
              Adicione submenu a um menu
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            <div className="space-y-1.5">
              <Label className="text-xs">Menu Principal</Label>
              <Select value={parentMenuForSubmenu || ''} onValueChange={setParentMenuForSubmenu}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {menuItems.map(item => (
                    <SelectItem key={item.id} value={item.id} className="text-xs">
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Título *</Label>
              <Input
                value={newSubmenuItem.title}
                onChange={(e) => setNewSubmenuItem({ ...newSubmenuItem, title: e.target.value })}
                placeholder="Ex: Relatório de Vendas"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Página (URL) *</Label>
              <Input
                value={newSubmenuItem.url}
                onChange={(e) => setNewSubmenuItem({ ...newSubmenuItem, url: e.target.value })}
                placeholder="Ex: RelatorioVendas"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddSubmenu(false)} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={handleAddSubmenuItem} size="sm" className="h-8 text-xs">
                Adicionar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}