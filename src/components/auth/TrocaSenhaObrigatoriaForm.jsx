/**
 * Troca obrigatória da senha temporária no primeiro acesso
 * (MAIKE-SAAS-ADMIN-S04-P2, D-PROD-144).
 *
 * Aparece no lugar do login quando o servidor responde que a senha usada é a
 * temporária gerada pelo MAIKE Admin. Ainda NÃO há sessão: o aplicativo segue
 * fechado e nenhuma outra tela é alcançável a partir daqui.
 *
 * Regras desta tela:
 *  - as três senhas vivem só nos campos controlados e são limpas a cada envio;
 *    nada vai para storage, URL, cache de consultas, toasts ou logs;
 *  - o token da etapa nunca passa por aqui (fica na fronteira de sessão);
 *  - UM envio por clique, sem repetição automática. Rede/timeout/500 viram
 *    "não foi possível confirmar": o servidor pode ter gravado, então a pessoa
 *    volta ao login e tenta a senha nova (ou a temporária, se a nova não entrar);
 *  - errar a senha temporária não trava nada: dá para corrigir e enviar de novo.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, KeyRound, Loader2, Lock } from 'lucide-react';
import { API_ERROR_CODES, hasApiErrorCode } from '@/apis/_core/ApiError';
import { concluirTrocaSenhaInicial, descartarTrocaSenhaPendente } from '@/services/sessionService';

export const SENHA_MINIMA = 8;

export const MENSAGENS_TROCA = Object.freeze({
  concluida: 'Senha alterada. Entre com o seu usuário e a nova senha.',
  expirada: 'A etapa de troca de senha expirou. Entre novamente com a senha temporária.',
  jaTrocada: 'A senha temporária já foi trocada. Entre com a nova senha.',
  incerta:
    'Não foi possível confirmar a troca de senha. Tente entrar com a nova senha; se não funcionar, entre com a senha temporária.',
  temporariaErrada: 'A senha temporária não confere. Confira e tente de novo.',
  regras: 'A nova senha precisa ter pelo menos 8 caracteres e ser diferente da senha temporária e do usuário.',
});

const CAMPO_CLASSE =
  'peer h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-3 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#22c55e] focus:ring-2 focus:ring-[#40de63]/20 aria-[invalid=true]:border-red-400';

/** Validação local (o servidor revalida tudo). @returns {string|null} */
export const validarNovaSenha = ({ atual, nova, confirmacao, login }) => {
  if (!atual) return 'Informe a senha temporária.';
  if (nova.length < SENHA_MINIMA) return `A nova senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (nova !== confirmacao) return 'A confirmação não é igual à nova senha.';
  if (nova === atual) return 'A nova senha precisa ser diferente da senha temporária.';
  if (login && nova.trim().toLowerCase() === login.trim().toLowerCase()) return 'A nova senha não pode ser igual ao usuário.';
  return null;
};

/**
 * @param {{ login: string, onConcluida: (mensagem: string) => void, onVoltar: (mensagem?: string, tom?: 'info'|'aviso') => void }} props
 */
const TrocaSenhaObrigatoriaForm = ({ login, onConcluida, onVoltar }) => {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState(/** @type {string|null} */ (null));
  const [enviando, setEnviando] = useState(false);
  const campoAtual = useRef(/** @type {HTMLInputElement | null} */ (null));

  useEffect(() => {
    campoAtual.current?.focus();
  }, []);

  const limparCampos = () => {
    setAtual('');
    setNova('');
    setConfirmacao('');
  };

  const submeter = async (evento) => {
    evento.preventDefault();
    if (enviando) return;
    const problema = validarNovaSenha({ atual, nova, confirmacao, login });
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setEnviando(true);
    const dados = { senhaAtual: atual, novaSenha: nova };
    limparCampos();
    try {
      await concluirTrocaSenhaInicial(dados);
      onConcluida(MENSAGENS_TROCA.concluida);
    } catch (falha) {
      if (hasApiErrorCode(falha, API_ERROR_CODES.USUARIO_SENHA_ATUAL_INVALIDA)) {
        setErro(MENSAGENS_TROCA.temporariaErrada);
        campoAtual.current?.focus();
      } else if (hasApiErrorCode(falha, API_ERROR_CODES.INVALID_ARGUMENT)) {
        setErro(MENSAGENS_TROCA.regras);
      } else if (hasApiErrorCode(falha, API_ERROR_CODES.TENANT_CONTEXT_REQUIRED)) {
        onVoltar(MENSAGENS_TROCA.expirada, 'aviso');
      } else if (hasApiErrorCode(falha, API_ERROR_CODES.CONCURRENCY_CONFLICT)) {
        onVoltar(MENSAGENS_TROCA.jaTrocada, 'info');
      } else {
        // Rede/timeout/5xx ou qualquer resposta fora do contrato: o servidor
        // pode ter gravado (resultado incerto). Não repete; volta ao login.
        onVoltar(MENSAGENS_TROCA.incerta, 'aviso');
      }
    } finally {
      dados.senhaAtual = '';
      dados.novaSenha = '';
      setEnviando(false);
    }
  };

  const voltar = () => {
    descartarTrocaSenhaPendente();
    limparCampos();
    onVoltar();
  };

  const campo = (id, rotulo, valor, setValor, autoComplete, extra = {}) => (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor={id}>
        {rotulo}
      </label>
      <div className="relative">
        <input
          id={id}
          type="password"
          className={CAMPO_CLASSE}
          value={valor}
          onChange={(evento) => {
            setValor(evento.target.value);
            if (erro) setErro(null);
          }}
          autoComplete={autoComplete}
          aria-invalid={erro ? true : undefined}
          {...extra}
        />
        <Lock aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );

  return (
    <div className="mk-login fixed inset-0 overflow-y-auto bg-slate-50">
      <div className="flex min-h-[100dvh] w-full items-center justify-center px-4 py-8 sm:px-6">
        <form
          onSubmit={submeter}
          noValidate
          aria-labelledby="troca-titulo"
          className="w-full max-w-[420px] rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 text-[#16a34a]">
            <KeyRound aria-hidden className="h-6 w-6" />
          </div>
          <div className="mt-4 text-center">
            <h1 id="troca-titulo" className="text-2xl font-bold tracking-tight text-slate-900">
              Troca obrigatória de senha
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Este é o seu primeiro acesso. Para continuar, troque a senha temporária por uma senha só sua.
            </p>
          </div>

          <div className="mt-6 space-y-4">
            {campo('troca-senha-atual', 'Senha temporária', atual, setAtual, 'current-password', { ref: campoAtual })}
            {campo('troca-senha-nova', 'Nova senha', nova, setNova, 'new-password', { 'aria-describedby': 'troca-regras' })}
            {campo('troca-senha-confirmacao', 'Confirme a nova senha', confirmacao, setConfirmacao, 'new-password')}
            <p id="troca-regras" className="text-xs leading-snug text-slate-500">
              Pelo menos {SENHA_MINIMA} caracteres, diferente da senha temporária e do usuário.
            </p>
          </div>

          {erro ? (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={enviando}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#16a34a] px-4 text-base font-semibold text-white shadow-lg shadow-green-600/25 transition hover:bg-[#15803d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#40de63]/40 disabled:cursor-wait disabled:opacity-70"
          >
            {enviando ? <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> : null}
            {enviando ? 'Salvando…' : 'Salvar nova senha'}
          </button>
          <button
            type="button"
            onClick={voltar}
            disabled={enviando}
            className="mt-3 h-11 w-full rounded-xl text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
          >
            Voltar ao login
          </button>
        </form>
      </div>
    </div>
  );
};

export default TrocaSenhaObrigatoriaForm;
