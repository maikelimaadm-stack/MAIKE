import React from "react";
import { toast } from "sonner";
import MaikeToastCard from "@/components/common/MaikeToastCard";

/**
 * Notificações no modelo Base1 (cartão branco + ícone).
 * Todas no canto superior direito. Pedidos de confirmação usam modal centrado.
 */

const TOAST_POSITION = "top-right";

function show(tone, title, description, duration = 4200) {
  return toast.custom(
    (id) => (
      <MaikeToastCard
        tone={tone}
        title={title}
        description={description}
        onClose={() => toast.dismiss(id)}
      />
    ),
    {
      position: TOAST_POSITION,
      duration,
      unstyled: true,
      className: "mg-toast-host",
    },
  );
}

/** Sucesso — salvar, excluir, etc. (canto superior direito) */
export function notifySuccess(title, description) {
  return show("success", title, description ?? "");
}

/** Aviso — campo obrigatório, nome duplicado, seleção, etc. */
export function notifyWarning(title, description) {
  return show("warning", title, description ?? "", 5200);
}

/** Erro */
export function notifyError(title, description) {
  return show("error", title, description ?? "", 5600);
}

/** Info */
export function notifyInfo(title, description) {
  return show("info", title, description ?? "", 4500);
}

/**
 * Empilha toasts de exclusão um a um (vários itens).
 * @param {number} count
 * @param {{ singular?: string; delayMs?: number }} [opts]
 */
export function notifyExclusoesEmpilhadas(count, opts = {}) {
  const n = Math.max(0, Number(count) || 0);
  if (!n) return;
  const singular = opts.singular ?? "Registro excluído";
  const delayMs = opts.delayMs ?? 320;
  for (let i = 0; i < n; i += 1) {
    window.setTimeout(() => {
      notifySuccess("Sucesso", singular);
    }, i * delayMs);
  }
}

/**
 * `toast.success/error/warning/info/message` do sonner chamados direto (sem
 * `notifySuccess`) saíam como texto solto, sem cartão: o Toaster é `unstyled`.
 * Aqui eles passam a usar o mesmo cartão do sistema (D-PROD-121). Instalar
 * ANTES do `installDeleteDialogInterceptor`, que embrulha o `toast.error`.
 */
const TOM_POR_METODO = /** @type {const} */ ({ success: "success", error: "error", warning: "warning", info: "info", message: "info" });
const DURACAO_POR_TOM = { success: 4200, warning: 5200, error: 5600, info: 4500 };

export function instalarToastsDoSistema(alvo = toast) {
  const t = /** @type {any} */ (alvo);
  if (t.__maikeToastsDoSistema) return;
  for (const [metodo, tom] of Object.entries(TOM_POR_METODO)) {
    t[metodo] = (/** @type {any} */ mensagem, /** @type {any} */ opcoes = {}) => {
      const titulo = typeof mensagem === "string" ? mensagem : mensagem?.message || String(mensagem ?? "");
      const descricao = typeof opcoes?.description === "string" ? opcoes.description : "";
      return t.custom(
        (/** @type {any} */ id) => <MaikeToastCard tone={tom} title={titulo} description={descricao} onClose={() => t.dismiss(id)} />,
        {
          id: opcoes?.id,
          position: TOAST_POSITION,
          duration: opcoes?.duration ?? DURACAO_POR_TOM[tom],
          unstyled: true,
          className: "mg-toast-host",
        },
      );
    };
  }
  t.__maikeToastsDoSistema = true;
}
