import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { listEmpresas } from "@/services/empresaService";
import { getCurrentUser, getCachedUser, listarPermissoes, encerrarSessao, permissaoDoUsuario } from "@/services/sessionService";
import {
  Users, LogOut, Package, Shield, FolderOpen, Map, ChevronDown, Menu, Search, X, EyeOff, Eye } from
"lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from
"@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle } from
"@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from
"@/components/ui/dialog";

import SplashScreen from "@/components/common/SplashScreen";
import BackButton from "@/components/common/BackButton";
import PermissionAlertDialog from "@/components/common/PermissionAlertDialog";
import { DEFAULT_MENU, flattenMenuPages, findMenuItemByUrl, getAllPages } from "@/lib/menuConfig";
import { ACTION_LABELS, canAccessModule, canAccessPage, canPerformAction, detectPermissionAction, normalizePermissionRecord } from "@/lib/permissions";

import { AnimatePresence, motion } from "framer-motion";

const iconsMap = { Map, Package, FolderOpen, Shield, Users };

const PRIMARY_PAGE = "MapaGeral";

const FIXED_MOBILE_NAV_ITEMS = [
{ id: "pec-mapa-geral", url: "MapaGeral", label: "Mapa Geral", Icon: Map },
{ id: "pec-mapa-cadastro", url: "MapaCadastro", label: "Cadastro do Mapa", Icon: FolderOpen },
{ id: "pec-lotes", url: "CadastroLotes", label: "Lotes", Icon: Package },
{ id: "pec-bebedouros", url: "Bebedouros", label: "Bebedouros", Icon: Shield }];


export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userPermissions, setUserPermissions] = useState(null);
  const [permissionDialog, setPermissionDialog] = useState({ open: false, title: "", description: "" });
  const permissionRedirectRef = useRef(null);
  const isChangingEmpresa = useRef(false);
  const [menuOculto, setMenuOculto] = useState(() => {
    return localStorage.getItem('menu_oculto') === 'true';
  });

  // Prevenir tradução automática do navegador
  React.useEffect(() => {
    document.documentElement.setAttribute('translate', 'no');
    document.documentElement.setAttribute('lang', 'pt-BR');
  }, []);

  // Splash: mínimo 5s; só esconder quando o app estiver pronto
  const [minTimePassed, setMinTimePassed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinTimePassed(true), 5000);
    return () => clearTimeout(t);
  }, []);

  const menuItems = DEFAULT_MENU;

  const [empresaSelecionada, setEmpresaSelecionada] = useState(() => {
    return localStorage.getItem('empresa_selecionada_id') || null;
  });

  const { data: empresas = [], isLoading: empresasLoading } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => listEmpresas(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  // Ocultar splash somente após 5s mínimos + dados prontos
  useEffect(() => {
    if (minTimePassed && !authLoading && !empresasLoading) {
      setShowSplash(false);
    }
  }, [minTimePassed, authLoading, empresasLoading]);

  const empresaAtual = React.useMemo(() => {
    if (!empresaSelecionada || !empresas.length) return null;
    return empresas.find((e) => e.id === empresaSelecionada) || null;
  }, [empresaSelecionada, empresas]);

  // Selecionar primeira empresa SOMENTE UMA VEZ
  useEffect(() => {
    if (!empresaSelecionada && empresas.length > 0 && !isChangingEmpresa.current) {
      const primeiraEmpresa = empresas[0].id;
      setEmpresaSelecionada(primeiraEmpresa);
      localStorage.setItem('empresa_selecionada_id', primeiraEmpresa);
    }
  }, [empresas.length]); // Apenas quando o tamanho mudar

  const handleEmpresaChange = (empresaId) => {
    if (empresaId === empresaSelecionada) return;
    isChangingEmpresa.current = true;
    setEmpresaSelecionada(empresaId);
    localStorage.setItem('empresa_selecionada_id', empresaId);
  };

  useEffect(() => {
    const loadUser = async () => {
      try {
        // O fallback offline (`offline_current_user`) vive no service desde a
        // P1.2; aqui o Layout só pede o usuário atual.
        const currentUser = navigator.onLine ? await getCurrentUser() : getCachedUser();

        setUser(currentUser);

        // Carregar permissões do usuário
        try {
          const allPermissoes = await listarPermissoes();
          setUserPermissions(permissaoDoUsuario(allPermissoes, currentUser?.email));
        } catch (error) {
          console.error("Erro ao carregar permissões:", error);
          setUserPermissions(null);
        }
      } catch (error) {
        console.error("Erro ao carregar usuário:", error);
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    };
    loadUser();
  }, []);

  const handleLogout = () => {
    encerrarSessao();
  };

  const normalizedPermissions = React.useMemo(() => normalizePermissionRecord(userPermissions), [userPermissions]);
  const isAdminUser = React.useMemo(() => Boolean(user?.role === 'admin' || normalizedPermissions?.is_admin), [user?.role, normalizedPermissions]);

  const openPermissionDialog = (title, description, redirectTo = null) => {
    permissionRedirectRef.current = redirectTo;
    setPermissionDialog({ open: true, title, description });
  };

  const closePermissionDialog = (open) => {
    setPermissionDialog((prev) => ({ ...prev, open }));
    if (!open && permissionRedirectRef.current) {
      navigate(permissionRedirectRef.current);
      permissionRedirectRef.current = null;
    }
  };

  const filterMenuByPermissions = (items, parentModuleId = null) => {
    return items.
    map((item) => {
      const moduleId = parentModuleId || item.id;

      if (item.submenu?.length) {
        const filteredSubmenu = filterMenuByPermissions(item.submenu, item.id);
        if (!canAccessModule(normalizedPermissions, item.id) || filteredSubmenu.length === 0) return null;
        return { ...item, submenu: filteredSubmenu };
      }

      if (!canAccessPage(normalizedPermissions, item.id, moduleId)) return null;
      return item;
    }).
    filter(Boolean);
  };

  const menuItemsFiltered = React.useMemo(
    () => filterMenuByPermissions(menuItems),
    [menuItems, normalizedPermissions]
  );

  const currentMenuPage = React.useMemo(() => findMenuItemByUrl(menuItems, currentPageName), [menuItems, currentPageName]);
  const firstAllowedPage = React.useMemo(() => flattenMenuPages(menuItemsFiltered)[0] || null, [menuItemsFiltered]);

  const allowedMobilePageUrls = React.useMemo(
    () => new Set(flattenMenuPages(menuItemsFiltered).map((page) => page.url)),
    [menuItemsFiltered]
  );

  useEffect(() => {
    if (!currentMenuPage) return;
    if (canAccessPage(normalizedPermissions, currentMenuPage.id, currentMenuPage.moduleId)) return;

    openPermissionDialog(
      "Tela bloqueada",
      "Você não tem permissão para visualizar esta tela.",
      createPageUrl(firstAllowedPage?.url || PRIMARY_PAGE)
    );
  }, [currentMenuPage, normalizedPermissions, firstAllowedPage]);

  useEffect(() => {
    if (!currentMenuPage || currentMenuPage.id === 'pec-mapa-geral') return;

    const handleBlockedActions = (event) => {
      const interactive = event.target?.closest?.("button, a, [role='button']");
      if (!interactive || interactive.closest("nav")) return;

      const label = interactive.textContent || interactive.getAttribute("aria-label") || interactive.getAttribute("title") || "";
      const action = detectPermissionAction(label);
      if (!action) return;
      if (canPerformAction(normalizedPermissions, currentMenuPage.id, currentMenuPage.moduleId, action)) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      openPermissionDialog("Ação bloqueada", `Você não tem permissão para ${ACTION_LABELS[action]} nesta tela.`);
    };

    document.addEventListener("click", handleBlockedActions, true);
    return () => document.removeEventListener("click", handleBlockedActions, true);
  }, [currentMenuPage, normalizedPermissions]);

  const isActive = (item) => {
    if (item.url) return location.pathname === createPageUrl(item.url);
    if (item.submenu) return item.submenu.some((sub) => sub.url && location.pathname === createPageUrl(sub.url));
    return false;
  };

  const allPages = getAllPages(menuItemsFiltered);
  const filteredPages = searchTerm ?
  allPages.filter((p) =>
  p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
  p.categoria.toLowerCase().includes(searchTerm.toLowerCase())
  ) :
  allPages;

  const pagesByCategory = filteredPages.reduce((acc, page) => {
    if (!acc[page.categoria]) acc[page.categoria] = [];
    acc[page.categoria].push(page);
    return acc;
  }, {});

  const isRoot = location.pathname === createPageUrl(PRIMARY_PAGE);

  const appContentOffset = menuOculto ? "51px" : "91px";

  return (
    <div className="h-[100dvh] overflow-hidden bg-slate-50 safe-area-top flex flex-col" translate="no" style={{ "--app-content-offset": appContentOffset }}>
      <style>{`
        html, body { overscroll-behavior: none; }
        button, [role="button"], a { -webkit-user-select: none; user-select: none; }
        .safe-area-top { padding-top: env(safe-area-inset-top); }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom); }
      `}</style>
      <SplashScreen visible={showSplash} />
      <header className="bg-white border-b border-slate-200 flex-none">
        <div className="max-w-[1600px] mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Mobile Back Button replaces logo on child routes */}
              {!isRoot && <BackButton className="mr-1" />}
              <div>
                <h1 className="font-bold text-slate-900 text-base leading-tight">
                  {empresaAtual?.apelido || empresaAtual?.nome || 'MakGestão'}
                </h1>
                <p className="text-xs text-slate-600">Mapa Geral e Manejo</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {empresas.length > 0 &&
              <Select value={empresaSelecionada || ''} onValueChange={handleEmpresaChange}>
                  <SelectTrigger className="h-8 w-[160px] text-xs hidden lg:flex border-slate-300">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((empresa) =>
                  <SelectItem key={empresa.id} value={empresa.id} className="text-xs">
                        {empresa.apelido || empresa.nome}
                      </SelectItem>
                  )}
                  </SelectContent>
                </Select>
              }

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hidden md:inline-flex"
                onClick={() => {
                  const novoEstado = !menuOculto;
                  setMenuOculto(novoEstado);
                  localStorage.setItem('menu_oculto', novoEstado.toString());
                }}
                // Nome acessível vem do `title`, não de `aria-label`: o componente
                // `Button` não declara tipos de prop, então qualquer prop nova
                // gera um diagnóstico TS2322 inédito e reprova `gate:types`.
                // `title` já fazia parte da forma existente e o accessible name
                // computado é o mesmo (SHELL5/SHELL5b provam).
                title={menuOculto ? "Mostrar menu principal" : "Ocultar menu principal"}>

                {menuOculto ? <Eye className="w-4 h-4 text-slate-600" /> : <EyeOff className="w-4 h-4 text-slate-600" />}
              </Button>

              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearchOpen(true)}>
                <Search className="w-4 h-4 text-slate-600" />
              </Button>

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
                  {isAdminUser &&
                  <DropdownMenuItem asChild className="text-xs">
                    <Link to={createPageUrl("ConfiguracoesGerais")}>Configurações Gerais</Link>
                  </DropdownMenuItem>
                  }
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-xs text-red-600">
                    <LogOut className="w-3 h-3 mr-2" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetContent side="right" className="w-72 flex flex-col">
                  <SheetHeader>
                    <SheetTitle className="text-left text-sm">Menu</SheetTitle>
                  </SheetHeader>

                  {/* Seletor de Empresa no Mobile */}
                  {empresas.length > 0 &&
                  <div className="mt-4 px-2">
                      <label className="text-xs text-slate-500 mb-1 block">Empresa</label>
                      <Select value={empresaSelecionada || ''} onValueChange={handleEmpresaChange}>
                        <SelectTrigger className="h-9 text-xs w-full border-slate-300">
                          <SelectValue placeholder="Selecione a empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          {empresas.map((empresa) =>
                        <SelectItem key={empresa.id} value={empresa.id} className="text-xs">
                              {empresa.apelido || empresa.nome}
                            </SelectItem>
                        )}
                        </SelectContent>
                      </Select>
                    </div>
                  }

                  <div className="mt-4 space-y-1 flex-1 overflow-y-auto">
                    {menuItemsFiltered.map((item) => {
                      const Icon = iconsMap[item.icon] || Map;

                      if (item.submenu) {
                        return (
                          <div key={item.id} className="space-y-1">
                            <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-slate-700">
                              <Icon className="w-3.5 h-3.5" />
                              {item.title}
                            </div>
                            <div className="ml-3 space-y-0.5">
                              {item.submenu.map((sub) => {
                                if (!sub.url) return null;
                                return (
                                  <Link
                                    key={sub.id}
                                    to={createPageUrl(sub.url)}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className={`block px-2 py-1.5 text-xs rounded ${
                                    location.pathname === createPageUrl(sub.url) ?
                                    'bg-emerald-100 text-emerald-800 font-medium' :
                                    'text-slate-600 hover:bg-slate-50'}`
                                    }>

                                    {sub.title}
                                  </Link>);

                              })}
                            </div>
                          </div>);

                      }

                      return (
                        <Link
                          key={item.id}
                          to={createPageUrl(item.url)}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded ${
                          location.pathname === createPageUrl(item.url) ?
                          'bg-emerald-100 text-emerald-800 font-medium' :
                          'text-slate-600 hover:bg-slate-50'}`
                          }>

                          <Icon className="w-3.5 h-3.5" />
                          {item.title}
                        </Link>);

                    })}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      <nav
        aria-label="Módulos"
        className={`flex-none bg-white border-b border-slate-200 shadow-sm transition-all duration-300 hidden md:block ${menuOculto ? 'md:h-0 md:overflow-hidden md:border-0 md:py-0' : ''}`}>
        <div className="max-w-[1600px] mx-auto px-4">
          <div className="flex items-center gap-0.5 h-10">
            <div className="hidden md:flex items-center gap-0.5">
              {menuItemsFiltered.map((item) => {
                const active = isActive(item);

                if (item.submenu) {
                  return (
                    <div key={item.id} className="relative group">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-8 px-2.5 gap-1 text-xs font-medium rounded ${
                        active ?
                        'bg-emerald-600 text-white hover:bg-emerald-700' :
                        'text-slate-700 hover:text-slate-900 hover:bg-slate-100'}`
                        }>

                        {item.title}
                        <ChevronDown className="w-3 h-3 opacity-50" />
                      </Button>

                      <div className="absolute left-0 mt-1 w-52 bg-white rounded-md shadow-lg border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                        <div className="py-1">
                          {item.submenu.map((sub) => {
                            if (!sub.url) return null;
                            return (
                              <Link
                                key={sub.id}
                                to={createPageUrl(sub.url)}
                                className={`block px-4 py-2 text-xs hover:bg-slate-50 ${
                                location.pathname === createPageUrl(sub.url) ?
                                'bg-emerald-50 text-emerald-800 font-medium' :
                                'text-slate-700'}`
                                }>

                                {sub.title}
                              </Link>);

                          })}
                        </div>
                      </div>
                    </div>);

                }

                return (
                  <Link key={item.id} to={createPageUrl(item.url)}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 px-2.5 gap-1 text-xs font-medium rounded ${
                      active ?
                      'bg-emerald-600 text-white hover:bg-emerald-700' :
                      'text-slate-700 hover:text-slate-900 hover:bg-slate-100'}`
                      }>

                      {item.title}
                    </Button>
                  </Link>);

              })}
            </div>
          </div>
        </div>
      </nav>

      <PermissionAlertDialog
        open={permissionDialog.open}
        onOpenChange={closePermissionDialog}
        title={permissionDialog.title}
        description={permissionDialog.description} />


      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Search className="w-4 h-4 text-emerald-600" />
              Buscar telas
            </DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Digite para buscar paginas..."
              className="pl-10 h-10"
              autoFocus />

            {searchTerm &&
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8"
              onClick={() => setSearchTerm("")}>

                <X className="w-4 h-4" />
              </Button>
            }
          </div>

          <div className="flex-1 overflow-auto mt-4">
            {Object.keys(pagesByCategory).length === 0 ?
            <div className="text-center py-12 text-slate-500">
                <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Nenhuma pagina encontrada</p>
              </div> :

            <div className="space-y-4">
                {Object.entries(pagesByCategory).
              sort(([a], [b]) => a.localeCompare(b)).
              map(([categoria, pages]) =>
              <div key={categoria}>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2 px-2">{categoria}</h3>
                    <div className="space-y-1">
                      {pages.sort((a, b) => a.title.localeCompare(b.title)).map((page) =>
                  <Link
                    key={page.id}
                    to={createPageUrl(page.url)}
                    onClick={() => {setSearchOpen(false);setSearchTerm("");}}
                    className="block px-3 py-2 text-sm hover:bg-emerald-50 rounded-md transition-colors">

                          <div className="font-medium text-slate-900">{page.title}</div>
                          <div className="text-xs text-slate-500">{categoria}</div>
                        </Link>
                  )}
                    </div>
                  </div>
              )}
              </div>
            }
          </div>
        </DialogContent>
      </Dialog>


      <main className="max-w-[1600px] mx-auto flex-1 min-h-0 w-full overflow-hidden pb-16 md:pb-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative h-full min-h-0 overflow-hidden">

            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Navegação inferior"
        className="fixed bottom-0 inset-x-0 md:hidden bg-white border-t border-slate-200 shadow-lg safe-area-bottom">
          <div className="max-w-[1600px] mx-auto px-4 py-2 grid grid-cols-5 gap-3">
            {FIXED_MOBILE_NAV_ITEMS.map((page) => {
            const isCurrent = location.pathname === createPageUrl(page.url);
            const hasAccess = allowedMobilePageUrls.has(page.url);
            const Icon = page.Icon;

            return hasAccess ?
            <Link
              key={page.id}
              to={createPageUrl(page.url)}
              aria-label={page.label}
              className={`flex items-center justify-center h-12 rounded-xl border transition-colors ${isCurrent ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                <Icon className="w-6 h-6" />
                </Link> :

            <button
              key={page.id}
              type="button"
              aria-label={page.label}
              onClick={() => openPermissionDialog("Tela bloqueada", "Você não tem permissão para visualizar esta tela.")}
              className="flex items-center justify-center h-12 rounded-xl border bg-white border-slate-200 text-slate-300">
                <Icon className="w-6 h-6" />
              </button>;


          })}
            <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu principal"
            aria-haspopup="dialog"
            aria-expanded={mobileMenuOpen}
            className={`flex flex-col items-center justify-center h-12 rounded-xl border transition-colors ${mobileMenuOpen ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-600'}`}>
              <Menu className="w-5 h-5" />
              <span className="text-[10px] leading-none mt-0.5">Menu</span>
            </button>
          </div>
        </nav>

      </div>);

}

export const getEmpresaSelecionada = () => {
  return localStorage.getItem('empresa_selecionada_id');
};
