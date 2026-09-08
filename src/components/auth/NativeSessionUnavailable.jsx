/**
 * Sessão não pôde ser validada (P4.0-R1).
 *
 * Este é o estado que faltava. Antes, uma falha transitória ao restaurar a
 * sessão levava direto ao formulário de login — o que dizia ao usuário, em
 * efeito, "suas credenciais não servem", quando a verdade era "o servidor não
 * respondeu". Além de mentir, apagava o token que ele tinha.
 *
 * Três coisas que esta tela **não** faz, e cada uma foi decidida:
 *
 *  - não pede senha. A credencial existe e continua guardada; o que falta é
 *    resposta do servidor;
 *  - não libera o aplicativo. Sem confirmação não há sessão — é fail-closed,
 *    só que sem destruir a credencial;
 *  - não mostra detalhe técnico. Nada de status cru, URL, mensagem do
 *    servidor, `request_id` ou stack. O texto vem do catálogo público, via
 *    `getApiErrorMessage` no `AuthContext`.
 */

import React from 'react';

/**
 * @param {{mensagem?: string|null, aoTentarNovamente: () => void, tentando?: boolean}} props
 */
const NativeSessionUnavailable = ({ mensagem, aoTentarNovamente, tentando = false }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-4">
    <div
      role="status"
      className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm"
    >
      <h1 className="text-lg font-semibold text-slate-900">Não foi possível validar sua sessão.</h1>

      <p className="text-sm text-slate-600">
        {mensagem || 'Verifique sua conexão ou tente novamente.'}
      </p>

      <button
        type="button"
        onClick={aoTentarNovamente}
        disabled={tentando}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {tentando ? 'Validando…' : 'Tentar novamente'}
      </button>
    </div>
  </div>
);

export default NativeSessionUnavailable;
