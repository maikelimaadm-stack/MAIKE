import React from "react";
import { ChevronDown } from "lucide-react";
import { Root as Popover, Content as PopoverContent, Trigger as PopoverTrigger, Portal } from "@radix-ui/react-popover";

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
 * `<select>` dos formulários Base1 / lançamentos.
 * Abre o **mesmo popup flutuante** de Filtros/Camadas (`.mk-map-multi-popup`):
 * cartão ancorado ao campo, título, checkbox à esquerda — em celular e desktop
 * (D-PROD-152). Não usa folha de baixo nem painel sob o campo.
 * Mesma API do `<select>`: `value`, `onChange(e)`.
 *
 * @param {React.SelectHTMLAttributes<HTMLSelectElement> & { children?: React.ReactNode }} props
 */
export default function B1Select(props) {
  const { value, onChange, children, className, disabled, id } = props;
  const dataAttrs = Object.fromEntries(Object.entries(props).filter(([k]) => k.startsWith("data-")));
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const botao = React.useRef(/** @type {HTMLButtonElement | null} */ (null));

  const opcoes = opcoesDe(children);
  const atual = opcoes.find((o) => o.value === String(value ?? ""));
  const vazio = !atual || atual.value === "";
  const reais = opcoes.filter((o) => o.value !== "" || (o.label.trim() !== "" && !/^selecione/i.test(o.label.trim())));
  const pesquisavel = reais.length > 8;
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const vistas = termo ? reais.filter((o) => o.label.toLocaleLowerCase("pt-BR").includes(termo)) : reais;
  const rotulo =
    botao.current?.closest(".mg-field")?.querySelector("label")?.textContent?.replace(/\s*\*\s*$/, "").trim() ||
    props["aria-label"] ||
    "Selecione";

  const escolher = (v) => {
    setAberto(false);
    setBusca("");
    onChange?.(/** @type {any} */ ({ target: { value: v }, currentTarget: { value: v } }));
  };

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) setBusca("");
      }}
    >
      <PopoverTrigger asChild>
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
          value={String(value ?? "")}
          {...dataAttrs}
          {...(vazio ? { "data-placeholder": "" } : {})}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setAberto(true);
            }
          }}
        >
          <span className="b1-select-btn__v">{vazio ? "" : atual.label}</span>
          <ChevronDown aria-hidden className="b1-select-btn__c" />
        </button>
      </PopoverTrigger>
      <Portal>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={5}
          collisionPadding={8}
          className="mk-map-multi-popup mk-lista-fc"
          aria-label={rotulo}
          onOpenAutoFocus={(e) => {
            if (!pesquisavel) e.preventDefault();
          }}
        >
          <div className="mk-map-multi-title">{rotulo}</div>
          {pesquisavel ? (
            <input
              type="search"
              aria-label={`Pesquisar ${rotulo}`}
              placeholder="Procurar opção..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          ) : null}
          <div className="mk-map-multi-options" role="listbox" aria-label={rotulo}>
            {!vistas.length ? <div className="mk-map-multi-vazio">Nenhuma opção</div> : null}
            {vistas.map((o) => {
              const on = o.value === String(value ?? "");
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  aria-checked={on}
                  disabled={o.disabled}
                  className={`mk-check-row${on ? " is-on" : ""}`}
                  onClick={() => !o.disabled && escolher(o.value)}
                >
                  <span>{o.label}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Portal>
    </Popover>
  );
}
