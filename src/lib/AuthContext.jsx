/**
 * Estado de autenticação do aplicativo.
 *
 * ─── O que mudou na P4.0 (D-PROD-24) ───────────────────────────────────────
 *
 * Quem autentica o usuário passou a ser o **backend nativo MAIKE**. Antes, a
 * sessão vinha do token da Base44 lido da query string: o app perguntava
 * `auth.me()` ao SDK e, sem resposta, mandava o usuário para o login da Base44.
 *
 * Agora o app tem login próprio, JWT próprio e contexto próprio. A Base44
 * continua nesta casca em **um** ponto — as configurações públicas do app, que
 * ainda alimentam telas cujos dados não migraram. É acoplamento de dados, não
 * de autenticação, e sai quando a última capacidade migrar (P7).
 *
 * ─── O que deliberadamente NÃO existe aqui ─────────────────────────────────
 *
 * Fallback. Se o backend MAIKE não responde, o usuário vê falha de login — não
 * uma sessão Base44 de consolação. Dual-auth silenciosa transformaria "o
 * backend caiu" em "sua senha está errada", que é a pior mensagem possível:
 * manda o usuário tentar de novo para sempre e esconde o incidente de quem
 * poderia resolvê-lo.
 */

import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { getApiErrorMessage } from '@/apis/_core/ApiError';
import {
  carregarConfiguracoesPublicas,
  entrarComSessaoNativa,
  restaurarSessaoNativaAtual,
  sairDaSessaoNativa,
  RAZOES_DE_SESSAO_DO_PRODUTO,
} from '@/services/sessionService';

/**
 * Estados possíveis da sessão nativa (P4.0-R1).
 *
 * Discriminado em vez de dois booleanos, porque o estado que faltava —
 * "não consegui validar" — não é representável por eles. Com
 * `isAuthenticated: false` mais `isLoading: false`, a única leitura possível é
 * "deslogado", e a tela mostra o formulário de login. Foi assim que
 * indisponibilidade transitória virou pedido de senha.
 *
 * `VALIDACAO_INDISPONIVEL` é fail-closed: o aplicativo continua fechado, o
 * token continua guardado, e o usuário recebe a ação de tentar de novo.
 */
export const ESTADOS_DE_SESSAO = Object.freeze({
  CARREGANDO: 'carregando',
  AUTENTICADA: 'autenticada',
  NAO_AUTENTICADA: 'nao_autenticada',
  VALIDACAO_INDISPONIVEL: 'validacao_indisponivel',
});

/**
 * Contrato do contexto de autenticação.
 *
 * Declarado de verdade, e não como `any` implícito, por um motivo concreto: o
 * `Layout` consome `logout` num `onClick`. Com o contexto sem tipo, esse
 * `onClick` vira `any` e a catraca de tipos registra uma impressão digital nova
 * — dívida nascendo em código novo, que é exatamente o que ela existe para
 * impedir. Declarar o contrato custa este bloco e mantém a verificação viva.
 *
 * @typedef {{id: string, login?: string, nome?: string}} UsuarioDaSessao
 * @typedef {{type: string, message: string}} ErroDeAutenticacao
 * @typedef {{
 *   user: UsuarioDaSessao|null,
 *   clienteId: string|null,
 *   sessionState: string,
 *   isAuthenticated: boolean,
 *   isLoadingAuth: boolean,
 *   isLoadingPublicSettings: boolean,
 *   sessionValidationError: string|null,
 *   authError: ErroDeAutenticacao|null,
 *   appPublicSettings: object|null,
 *   entrar: (credenciais: {cliente: string, login: string, senha: string}) => Promise<object>,
 *   logout: () => void,
 *   revalidarSessao: () => Promise<void>,
 *   recarregarConfiguracoes: () => Promise<void>,
 * }} ValorDoAuthContext
 */

/** @type {import('react').Context<ValorDoAuthContext|null>} */
const AuthContext = createContext(/** @type {ValorDoAuthContext|null} */ (null));

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

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [clienteId, setClienteId] = useState(null);
  // A anotação é necessária: sem ela o `useState` infere o literal
  // `'carregando'` do valor inicial, e toda transição vira erro de tipo.
  const [sessionState, setSessionState] = useState(
    /** @type {'carregando'|'autenticada'|'nao_autenticada'|'validacao_indisponivel'} */ (
      ESTADOS_DE_SESSAO.CARREGANDO
    )
  );
  const [sessionValidationError, setSessionValidationError] = useState(null);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  /**
   * Configurações públicas do provider de dados.
   *
   * Continua sendo Base44 e continua podendo falhar por conta própria. A falha
   * **não** bloqueia mais o login nativo: são dois eixos independentes desde a
   * P4.0, e travar a entrada do usuário porque o provider de dados legado não
   * respondeu seria acoplar de volta o que a missão acabou de separar.
   */
  const carregarConfiguracoes = useCallback(async () => {
    setIsLoadingPublicSettings(true);
    const resultado = await carregarConfiguracoesPublicas();

    if (resultado.ok) {
      setAppPublicSettings(resultado.value);
      setAuthError(null);
    } else {
      setAuthError({
        type: resultado.reason,
        message: MENSAGEM_POR_RAZAO[resultado.reason] ?? MENSAGEM_PADRAO,
      });
    }

    setIsLoadingPublicSettings(false);
  }, []);

  /**
   * Restaura a sessão nativa de um reload.
   *
   * A presença do token não basta: `restaurarSessaoNativaAtual` confirma com o
   * servidor e descarta o token quando ele não vale mais. Sem essa confirmação,
   * um token expirado deixaria a aplicação inteira montar para só falhar na
   * primeira requisição real.
   */
  const restaurarSessao = useCallback(async () => {
    setSessionState(ESTADOS_DE_SESSAO.CARREGANDO);
    setSessionValidationError(null);

    try {
      const veredito = await restaurarSessaoNativaAtual();

      if (veredito.autenticado && veredito.contexto) {
        setUser({ id: veredito.contexto.usuario_id, login: veredito.contexto.login });
        setClienteId(veredito.contexto.cliente_id);
        setSessionState(ESTADOS_DE_SESSAO.AUTENTICADA);
        return;
      }

      // O servidor se pronunciou: a credencial não vale. A camada de sessão já
      // descartou o token.
      setUser(null);
      setClienteId(null);
      setSessionState(ESTADOS_DE_SESSAO.NAO_AUTENTICADA);
    } catch (erro) {
      // Não conseguimos validar. O token continua guardado — pode estar
      // perfeitamente válido, ninguém perguntou ao servidor ainda.
      //
      // O aplicativo NÃO abre: sem confirmação não há sessão. E o login também
      // não aparece: pedir senha aqui seria culpar o usuário por uma falha de
      // infraestrutura, e ele ainda perderia a credencial que tem.
      setUser(null);
      setClienteId(null);
      // `getApiErrorMessage` só devolve texto de `ApiError`, sempre do catálogo
      // público. Nada do servidor chega à tela.
      setSessionValidationError(getApiErrorMessage(erro));
      setSessionState(ESTADOS_DE_SESSAO.VALIDACAO_INDISPONIVEL);
    }
  }, []);

  useEffect(() => {
    carregarConfiguracoes();
    restaurarSessao();
  }, [carregarConfiguracoes, restaurarSessao]);

  /**
   * Entra com credenciais nativas.
   *
   * Repassa o erro em vez de engoli-lo: quem chama é o formulário, e é ele que
   * sabe transformar `ApiError` em texto na tela.
   *
   * @param {{cliente: string, login: string, senha: string}} credenciais
   */
  const entrar = useCallback(async (credenciais) => {
    const sessao = await entrarComSessaoNativa(credenciais);
    setUser(sessao.usuario);
    setClienteId(sessao.clienteId);
    setSessionState(ESTADOS_DE_SESSAO.AUTENTICADA);
    setSessionValidationError(null);
    setAuthError(null);
    return sessao;
  }, []);

  /**
   * Encerra a sessão.
   *
   * Sem redirecionamento e sem ida ao servidor: o JWT é stateless, e o destino
   * depois do logout é a própria tela de login nativa, que aparece sozinha
   * quando `isAuthenticated` cai.
   */
  const logout = useCallback(() => {
    sairDaSessaoNativa();
    setUser(null);
    setClienteId(null);
    setSessionValidationError(null);
    setSessionState(ESTADOS_DE_SESSAO.NAO_AUTENTICADA);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        clienteId,
        sessionState,
        // Derivados do estado, nunca guardados em paralelo: dois booleanos
        // independentes foi como o quarto estado deixou de ser representável.
        isAuthenticated: sessionState === ESTADOS_DE_SESSAO.AUTENTICADA,
        isLoadingAuth: sessionState === ESTADOS_DE_SESSAO.CARREGANDO,
        isLoadingPublicSettings,
        sessionValidationError,
        authError,
        appPublicSettings,
        entrar,
        logout,
        // Repete a validação com o MESMO token guardado. Nunca chama
        // `/auth/login` e nunca pede senha: a credencial já existe, o que
        // faltava era o servidor responder.
        revalidarSessao: restaurarSessao,
        recarregarConfiguracoes: carregarConfiguracoes,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Contexto de autenticação, garantidamente presente.
 *
 * @returns {ValorDoAuthContext}
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
