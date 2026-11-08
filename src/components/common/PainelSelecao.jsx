import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Teto de opções desenhadas — listas de cadastro podem ter milhares. */
const LIMITE = 200;

/**
 * Painel de seleção do desktop/tablet no mesmo modelo visual da folha do
 * celular (D-PROD-106): pesquisa em cima, opções num cartão branco com linhas
 * Visual da lista de Marca do cadastro de Produtos (o modelo escolhido pelo
 * proprietário — D-PROD-106): painel branco, opção sob o mouse em verde-claro,
 * escolhida em verde com ✓; pesquisa em cima e "+ Novo …" embaixo.
 * Abre logo ABAIXO do campo inteiro (`ancora` = o `.mg-field`), não do texto
 * dentro dele — antes o painel nascia por cima da metade de baixo do campo.
 * Teclado: ↑ ↓ Enter, Esc fecha.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   children: React.ReactElement,
 *   itens: Array<{ value: string, label: React.ReactNode, texto: string, sub?: React.ReactNode, disabled?: boolean }>,
 *   valor?: string | null,
 *   onEscolher: (value: string) => void,
 *   pesquisavel?: boolean,
 *   buscaInicial?: string,
 *   rotulo?: string,
 *   onCriarNovo?: (busca: string) => void,
 *   rotuloNovo?: string,
 *   vazio?: string,
 *   className?: string,
 *   ancora?: () => Element | null,
 *   controleRef?: { current: null | { tecla: (e: React.KeyboardEvent) => void } },
 * }} props
 */
export default function PainelSelecao({
  open,
  onOpenChange,
  children,
  itens,
  valor = null,
  onEscolher,
  pesquisavel = true,
  buscaInicial = "",
  rotulo = "Opções",
  onCriarNovo = undefined,
  rotuloNovo = "Cadastrar novo",
  vazio = "Nenhuma opção",
  className = "",
  ancora = undefined,
  controleRef = undefined,
}) {
  // Âncora virtual: o retângulo do campo inteiro (lido na hora de posicionar).
  const ancoraRef = React.useMemo(
    () =>
      ancora
        ? { current: { getBoundingClientRect: () => (ancora() ?? document.body).getBoundingClientRect() } }
        : null,
    [ancora],
  );
  const [busca, setBusca] = React.useState(buscaInicial);
  const [hi, setHi] = React.useState(0);
  const listaRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));

  React.useEffect(() => {
    if (!open) return;
    setBusca(buscaInicial);
  }, [open, buscaInicial]);

  const termo = busca.trim().toLowerCase();
  const filtrados = termo ? itens.filter((i) => i.texto.toLowerCase().includes(termo)) : itens;
  const vistos = filtrados.slice(0, LIMITE);

  React.useEffect(() => {
    if (!open) return;
    const i = termo ? 0 : Math.max(0, vistos.findIndex((o) => o.value === valor));
    setHi(i);
    // Só ao abrir ou mudar a pesquisa (não a cada render da lista).
  }, [open, termo]);

  React.useEffect(() => {
    const el = listaRef.current?.querySelector(`[data-i="${hi}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [hi]);

  const escolher = (o) => {
    if (!o || o.disabled) return;
    onEscolher(o.value);
    onOpenChange(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(vistos.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      escolher(vistos[hi]);
    }
  };

  // O campo pode repassar ↑ ↓ Enter para cá quando o foco ficou nele.
  if (controleRef) controleRef.current = { tecla: onKeyDown };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {ancoraRef ? (
        <>
          <Popover.Anchor virtualRef={/** @type {any} */ (ancoraRef)} />
          {children}
        </>
      ) : (
        <Popover.Anchor asChild>{children}</Popover.Anchor>
      )}
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          avoidCollisions
          collisionPadding={8}
          className={cn("mk-sel-pop", className)}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(e) => {
            if (!pesquisavel) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            // Clique no próprio campo: quem decide é o campo (fecha), não o "clique fora"
            // — senão fechava no pointerdown e reabria no click.
            const campo = ancora?.();
            if (campo && e.target instanceof Node && campo.contains(e.target)) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            // Foco volta para o campo (Tab/Enter seguem dali).
            const campo = ancora?.();
            const alvo = campo?.querySelector("input, button, [tabindex]");
            if (alvo instanceof HTMLElement) {
              e.preventDefault();
              alvo.focus();
            }
          }}
        >
          {pesquisavel ? (
            <div className="mk-sel-busca">
              {busca ? (
                <button type="button" className="mk-sel-busca__limpar" aria-label="Limpar pesquisa" onClick={() => setBusca("")}>
                  <X size={14} aria-hidden />
                </button>
              ) : (
                <Search size={14} aria-hidden className="mk-sel-busca__ic" />
              )}
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Pesquisar…"
                aria-label={`Pesquisar ${rotulo}`}
                data-enter-livre
              />
            </div>
          ) : null}
          <div className="mk-sel-lista" role="listbox" aria-label={rotulo} ref={listaRef}>
            {!vistos.length ? <div className="mk-sel-vazio">{termo ? "Nenhum item encontrado" : vazio}</div> : null}
            {vistos.map((o, i) => {
              const on = o.value === valor;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-i={i}
                  disabled={o.disabled}
                  className={cn("mk-sel-op", on && "is-on", i === hi && "is-hi")}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => escolher(o)}
                >
                  <span className="mk-sel-op__txt">
                    <span className="mk-sel-op__label">{o.label}</span>
                    {o.sub ? <span className="mk-sel-op__sub">{o.sub}</span> : null}
                  </span>
                  {on ? <Check size={15} aria-hidden className="mk-sel-op__check" /> : null}
                </button>
              );
            })}
          </div>
          {filtrados.length > LIMITE ? (
            <div className="mk-sel-mais">
              Mostrando {LIMITE} de {filtrados.length.toLocaleString("pt-BR")} · refine a pesquisa
            </div>
          ) : null}
          {onCriarNovo ? (
            <button
              type="button"
              className="mk-sel-novo"
              onClick={() => {
                onOpenChange(false);
                onCriarNovo(busca.trim());
              }}
            >
              <Plus size={15} aria-hidden />
              {rotuloNovo}
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
