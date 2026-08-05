import React, { createContext, useState, useContext, useEffect } from 'react';
import { getDataProviderConfig } from '@/config/runtimeConfig';
import {
  verificarAutenticacao,
  carregarConfiguracoesPublicas,
  encerrarSessao,
  irParaLogin,
} from '@/services/sessionService';

const AuthContext = createContext();

/**
 * `token` continua sendo lido aqui por um motivo só: decidir **se** vale a pena
 * consultar o usuário. Nenhuma requisição é montada neste arquivo desde a P1.4
 * — a URL das configurações públicas e o cabeçalho `Authorization` vivem no
 * provider, que é quem sabe o que é Base44.
 */
const appParams = getDataProviderConfig();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      
      // Primeiro, as configurações públicas do app: elas dizem se a
      // autenticação é obrigatória, se o usuário não está registrado, etc.
      try {
        const publicSettings = await carregarConfiguracoesPublicas();
        setAppPublicSettings(publicSettings);
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    // Sem fallback offline aqui de propósito: `verificarAutenticacao` devolve um
    // veredito. Se a chamada falhou, a sessão não está autenticada — e um token
    // expirado (401/403) precisa levar à tela de login, não ao último usuário
    // conhecido em cache.
    setIsLoadingAuth(true);
    const veredito = await verificarAutenticacao();

    setUser(veredito.usuario);
    setIsAuthenticated(veredito.autenticado);
    setIsLoadingAuth(false);

    if (!veredito.autenticado && veredito.precisaAutenticar) {
      setAuthError({
        type: 'auth_required',
        message: 'Authentication required'
      });
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    
    // Com URL, o provider limpa o token e redireciona; sem URL, só limpa.
    encerrarSessao(shouldRedirect ? window.location.href : undefined);
  };

  const navigateToLogin = () => {
    irParaLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};