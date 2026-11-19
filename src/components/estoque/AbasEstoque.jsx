import React from "react";

/** Abas da tela Estoque: Saldo e Movimentos (D-PROD-259: o lançamento fica em Movimentos, "Novo movimento"). */
export const ABAS_ESTOQUE = Object.freeze([
  { id: "saldo", rotulo: "Saldo" },
  { id: "movimentos", rotulo: "Movimentos" },
]);

/**
 * Abas no desenho Base1 (as mesmas da atividade aberta: `b1-panel-tabs-strip`/`b1-panel-tab`).
 * @param {{ aba: 'saldo'|'movimentos', onChange: (aba: 'saldo'|'movimentos') => void }} props
 */
export default function AbasEstoque({ aba, onChange }) {
  return (
    <div className="cadastro-b1 b1-panel-tabs-rail b1-aberta-abas" data-testid="estoque-abas">
      <div role="tablist" aria-label="Estoque" className="b1-panel-tabs-strip b1-aberta-abas__lista">
        {ABAS_ESTOQUE.map((a, i) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            id={`estoque-aba-${a.id}`}
            aria-selected={aba === a.id}
            tabIndex={aba === a.id ? 0 : -1}
            className={`b1-panel-tab${aba === a.id ? " is-active" : ""}`}
            data-testid={`estoque-aba-${a.id}`}
            onClick={() => onChange(/** @type {'saldo'|'movimentos'} */ (a.id))}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const outra = ABAS_ESTOQUE[(i + (e.key === "ArrowRight" ? 1 : ABAS_ESTOQUE.length - 1)) % ABAS_ESTOQUE.length].id;
              onChange(/** @type {'saldo'|'movimentos'} */ (outra));
              document.getElementById(`estoque-aba-${outra}`)?.focus();
            }}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
