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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userPermissions, setUserPermissions] = useState(null);
  const isChangingEmpresa = useRef(false);

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
    initialData: [],
  });

  const empresaAtual = empresas.find(e => e.id === empresaSelecionada);

  useEffect(() => {
    if (!empresaSelecionada && empresas.length > 0 && !isChangingEmpresa.current) {
      const primeiraEmpresa = empresas[0].id;
      setEmpresaSelecionada(primeiraEmpresa);
      localStorage.setItem('empresa_selecionada_id', primeiraEmpresa);
    }
  }, [empresas.length]);

  const handleEmpresaChange = (empresaId) => {
    isChangingEmpresa.current = true;
    setEmpresaSelecionada(empresaId);
    localStorage.setItem('empresa_selecionada_id', empresaId);
    setTimeout(() => window.location.reload(), 100);
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

  const handleLogout = () => base44.auth.logout();

  const hasAccess = (itemId) => {
    if (user?.role === 'admin' || userPermissions?.is_admin) return true;
    if (!userPermissions) return true;
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
    if (item.submenu) return item.submenu.some(sub => location.pathname === createPageUrl(sub.url));
    return false;
  };

  return (
    <div className="min-h-screen bg-gray-100" translate="no">
      {/* HEADER SIMPLES */}
      <div className="bg-green-800 text-white">
        <div className="max-w-[1800px] mx-auto px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-bold text-lg tracking-wide">
                {empresaAtual?.apelido || empresaAtual?.nome || 'FAZENDA'}
              </span>
              {empresas.length > 1 && (
                <Select value={empresaSelecionada || ''} onValueChange={handleEmpresaChange}>
                  <SelectTrigger className="h-8 w-[140px] text-xs bg-green-700 border-green-600 text-white">
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
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm hidden md:block">{user?.full_name || 'Usuario'}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-white hover:bg-green-700">
                    <span className="w-7 h-7 bg-green-600 rounded-full flex items-center justify-center font-bold">
                      {user?.full_name?.charAt(0).toUpperCase() || 'U'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={handleLogout} className="text-sm text-red-600">
                    <LogOut className="w-4 h-4 mr-2" />
                    SAIR
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden text-white hover:bg-green-700">
                    <Menu className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-64 bg-gray-50">
                  <SheetHeader>
                    <SheetTitle className="text-left font-bold">MENU</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 space-y-1">
                    {menuItemsFiltered.map((item) => {
                      if (item.submenu) {
                        return (
                          <div key={item.id} className="space-y-1">
                            <div className="px-2 py-2 text-sm font-bold text-gray-800 bg-gray-200">
                              {item.title}
                            </div>
                            <div className="space-y-0.5">
                              {item.submenu.map((sub) => (
                                <Link 
                                  key={sub.id}
                                  to={createPageUrl(sub.url)}
                                  onClick={() => setMobileMenuOpen(false)}
                                  className={`block px-3 py-2 text-sm ${
                                    location.pathname === createPageUrl(sub.url)
                                      ? 'bg-green-600 text-white font-bold'
                                      : 'text-gray-700 hover:bg-gray-100'
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
                          className={`block px-2 py-2 text-sm font-bold ${
                            location.pathname === createPageUrl(item.url)
                              ? 'bg-green-600 text-white'
                              : 'text-gray-800 bg-gray-200 hover:bg-gray-300'
                          }`}
                        >
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

      {/* MENU HORIZONTAL SIMPLES */}
      <nav className="sticky top-0 z-50 bg-gray-200 border-b-2 border-gray-400">
        <div className="max-w-[1800px] mx-auto px-2">
          <div className="hidden md:flex items-center gap-1 py-1 overflow-x-auto">
            {menuItemsFiltered.map((item) => {
              const active = isActive(item);

              if (item.submenu) {
                return (
                  <div key={item.id} className="relative group">
                    <button 
                      className={`px-3 py-2 text-sm font-bold whitespace-nowrap flex items-center gap-1 ${
                        active 
                          ? 'bg-green-700 text-white' 
                          : 'bg-gray-300 text-gray-800 hover:bg-gray-400'
                      }`}
                    >
                      {item.title}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    
                    <div className="absolute left-0 mt-0 w-48 bg-white border-2 border-gray-400 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible z-50">
                      {item.submenu.map((sub) => (
                        <Link 
                          key={sub.id}
                          to={createPageUrl(sub.url)}
                          className={`block px-3 py-2 text-sm border-b border-gray-200 last:border-b-0 ${
                            location.pathname === createPageUrl(sub.url)
                              ? 'bg-green-100 text-green-800 font-bold'
                              : 'text-gray-700 hover:bg-gray-100'
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
                <Link key={item.id} to={createPageUrl(item.url)}>
                  <button 
                    className={`px-3 py-2 text-sm font-bold whitespace-nowrap ${
                      active 
                        ? 'bg-green-700 text-white' 
                        : 'bg-gray-300 text-gray-800 hover:bg-gray-400'
                    }`}
                  >
                    {item.title}
                  </button>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="max-w-[1800px] mx-auto">
        {children}
      </main>

      <PWAInstaller />
      <OfflineManager />
      <CacheManager />
      <OfflineIndicator />
    }

    export const getEmpresaSelecionada = () => {
      return localStorage.getItem('empresa_selecionada_id');
    };