import React from "react";
import { toast } from "sonner";
import MaikeToastCard from "@/components/common/MaikeToastCard";

/**
 * Notificações no modelo da foto (cartão branco + ícone).
 * Sucesso: topo centro. Avisos/erros: laterais (topo direita).
 */

function show(tone, title, description, position, duration = 4200) {
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
      position,
      duration,
      unstyled: true,
      className: "mg-toast-host",
    },
  );
}

/** Sucesso (topo) — exclusão, salvar, etc. */
export function notifySuccess(title, description) {
  return show("success", title, description ?? "", "top-center");
}

/** Aviso lateral — campo obrigatório, nome duplicado, seleção, etc. */
export function notifyWarning(title, description) {
  return show("warning", title, description ?? "", "top-right", 5200);
}

/** Erro lateral */
export function notifyError(title, description) {
  return show("error", title, description ?? "", "top-right", 5600);
}

/** Info lateral */
export function notifyInfo(title, description) {
  return show("info", title, description ?? "", "top-right", 4500);
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
