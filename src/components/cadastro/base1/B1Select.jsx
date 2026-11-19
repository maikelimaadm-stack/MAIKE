import React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import PainelSelecao from "@/components/common/PainelSelecao";

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
 * `<select>` dos formulários Base1. Celular: a folha de baixo com as opções (e
 * pesquisa acima de 8), como os demais seletores (D-PROD-88). Desktop/tablet:
 * o mesmo painel das outras listas, logo abaixo do campo (D-PROD-106).
 * Mesma API do `<select>`: `value`, `onChange(e)`.
 *
 * Como o campo de escolha do motor (`AutocompleteGenerico`, D-PROD-172), quando pedido:
 * `pesquisa="sempre"` põe "Pesquisar…" em qualquer lista; `semOpcaoVazia` tira da lista a opção de valor vazio
 * ("— Escolha —", "— Nenhum —") e, se ela existia, põe o ✕ "Limpar" no campo; `maiusculas` mostra as opções em
 * MAIÚSCULAS, como o valor no campo.
 *
 * @param {React.SelectHTMLAttributes<HTMLSelectElement> & { children?: React.ReactNode, pesquisa?: 'sempre',
 *   semOpcaoVazia?: boolean, maiusculas?: boolean }} props
 */
export default function B1Select(props) {
  const celular = useCelular();
  const { value, onChange, children, className, disabled, id, pesquisa = undefined, semOpcaoVazia = false, maiusculas = false } = props;
  // Atributos data-* (ex.: data-status) seguem para o botão, como iam para o <select>.
  const dataAttrs = Object.fromEntries(Object.entries(props).filter(([k]) => k.startsWith("data-")));
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const botao = React.useRef(/** @type {HTMLButtonElement | null} */ (null));
  const buscaRef = React.useRef(/** @type {HTMLInputElement | null} */ (null));
  // Desktop/tablet: com a lista aberta e sem pesquisa, o foco fica no botão do campo; ↑ ↓ Enter vão para o
  // painel por aqui (como o AutocompleteGenerico), senão a lista não se escolhe pelo teclado (D-PROD-222).
  const controlePainel = React.useRef(/** @type {null | { tecla: (e: React.KeyboardEvent) => void }} */ (null));
  const ancora = React.useCallback(() => botao.current?.closest(".mg-field, .mk-sel-campo") ?? botao.current, []);
  // Aberta pelo clique ou por uma letra, a pesquisa dentro do campo recebe o foco no mesmo ciclo (não
  // num quadro depois): com o foco já nela, o painel que acabou de fechar não o puxa de volta para o
  // campo anterior — o que fechava esta lista recém-aberta (`focoFicaOndeEsta`). Aberta por Enter/↓,
  // o foco fica no botão do campo (D-PROD-222).
  const focarBuscaAoAbrir = React.useRef(false);
  React.useEffect(() => {
    if (!aberto) return;
    if (focarBuscaAoAbrir.current && !celular && !disabled) buscaRef.current?.focus();
    focarBuscaAoAbrir.current = false;
  }, [aberto, celular, disabled]);

  const opcoes = opcoesDe(children);
  const atual = opcoes.find((o) => o.value === String(value ?? ""));
  // "SELECIONE" com valor-sentinela (ex.: `__VAZIO__`) também é vazio para o campo: o rótulo faz o papel de
  // marcador e o texto não fica por cima dele (D-PROD-165). Na lista ele continua, para poder limpar.
  const vazio = !atual || atual.value === "" || /^selecione/i.test(atual.label.trim());
  // Fora da lista só o "Selecione…" (ou opção vazia sem rótulo). Uma opção vazia
  // com nome — ex.: "SEM VÍNCULO" — é uma escolha válida.
  const reais = opcoes.filter((o) => o.value !== "" || (!semOpcaoVazia && o.label.trim() !== "" && !/^selecione/i.test(o.label.trim())));
  const pesquisavel = pesquisa === "sempre" || reais.length > 8;
  // Sem a opção vazia na lista, quem limpa é o ✕ do campo (como no campo de escolha do motor).
  const aceitaVazio = semOpcaoVazia && opcoes.some((o) => o.value === "");
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
  const limpar =
    aceitaVazio && !vazio && !disabled ? (
      <button
        type="button"
        aria-label="Limpar"
        title="Limpar"
        onClick={(e) => {
          e.stopPropagation();
          escolher("");
        }}
        className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        <X className="w-3.5 h-3.5" aria-hidden />
      </button>
    ) : null;
  /** @param {React.ReactElement} botaoDoCampo */
  const comLimpar = (botaoDoCampo) =>
    semOpcaoVazia ? (
      <div className="relative mk-sel-campo w-full">
        {botaoDoCampo}
        {limpar}
      </div>
    ) : (
      botaoDoCampo
    );

  // Desktop/tablet (D-PROD-106): o mesmo painel das outras listas, logo abaixo do campo,
  // com pesquisa direta dentro do próprio campo quando aberto.
  if (!celular) {
    const abrirComBusca = (inicial = "") => {
      setBusca(inicial);
      // Já aberta (por Enter/↓, com o foco no campo): a letra digitada leva o foco para a pesquisa agora,
      // senão as próximas letras voltariam ao campo e trocariam a busca em vez de completá-la.
      if (aberto) {
        if (!disabled) buscaRef.current?.focus();
        return;
      }
      focarBuscaAoAbrir.current = true;
      setAberto(true);
    };
    return (
      <PainelSelecao
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          if (!v) setBusca("");
        }}
        ancora={ancora}
        itens={reais.map((o) => ({ value: o.value, label: o.label, texto: o.label, disabled: o.disabled }))}
        valor={String(value ?? "")}
        onEscolher={escolher}
        pesquisavel={pesquisavel}
        buscaExterna={busca}
        onBuscaChange={setBusca}
        semCaixaBusca
        rotulo={props["aria-label"] || "opções"}
        className={maiusculas ? "b1-maiusculas" : undefined}
        controleRef={controlePainel}
      >
        <div className="relative mk-sel-campo w-full">
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
            {...(vazio && !aberto ? { "data-placeholder": "" } : {})}
            onClick={() => {
              if (aberto) {
                setAberto(false);
                setBusca("");
              } else {
                abrirComBusca("");
              }
            }}
            onKeyDown={(e) => {
              if (aberto && controlePainel.current && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
                controlePainel.current.tecla(e);
                return;
              }
              if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setBusca("");
                setAberto(true);
                return;
              }
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                abrirComBusca(e.key);
              }
            }}
          >
            <span className="b1-select-btn__v">{aberto ? "" : vazio ? "" : atual.label}</span>
            <ChevronDown aria-hidden className="b1-select-btn__c" />
          </button>
          {aberto && !disabled ? (
            <input
              ref={buscaRef}
              type="text"
              className="b1-select-busca-inline"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={!vazio ? String(atual.label) : ""}
              aria-label={`Pesquisar ${rotulo}`}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
                  controlePainel.current?.tecla(e);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAberto(false);
                  setBusca("");
                  botao.current?.focus();
                }
              }}
            />
          ) : null}
          {aberto && busca && !disabled ? (
            <button
              type="button"
              aria-label="Limpar pesquisa"
              title="Limpar pesquisa"
              onClick={(e) => {
                e.stopPropagation();
                setBusca("");
                buscaRef.current?.focus();
              }}
              className="absolute right-8 top-1/2 -translate-y-1/2 z-[2] text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          ) : limpar}
        </div>
      </PainelSelecao>
    );
  }

  return (
    <>
      {comLimpar(
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
      </button>,
      )}
      {aberto ? (
        <MobileSheet open onClose={() => setAberto(false)} label={rotulo} title={rotulo} className={maiusculas ? "b1-maiusculas" : undefined}>
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
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar…" aria-label={`Pesquisar ${rotulo}`} />
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
