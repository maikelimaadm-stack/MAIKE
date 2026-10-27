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
