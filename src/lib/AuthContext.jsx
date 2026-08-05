import React, { createContext, useState, useContext, useEffect } from 'react';
import { getDataProviderConfig } from '@/config/runtimeConfig';
import {
  verificarAutenticacao,
  carregarConfiguracoesPublicas,
  encerrarSessao,
  irParaLogin,
  RAZOES_DE_SESSAO_DO_PRODUTO,
} from '@/services/sessionService';

const AuthContext = createContext();

/**
 * Frase por razão. Texto do produto, não do provider — nada aqui vem de
 * `error.message`.
 */
const MENSAGEM_POR_RAZAO = Object.freeze({
  [RAZOES_DE_SESSAO_DO_PRODUTO.AUTH_REQUIRED]: 'Authentication required',
  [RAZOES_DE_SESSAO_DO_PRODUTO.USER_NOT_REGISTERED]: 'User not registered for this app',
  [RAZOES_DE_SESSAO_DO_PRODUTO.UNKNOWN]: 'Failed to load app',
});

const MENSAGEM_PADRAO = 'Failed to load app';

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
    setIsLoadingPublicSettings(true);
    setAuthError(null);

    // Resultado discriminado (P1.4-R1): ou vem o valor, ou vem uma razão do
    // vocabulário do produto. Este arquivo não conhece `status`, `data`,
    // `extra_data` nem mensagem crua de provider nenhum — a classificação
    // acontece uma única vez, dentro da API de sessão.
    const resultado = await carregarConfiguracoesPublicas();

    if (!resultado.ok) {
      setAuthError({ type: resultado.reason, message: MENSAGEM_POR_RAZAO[resultado.reason] ?? MENSAGEM_PADRAO });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
      return;
    }

    setAppPublicSettings(resultado.value);

    // Com as configurações públicas em mãos, checa a sessão — mas só faz
    // sentido perguntar quando existe token.
    if (appParams.token) {
      await checkUserAuth();
    } else {
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
    }
    setIsLoadingPublicSettings(false);
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
        type: RAZOES_DE_SESSAO_DO_PRODUTO.AUTH_REQUIRED,
        message: MENSAGEM_POR_RAZAO[RAZOES_DE_SESSAO_DO_PRODUTO.AUTH_REQUIRED]
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