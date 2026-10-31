import React from "react";
import * as SelectUi from "@/components/ui/select";

/** shadcn/Radix sem tipos de props no checkJs legado: alias `any`, sem dívida nova. */
/** @type {Record<string, any>} */
const ui = SelectUi;
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = ui;

/** Radix Select não aceita item de valor vazio; o "nenhum" usa esta sentinela. */
const VAZIO = "__vazio__";

/** Texto de um nó React (filhos de `<option>`). */
const textoDe = (no) => {
  if (no == null || typeof no === "boolean") return "";
  if (typeof no === "string" || typeof no === "number") return String(no);
  if (Array.isArray(no)) return no.map(textoDe).join("");
  if (React.isValidElement(no)) return textoDe(/** @type {any} */ (no.props).children);
  return "";
};

/** Lê `<option value>` dos filhos, inclusive listas vindas de `.map`. */
const opcoesDe = (children) => {
  /** @type {{ value: string, label: string }[]} */
  const lista = [];
  React.Children.forEach(children, (filho) => {
    if (!React.isValidElement(filho)) return;
    const props = /** @type {any} */ (filho.props);
    if (filho.type === "option") {
      const label = textoDe(props.children);
      lista.push({ value: String(props.value ?? label), label });
    } else if (filho.type === React.Fragment) {
      lista.push(...opcoesDe(props.children));
    }
  });
  return lista;
};

/**
 * Seletor do assistente de importação de áreas (D-PROD-90).
 *
 * Mesma API do select nativo e do `B1Select` — `value`, `onChange(e)` e `<option>` como
 * filhos —, mas sobre o Select do Radix. Motivo: o assistente é um Dialog
 * modal do Radix, que tira o clique de tudo fora dele; a folha do `B1Select`
 * (portal no `body`) ficava sem resposta ao toque no celular. O Select do
 * Radix participa da mesma pilha de camadas e já abre como folha no celular
 * (`.mk-select`, D-PROD-88).
 *
 * @param {{
 *   value?: string, onChange?: (e: { target: { value: string } }) => void,
 *   children?: React.ReactNode, className?: string, disabled?: boolean, "aria-label"?: string
 * }} props
 */
export default function SeletorImportacao({ value, onChange, children, className, disabled, "aria-label": rotulo }) {
  // Montagem preguiçosa (D-PROD-90 R1): o Select do Radix mantém todas as opções
  // renderizadas mesmo fechado; com centenas de linhas × 6 seletores isso levava
  // ~12 s para abrir a conferência de 205 áreas. Fechado, é só um botão com o
  // texto atual; o Select real só existe enquanto está aberto.
  const [aberto, setAberto] = React.useState(false);
  const opcoes = opcoesDe(children);
  const atual = String(value ?? "");
  const rotuloAtual = opcoes.find((o) => o.value === atual)?.label ?? "";

  if (!aberto) {
    return (
      <button
        type="button"
        role="combobox"
        aria-expanded={false}
        aria-haspopup="listbox"
        aria-label={rotulo}
        disabled={disabled}
        onClick={() => setAberto(true)}
        className={`flex h-7 items-center justify-between gap-1 whitespace-nowrap px-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
      >
        <span className="truncate">{rotuloAtual}</span>
        <span aria-hidden className="text-[10px] opacity-60">▾</span>
      </button>
    );
  }

  return (
    <Select
      open
      onOpenChange={(v) => !v && setAberto(false)}
      value={atual === "" ? VAZIO : atual}
      disabled={disabled}
      onValueChange={(v) => {
        setAberto(false);
        onChange?.({ target: { value: v === VAZIO ? "" : v } });
      }}
    >
      <SelectTrigger aria-label={rotulo} className={`h-7 px-2 text-xs ${className ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {opcoes.map((o) => (
          <SelectItem key={o.value || VAZIO} value={o.value === "" ? VAZIO : o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
