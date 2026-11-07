/**
 * Entrada da sessão nativa (P4.0, D-PROD-24; login simplificado D-PROD-33;
 * tela nova e "Manter conectado" D-PROD-136).
 *
 * Superfície mínima de propósito: não é página, não entra em `pages.config` e
 * não amplia `config/mapa-manejo-scope.json`. É o estado "sem sessão" da casca
 * de autenticação que já existe — a mesma posição que a tela de erro de
 * usuário não registrado ocupa.
 *
 * O que esta tela **não** mostra, e por quê:
 *
 *  - código de cliente: removido do login; o tenant é resolvido pelo usuário
 *    autenticado no backend;
 *  - `cliente_id` e `usuario_id`: identificadores internos, resultado da sessão;
 *  - o token: não passa por aqui em nenhum momento;
 *  - a mensagem do servidor: o texto de erro vem do catálogo local, via
 *    `getApiErrorMessage`.
 *
 * "Lembrar senha": a senha **nunca** é guardada pelo sistema. Os campos têm
 * `name` e `autocomplete` corretos para o gerenciador de senhas do navegador
 * ou do celular oferecer salvar e preencher. O que o sistema lembra é:
 *
 *  - a sessão, quando "Manter conectado" está ligado (token no aparelho, ver
 *    `nativeTokenStorage`);
 *  - o usuário e a própria escolha, para a próxima entrada já vir preenchida.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { getApiErrorMessage } from '@/apis/_core/ApiError';
import ToggleSwitch from '@/components/common/ToggleSwitch';
import TrocaSenhaObrigatoriaForm from '@/components/auth/TrocaSenhaObrigatoriaForm';

/** Preferências da tela (não é sessão nem segredo): usuário e "Manter conectado". */
const CHAVE_PREFERENCIAS = 'maike_login_preferencias';

const lerPreferencias = () => {
  try {
    const bruto = window.localStorage.getItem(CHAVE_PREFERENCIAS);
    const dados = bruto ? JSON.parse(bruto) : null;
    return {
      login: typeof dados?.login === 'string' ? dados.login : '',
      lembrar: dados?.lembrar === true,
    };
  } catch {
    return { login: '', lembrar: false };
  }
};

const gravarPreferencias = ({ login, lembrar }) => {
  try {
    if (lembrar) window.localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify({ login, lembrar: true }));
    else window.localStorage.removeItem(CHAVE_PREFERENCIAS);
  } catch {
    // Conveniência: sem storage a tela só não vem preenchida da próxima vez.
  }
};

const CAMPO_CLASSE =
  'peer h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-3 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#22c55e] focus:ring-2 focus:ring-[#40de63]/20 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:border-red-400 aria-[invalid=true]:focus:ring-red-400/15';

/**
 * @param {{onAutenticado: (sessao: {usuario: object, clienteId: string}) => void,
 *          entrar: (credenciais: {login: string, senha: string, lembrar?: boolean}) => Promise<object>}} props
 */
const NativeLoginForm = ({ onAutenticado, entrar }) => {
  const [preferencias] = useState(lerPreferencias);
  const [login, setLogin] = useState(preferencias.login);
  const [senha, setSenha] = useState('');
  const [lembrar, setLembrar] = useState(preferencias.lembrar);
  const [verSenha, setVerSenha] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [erro, setErro] = useState(null);
  const [faltando, setFaltando] = useState(/** @type {null | 'login' | 'senha'} */ (null));
  const [enviando, setEnviando] = useState(false);
  // S04-P2: senha temporária do primeiro acesso → troca obrigatória (sem sessão).
  const [trocaObrigatoria, setTrocaObrigatoria] = useState(false);
  const [aviso, setAviso] = useState(/** @type {null | {texto: string, tom: 'info'|'aviso'}} */ (null));
  const campoLogin = useRef(/** @type {HTMLInputElement | null} */ (null));
  const campoSenha = useRef(/** @type {HTMLInputElement | null} */ (null));

  // Com o usuário já lembrado, o foco vai direto para a senha.
  useEffect(() => {
    (preferencias.login ? campoSenha : campoLogin).current?.focus();
  }, [preferencias.login]);

  const verCapsLock = (evento) => {
    if (typeof evento.getModifierState === 'function') setCapsLock(evento.getModifierState('CapsLock'));
  };

  const submeter = async (evento) => {
    evento.preventDefault();
    if (enviando) return;

    setErro(null);
    setAviso(null);
    // Sem `required` nativo: a regra global pinta de vermelho campo obrigatório
    // vazio antes de a pessoa digitar. A validação é aqui, no envio.
    if (!login.trim()) {
      setFaltando('login');
      campoLogin.current?.focus();
      return;
    }
    if (!senha) {
      setFaltando('senha');
      campoSenha.current?.focus();
      return;
    }
    setFaltando(null);
    setEnviando(true);

    try {
      const sessao = await entrar({ login: login.trim(), senha, lembrar });
      gravarPreferencias({ login: login.trim(), lembrar });
      setSenha('');
      if (sessao?.trocaSenhaObrigatoria === true) {
        setTrocaObrigatoria(true);
        return;
      }
      onAutenticado(sessao);
    } catch (falha) {
      setErro(getApiErrorMessage(falha));
      setSenha('');
      campoSenha.current?.focus();
    } finally {
      setEnviando(false);
    }
  };

  const anoAtual = new Date().getFullYear();

  if (trocaObrigatoria) {
    const voltarAoLogin = (texto, tom = 'info') => {
      setTrocaObrigatoria(false);
      setSenha('');
      setAviso(texto ? { texto, tom } : null);
    };
    return (
      <TrocaSenhaObrigatoriaForm
        login={login.trim()}
        onConcluida={(texto) => voltarAoLogin(texto, 'info')}
        onVoltar={voltarAoLogin}
      />
    );
  }

  return (
    <div className="mk-login fixed inset-0 overflow-y-auto bg-slate-50">
      <div className="flex min-h-[100dvh] w-full">
        {/* Painel da marca — só a partir do notebook. */}
        <aside
          aria-hidden
          className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-[#16a34a] via-[#22c55e] to-[#40de63] lg:flex lg:flex-col lg:justify-between lg:p-12"
        >
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-32 -left-20 h-[28rem] w-[28rem] rounded-full bg-white/10" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg shadow-green-900/20">
            <img src="/brand/mak-gestao-simbolo.png" alt="" className="h-11 w-11 object-contain" />
          </div>
          <div className="relative max-w-md text-white 2xl:max-w-xl">
            <p className="text-4xl font-bold leading-tight tracking-tight 2xl:text-5xl">Gestão do rebanho direto no mapa.</p>
            <p className="mt-4 text-lg leading-relaxed text-white/85">
              Pastos, lotes, manejos e tarefas da fazenda em um só lugar — no computador ou no celular.
            </p>
          </div>
          <p className="relative text-sm text-white/75">© {anoAtual} MAK Gestão</p>
        </aside>

        {/* Formulário */}
        <main className="flex w-full flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6 lg:max-w-[560px] lg:flex-none lg:bg-white lg:px-12 xl:max-w-[640px]">
          <form
            onSubmit={submeter}
            noValidate
            aria-labelledby="login-titulo"
            className="w-full max-w-[400px] rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8 lg:border-0 lg:p-0 lg:shadow-none"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            <img
              src="/brand/mak-gestao-logo-horizontal.png"
              alt="MAK Gestão"
              className="mx-auto h-16 w-auto max-w-full object-contain sm:h-[4.5rem]"
            />

            <div className="mt-6 text-center">
              <h1 id="login-titulo" className="text-2xl font-bold tracking-tight text-slate-900">
                Bem-vindo de volta
              </h1>
              <p className="mt-1 text-sm text-slate-500">Entre com seu usuário e senha.</p>
            </div>

            <div className="mt-7 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="campo-login">
                  Usuário
                </label>
                <div className="relative">
                  <input
                    ref={campoLogin}
                    id="campo-login"
                    name="username"
                    className={CAMPO_CLASSE}
                    value={login}
                    onChange={(evento) => {
                      setLogin(evento.target.value);
                      if (faltando === 'login') setFaltando(null);
                      if (erro) setErro(null);
                    }}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="next"
                    placeholder="Seu usuário"
                    aria-invalid={erro || faltando === 'login' ? true : undefined}
                    aria-describedby={faltando === 'login' ? 'login-falta-usuario' : undefined}
                  />
                  <User
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition peer-focus:text-[#16a34a]"
                  />
                </div>
                {faltando === 'login' ? (
                  <p id="login-falta-usuario" className="mt-1.5 text-xs font-medium text-red-600">
                    Informe o usuário.
                  </p>
                ) : null}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="campo-senha">
                  Senha
                </label>
                <div className="relative">
                  <input
                    ref={campoSenha}
                    id="campo-senha"
                    name="password"
                    type={verSenha ? 'text' : 'password'}
                    className={`${CAMPO_CLASSE} pr-12`}
                    value={senha}
                    onChange={(evento) => {
                      setSenha(evento.target.value);
                      if (faltando === 'senha') setFaltando(null);
                      if (erro) setErro(null);
                    }}
                    onKeyUp={verCapsLock}
                    onKeyDown={verCapsLock}
                    onBlur={() => setCapsLock(false)}
                    autoComplete="current-password"
                    enterKeyHint="go"
                    placeholder="Sua senha"
                    aria-invalid={erro || faltando === 'senha' ? true : undefined}
                    aria-describedby={[faltando === 'senha' ? 'login-falta-senha' : '', capsLock ? 'login-caps' : ''].filter(Boolean).join(' ') || undefined}
                  />
                  <Lock
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition peer-focus:text-[#16a34a]"
                  />
                  <button
                    type="button"
                    onClick={() => setVerSenha((v) => !v)}
                    aria-label={verSenha ? 'Esconder senha' : 'Mostrar senha'}
                    aria-pressed={verSenha}
                    className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#40de63]"
                  >
                    {verSenha ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {faltando === 'senha' ? (
                  <p id="login-falta-senha" className="mt-1.5 text-xs font-medium text-red-600">
                    Informe a senha.
                  </p>
                ) : null}
                {capsLock ? (
                  <p id="login-caps" className="mt-1.5 text-xs font-medium text-amber-700">
                    Caps Lock está ligado.
                  </p>
                ) : null}
              </div>

              {/* A linha inteira liga e desliga (alvo de toque grande), não só a chave. */}
              <div
                onClick={(evento) => {
                  if (!(evento.target instanceof Element) || !evento.target.closest('[role="switch"]')) setLembrar((v) => !v);
                }}
                className="flex min-h-[56px] cursor-pointer select-none items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 transition hover:bg-slate-100"
              >
                <div className="min-w-0">
                  <p id="login-lembrar" className="text-sm font-semibold text-slate-800">
                    Manter conectado
                  </p>
                  <p className="text-xs leading-snug text-slate-500">Não use em computador compartilhado.</p>
                </div>
                <ToggleSwitch checked={lembrar} onChange={setLembrar} ariaLabel="Manter conectado" />
              </div>
            </div>

            {aviso ? (
              <div
                role="status"
                data-tom={aviso.tom}
                className={`mt-4 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${
                  aviso.tom === 'aviso' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'
                }`}
              >
                <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{aviso.texto}</span>
              </div>
            ) : null}

            {erro ? (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
              >
                <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{erro}</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={enviando}
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#16a34a] px-4 text-base font-semibold text-white shadow-lg shadow-green-600/25 transition hover:bg-[#15803d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#40de63]/40 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
            >
              {enviando ? <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> : null}
              {enviando ? 'Entrando…' : 'Entrar'}
            </button>

            <p className="mt-6 text-center text-xs text-slate-400 lg:hidden">© {anoAtual} MAK Gestão</p>
          </form>
        </main>
      </div>
    </div>
  );
};

export default NativeLoginForm;
