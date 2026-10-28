import React from "react";
import { Badge } from "@/components/ui/badge";
import { cadastroAtivoLabel, isCadastroAtivo } from "@/lib/cadastroAtivoStatus";

/**
 * Badge somente leitura para coluna `ativo` (Motor Base1).
 *
 * @param {{ value?: unknown; ativo?: unknown }} props
 * `value` ou `ativo` — booleano ou legado (undefined → ativo).
 */
export default function CadastroAtivoBadge({ value, ativo }) {
  const raw = ativo !== undefined ? ativo : value;
  const active = isCadastroAtivo(raw);
  const label = cadastroAtivoLabel(raw);

  return (
    <Badge
      variant="secondary"
      className={
        active
          ? "text-[10px] bg-emerald-100 text-emerald-700"
          : "text-[10px] bg-slate-100 text-slate-500"
      }
      aria-label={label}
      data-testid="cadastro-ativo-badge"
      data-ativo={active ? "true" : "false"}
    >
      {label}
    </Badge>
  );
}
