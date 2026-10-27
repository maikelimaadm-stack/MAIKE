import { Toaster } from "@/components/ui/toaster"
import GlobalRequiredFieldsGuard from '@/components/common/GlobalRequiredFieldsGuard';
import GlobalDeleteBlockDialog from '@/components/common/GlobalDeleteBlockDialog';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppRouteContent from '@/components/navigation/AppRouteContent';
import { createPageUrl } from '@/utils';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import NativeLoginForm from '@/components/auth/NativeLoginForm';
import NativeSessionUnavailable from '@/components/auth/NativeSessionUnavailable';

const { Pages, Layout, mainPage } = pagesConfig;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

/** Resolve o nome PascalCase da página a partir do pathname canônico (minúsculas). */
const pageNameFromPathname = (pathname) => {
  for (const pageName of Object.keys(Pages)) {
    if (pathname === createPageUrl(pageName)) return pageName;
  }
  return null;
};

/**
 * Shell único: o Layout monta uma vez por sessão. Antes cada `<Route>` embrulhava
 * o Layout de novo — splash de 5s, getCurrentUser e permissões repetiam a cada
 * clique no menu.
 */
const AppShell = () => {
  const { pathname } = useLocation();
  const currentPageName = pageNameFromPathname(pathname);
  if (!currentPageName) {
    return <AppRouteContent />;
  }
  return (
    <LayoutWrapper currentPageName={currentPageName}>
      <AppRouteContent />
    </LayoutWrapper>
  );
};

const AuthenticatedApp = () => {
  const {
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    isAuthenticated,
    entrar,
    sessionValidationError,
    revalidarSessao,
    encerrarValidacaoEIrParaLogin,
  } = useAuth();

  // A ordem destes quatro ramos é o contrato da P4.0-R1, e cada posição
  // importa:
  //
  //   1. carregando                → ainda não sabemos nada
  //   2. validação indisponível    → não sabemos, e não é culpa do usuário
  //   3. não autenticado           → sabemos: precisa entrar
  //   4. autenticado               → aplicativo
  //
  // O segundo ramo é o que faltava. Sem ele, "não sabemos" caía no terceiro e
  // virava pedido de senha.

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Indisponibilidade: o token continua guardado e o aplicativo continua
  // fechado. Nem login, nem conteúdo protegido — só a chance de tentar de novo
  // com a credencial que já existe.
  if (sessionValidationError) {
    return (
      <NativeSessionUnavailable
        mensagem={sessionValidationError}
        aoTentarNovamente={revalidarSessao}
        aoIrParaLogin={encerrarValidacaoEIrParaLogin}
      />
    );
  }

  // Sem sessão nativa válida, a superfície é o login próprio (P4.0). Não há
  // mais redirecionamento para o login da Base44: a autenticação do aplicativo
  // é do MAIKE, e mandar o usuário para fora seria autenticá-lo no provider
  // errado.
  if (!isAuthenticated) {
    return <NativeLoginForm entrar={entrar} onAutenticado={() => {}} />;
  }

  // A recusa do provider de dados legado continua tendo tela própria — ela
  // descreve o acesso do usuário às capacidades ainda não migradas, e não a
  // sessão do aplicativo.
  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Render the main app. A raiz encaminha para a superfície primária (D-PROD-05).
  return (
    <Routes>
      <Route path="/" element={<Navigate to={createPageUrl(mainPage)} replace />} />
      <Route element={<AppShell />}>
        {Object.entries(Pages).map(([path, Page]) => (
          <Route
            key={path}
            path={createPageUrl(path)}
            element={<Page />}
          />
        ))}
      </Route>
      {/* Bookmarks e links antigos usavam PascalCase antes do SSOT em minúsculas. */}
      {Object.keys(Pages).map((path) => (
        <Route
          key={`legacy-${path}`}
          path={`/${path}`}
          element={<Navigate to={createPageUrl(path)} replace />}
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <GlobalRequiredFieldsGuard />
        <GlobalDeleteBlockDialog />
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
