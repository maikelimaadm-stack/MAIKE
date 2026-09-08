/**
 * Entrada da sessão nativa (P4.0, D-PROD-24).
 *
 * Superfície mínima de propósito: não é página, não entra em `pages.config` e
 * não amplia `config/mapa-manejo-scope.json`. É o estado "sem sessão" da casca
 * de autenticação que já existe — a mesma posição que a tela de erro de
 * usuário não registrado ocupa.
 *
 * O que esta tela **não** mostra, e por quê:
 *
 *  - `cliente_id` e `usuario_id`: são identificadores internos. O usuário
 *    digita o **código** do cliente, que é o nome operacional dele; o id é
 *    resultado da autenticação (ver `nativeSessionApi`);
 *  - o token: não passa por aqui em nenhum momento. A camada de sessão o
 *    intercepta e guarda;
 *  - a mensagem do servidor: o texto de erro vem do catálogo local, via
 *    `getApiErrorMessage`. Ver `nativeHttpClient`.
 */

import React, { useState } from 'react';
import { getApiErrorMessage } from '@/apis/_core/ApiError';

const CAMPO_CLASSE =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500';

/**
 * @param {{onAutenticado: (sessao: {usuario: object, clienteId: string}) => void,
 *          entrar: (credenciais: {cliente: string, login: string, senha: string}) => Promise<object>}} props
 */
const NativeLoginForm = ({ onAutenticado, entrar }) => {
  const [cliente, setCliente] = useState('');
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const submeter = async (evento) => {
    evento.preventDefault();
    if (enviando) return;

    setErro(null);
    setEnviando(true);

    try {
      const sessao = await entrar({ cliente, login, senha });
      // A senha sai do estado assim que deixa de ser necessária. Não é
      // proteção contra XSS — quem executa script na página lê o formulário de
      // qualquer jeito —, é higiene: nada de senha pendurada em estado de
      // componente enquanto o aplicativo inteiro roda.
      setSenha('');
      onAutenticado(sessao);
    } catch (falha) {
      // `getApiErrorMessage` só devolve texto de `ApiError`; qualquer outra
      // coisa cai no fallback público. Nenhuma mensagem de servidor chega aqui.
      setErro(getApiErrorMessage(falha));
      setSenha('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={submeter}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-slate-900">Entrar no MAIKE</h1>
          <p className="text-sm text-slate-500">Informe o cliente, o usuário e a senha.</p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="campo-cliente">
            Cliente
          </label>
          <input
            id="campo-cliente"
            name="cliente"
            className={CAMPO_CLASSE}
            value={cliente}
            onChange={(evento) => setCliente(evento.target.value)}
            autoComplete="organization"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="campo-login">
            Usuário
          </label>
          <input
            id="campo-login"
            name="login"
            className={CAMPO_CLASSE}
            value={login}
            onChange={(evento) => setLogin(evento.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="campo-senha">
            Senha
          </label>
          <input
            id="campo-senha"
            name="senha"
            type="password"
            className={CAMPO_CLASSE}
            value={senha}
            onChange={(evento) => setSenha(evento.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {erro ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {erro}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};

export default NativeLoginForm;
