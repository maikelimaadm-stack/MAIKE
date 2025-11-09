import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Palette, Menu, Settings, Users, Save, RotateCcw, Plus, GripVertical, Edit2, Trash2 } from "lucide-react";
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
  const [editingItem, setEditingItem] = useState(null);
  const [parentMenuForSubmenu, setParentMenuForSubmenu] = useState(null);

  const [newMenuItem, setNewMenuItem] = useState({ title: "", url: "", icon: "Home" });
  const [newSubmenuItem, setNewSubmenuItem] = useState({ title: "", url: "" });

  const saveMenu = (newMenu) => {
    setMenuItems(newMenu);
    localStorage.setItem('custom_menu', JSON.stringify(newMenu));
    toast.success('✅ Menu atualizado! Recarregue a página para ver as mudanças.');
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
    if (window.confirm('Deseja excluir este item do menu?')) {
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
    if (window.confirm('⚠️ Resetar menu para o padrão? Todas as personalizações serão perdidas.')) {
      saveMenu(DEFAULT_MENU);
      toast.success('Menu resetado!');
    }
  };

  const handleReloadPage = () => {
    window.location.reload();
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configurações Gerais do Sistema</h1>
        <p className="text-sm text-slate-600">Personalize menus, aparência e parâmetros gerais</p>
      </div>

      <Tabs defaultValue="menus" className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="menus" className="gap-2 text-xs">
            <Menu className="w-3.5 h-3.5" />
            Menus
          </TabsTrigger>
          <TabsTrigger value="identidade" className="gap-2 text-xs">
            <Palette className="w-3.5 h-3.5" />
            Identidade
          </TabsTrigger>
          <TabsTrigger value="parametros" className="gap-2 text-xs">
            <Settings className="w-3.5 h-3.5" />
            Parâmetros
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-2 text-xs">
            <Users className="w-3.5 h-3.5" />
            Usuários
          </TabsTrigger>
        </TabsList>

        {/* ABA: MENUS E NAVEGAÇÃO */}
        <TabsContent value="menus" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editor de Menus e Navegação</CardTitle>
              <CardDescription className="text-xs">
                Arraste para reordenar, adicione novos itens ou edite os existentes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button onClick={() => setShowAddMenuItem(true)} size="sm" className="gap-2">
                  <Plus className="w-3.5 h-3.5" />
                  Novo Menu
                </Button>
                <Button onClick={() => setShowAddSubmenu(true)} variant="outline" size="sm" className="gap-2">
                  <Plus className="w-3.5 h-3.5" />
                  Novo Submenu
                </Button>
                <Button onClick={handleResetMenu} variant="outline" size="sm">
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Resetar Padrão
                </Button>
                <Button onClick={handleReloadPage} variant="outline" size="sm" className="ml-auto">
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
                              className="bg-white border rounded-lg p-3 space-y-2"
                            >
                              <div className="flex items-center gap-3">
                                <div {...provided.dragHandleProps}>
                                  <GripVertical className="w-4 h-4 text-slate-400 cursor-move" />
                                </div>
                                <div className="flex-1">
                                  <div className="font-semibold text-sm">{item.title}</div>
                                  {item.url && <div className="text-xs text-slate-500">URL: {item.url}</div>}
                                  {item.submenu && (
                                    <div className="text-xs text-slate-500">
                                      {item.submenu.length} subitem(ns)
                                    </div>
                                  )}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteMenuItem(item.id)}
                                  className="text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>

                              {item.submenu && item.submenu.length > 0 && (
                                <div className="ml-8 space-y-1 border-l-2 border-slate-200 pl-3">
                                  {item.submenu.map((sub) => (
                                    <div key={sub.id} className="flex items-center justify-between py-1">
                                      <div>
                                        <div className="text-xs font-medium">{sub.title}</div>
                                        <div className="text-xs text-slate-500">URL: {sub.url}</div>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDeleteSubmenuItem(item.id, sub.id)}
                                        className="text-red-600 hover:bg-red-50 h-7 w-7"
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

        {/* ABA: IDENTIDADE VISUAL */}
        <TabsContent value="identidade" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identidade Visual</CardTitle>
              <CardDescription className="text-xs">
                Configure logo, cores e tema do sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Logo do Sistema</Label>
                <Input type="file" accept="image/*" className="h-9 text-xs" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Cor Principal</Label>
                  <Input type="color" defaultValue="#10b981" className="h-9" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Cor Secundária</Label>
                  <Input type="color" defaultValue="#3b82f6" className="h-9" />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-xs">Modo Escuro</Label>
                  <p className="text-xs text-slate-500">Ativar tema escuro no sistema</p>
                </div>
                <Switch />
              </div>

              <Button size="sm" className="gap-2">
                <Save className="w-3.5 h-3.5" />
                Salvar Configurações
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA: PARÂMETROS GERAIS */}
        <TabsContent value="parametros" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Parâmetros Gerais</CardTitle>
              <CardDescription className="text-xs">
                Configurações globais do sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Nome da Empresa</Label>
                <Input placeholder="Minha Empresa Ltda" className="h-9 text-xs" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Fuso Horário</Label>
                  <Select defaultValue="america-sp">
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="america-sp" className="text-xs">América/São Paulo (UTC-3)</SelectItem>
                      <SelectItem value="america-manaus" className="text-xs">América/Manaus (UTC-4)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Idioma</Label>
                  <Select defaultValue="pt-br">
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pt-br" className="text-xs">Português (Brasil)</SelectItem>
                      <SelectItem value="en" className="text-xs">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button size="sm" className="gap-2">
                <Save className="w-3.5 h-3.5" />
                Salvar Configurações
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA: USUÁRIOS E PERMISSÕES */}
        <TabsContent value="usuarios" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Usuários e Permissões</CardTitle>
              <CardDescription className="text-xs">
                Gerencie acessos e perfis de usuário
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">
                Configure perfis e permissões na aba <strong>Usuários</strong> do menu principal.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* DIALOG: ADICIONAR MENU */}
      <Dialog open={showAddMenuItem} onOpenChange={setShowAddMenuItem}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Adicionar Novo Menu</DialogTitle>
            <DialogDescription className="text-xs">
              Crie um novo item no menu principal
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Título do Menu</Label>
              <Input
                value={newMenuItem.title}
                onChange={(e) => setNewMenuItem({ ...newMenuItem, title: e.target.value })}
                placeholder="Ex: Relatórios"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Página (URL)</Label>
              <Input
                value={newMenuItem.url}
                onChange={(e) => setNewMenuItem({ ...newMenuItem, url: e.target.value })}
                placeholder="Ex: Relatorios"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Ícone</Label>
              <Select value={newMenuItem.icon} onValueChange={(v) => setNewMenuItem({ ...newMenuItem, icon: v })}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ICONS_DISPONIVEIS.map(iconName => (
                    <SelectItem key={iconName} value={iconName} className="text-xs">{iconName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddMenuItem(false)} size="sm">
                Cancelar
              </Button>
              <Button onClick={handleAddMenuItem} size="sm">
                Adicionar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: ADICIONAR SUBMENU */}
      <Dialog open={showAddSubmenu} onOpenChange={setShowAddSubmenu}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Adicionar Submenu</DialogTitle>
            <DialogDescription className="text-xs">
              Adicione um submenu a um menu existente
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Menu Principal</Label>
              <Select value={parentMenuForSubmenu || ''} onValueChange={setParentMenuForSubmenu}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o menu" />
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
            <div className="space-y-2">
              <Label className="text-xs">Título do Submenu</Label>
              <Input
                value={newSubmenuItem.title}
                onChange={(e) => setNewSubmenuItem({ ...newSubmenuItem, title: e.target.value })}
                placeholder="Ex: Relatório de Vendas"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Página (URL)</Label>
              <Input
                value={newSubmenuItem.url}
                onChange={(e) => setNewSubmenuItem({ ...newSubmenuItem, url: e.target.value })}
                placeholder="Ex: RelatorioVendas"
                className="h-9 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddSubmenu(false)} size="sm">
                Cancelar
              </Button>
              <Button onClick={handleAddSubmenuItem} size="sm">
                Adicionar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}