import { Toaster } from "@/components/ui/toaster"
import GlobalRequiredFieldsGuard from '@/components/common/GlobalRequiredFieldsGuard';
import GlobalDeleteBlockDialog from '@/components/common/GlobalDeleteBlockDialog';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import NativeLoginForm from '@/components/auth/NativeLoginForm';

const { Pages, Layout, mainPage } = pagesConfig;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, entrar } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
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
      <Route path="/" element={<Navigate to={`/${mainPage}`} replace />} />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
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
