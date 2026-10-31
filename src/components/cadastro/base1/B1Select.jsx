import React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";

/** Texto de um nó React (filhos de `<option>`). */
function textoDe(no) {
  if (no == null || typeof no === "boolean") return "";
  if (typeof no === "string" || typeof no === "number") return String(no);
  if (Array.isArray(no)) return no.map(textoDe).join("");
  if (React.isValidElement(no)) return textoDe(/** @type {any} */ (no.props).children);
  return "";
}

/** Lê `<option value>` dos filhos, inclusive listas vindas de `.map`. */
function opcoesDe(children) {
  const lista = [];
  React.Children.forEach(children, (filho) => {
    if (!React.isValidElement(filho)) return;
    const props = /** @type {any} */ (filho.props);
    if (filho.type === "option") {
      const label = textoDe(props.children);
      lista.push({ value: String(props.value ?? label), label, disabled: Boolean(props.disabled) });
    } else if (filho.type === React.Fragment || filho.type === "optgroup") {
      lista.push(...opcoesDe(props.children));
    }
  });
  return lista;
}

/**
 * `<select>` dos formulários Base1. Desktop: o select nativo de sempre. Celular:
 * o campo abre a folha de baixo com as opções (e pesquisa acima de 8), como os
 * demais seletores (D-PROD-88). Mesma API do `<select>`: `value`, `onChange(e)`.
 *
 * @param {React.SelectHTMLAttributes<HTMLSelectElement> & { children?: React.ReactNode }} props
 */
export default function B1Select(props) {
  const celular = useCelular();
  const { value, onChange, children, className, disabled, id } = props;
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const botao = React.useRef(/** @type {HTMLButtonElement | null} */ (null));

  if (!celular) return <select {...props}>{children}</select>;

  const opcoes = opcoesDe(children);
  const atual = opcoes.find((o) => o.value === String(value ?? ""));
  const vazio = !atual || atual.value === "";
  const reais = opcoes.filter((o) => o.value !== "");
  const pesquisavel = reais.length > 8;
  const termo = busca.trim().toLowerCase();
  const vistas = termo ? reais.filter((o) => o.label.toLowerCase().includes(termo)) : reais;
  const rotulo =
    (aberto && botao.current?.closest(".mg-field")?.querySelector("label")?.textContent?.replace(/\s*\*\s*$/, "").trim()) ||
    props["aria-label"] ||
    "Selecione";
  const escolher = (v) => {
    setAberto(false);
    onChange?.(/** @type {any} */ ({ target: { value: v }, currentTarget: { value: v } }));
  };

  return (
    <>
      <button
        ref={botao}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-label={props["aria-label"]}
        disabled={disabled}
        className={`${className ?? ""} b1-select-btn`}
        {...(vazio ? { "data-placeholder": "" } : {})}
        onClick={() => {
          setBusca("");
          setAberto(true);
        }}
      >
        <span className="b1-select-btn__v">{vazio ? "" : atual.label}</span>
        <ChevronDown aria-hidden className="b1-select-btn__c" />
      </button>
      {aberto ? (
        <MobileSheet open onClose={() => setAberto(false)} label={rotulo} title={rotulo}>
          {pesquisavel ? (
            <div className="mk-pill mgs__busca">
              {busca ? (
                <button type="button" className="mk-pill__clear" aria-label="Limpar pesquisa" onClick={() => setBusca("")}>
                  <X size={14} />
                </button>
              ) : (
                <span className="mk-pill__icon" aria-hidden>
                  <Search size={14} />
                </span>
              )}
              <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar…" aria-label={`Pesquisar ${rotulo}`} />
            </div>
          ) : null}
          <div className="mgs__lista" role="listbox" aria-label={rotulo}>
            {!vistas.length ? <div className="mgs__vazio">Nenhuma opção</div> : null}
            {vistas.map((o) => {
              const on = o.value === String(value ?? "");
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={o.disabled}
                  className={`mgs__op${on ? " is-on" : ""}`}
                  onClick={() => escolher(o.value)}
                >
                  <span className="mgs__label">{o.label}</span>
                  {on ? <Check size={14} aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </MobileSheet>
      ) : null}
    </>
  );
}
