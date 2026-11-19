import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { focoFicaOndeEsta } from "@/components/cadastro/base1/janelaUnica";

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
 *   buscaExterna?: string,
 *   onBuscaChange?: (v: string) => void,
 *   semCaixaBusca?: boolean,
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
  buscaExterna = undefined,
  onBuscaChange = undefined,
  semCaixaBusca = false,
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
  const [buscaInterna, setBuscaInterna] = React.useState(buscaInicial);
  const busca = buscaExterna !== undefined ? buscaExterna : buscaInterna;
  const setBusca = onBuscaChange || setBuscaInterna;
  const [hi, setHi] = React.useState(0);
  const listaRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  // Fechou porque o usuário foi para outro lugar (clique ou foco fora): o foco fica onde ele foi.
  const saiuParaFora = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    saiuParaFora.current = false;
    if (buscaExterna === undefined) setBuscaInterna(buscaInicial);
  }, [open, buscaInicial, buscaExterna]);

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
          className={cn("mk-sel-pop b1-lista-pop", className)}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(e) => {
            if (!pesquisavel || semCaixaBusca) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            // Clique no próprio campo: quem decide é o campo (fecha), não o "clique fora"
            // — senão fechava no pointerdown e reabria no click.
            const campo = ancora?.();
            if (campo && e.target instanceof Node && campo.contains(e.target)) e.preventDefault();
            else saiuParaFora.current = true;
          }}
          onCloseAutoFocus={(e) => {
            // Fechou por clique/foco em outro lugar (ex.: o usuário abriu OUTRA lista): o foco fica lá.
            // Antes ele voltava para este campo e, com isso, a lista recém-aberta fechava sozinha.
            if (saiuParaFora.current || focoFicaOndeEsta(e)) {
              saiuParaFora.current = false;
              e.preventDefault();
              return;
            }
            // Foco volta para o campo (Tab/Enter seguem dali).
            const campo = ancora?.();
            const alvo = campo?.querySelector("input, button, [tabindex]");
            if (alvo instanceof HTMLElement) {
              e.preventDefault();
              alvo.focus();
            }
          }}
        >
          {pesquisavel && !semCaixaBusca ? (
            <div className="b1-pq">
              <input
                autoFocus
                className="b1-pq__in"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Pesquisar…"
                aria-label={`Pesquisar ${rotulo}`}
                data-enter-livre
              />
              {busca ? (
                <button type="button" className="mk-sel-busca__limpar b1-pq__btn" aria-label="Limpar pesquisa" title="Limpar pesquisa" onClick={() => setBusca("")}>
                  <X size={14} aria-hidden />
                </button>
              ) : null}
              {onCriarNovo ? (
                <button
                  type="button"
                  className="b1-pq__btn b1-pq__novo"
                  aria-label={rotuloNovo}
                  title={rotuloNovo}
                  onClick={() => {
                    onOpenChange(false);
                    onCriarNovo(busca.trim());
                  }}
                >
                  <Plus size={17} aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="mk-sel-lista b1-lista" role="listbox" aria-label={rotulo} ref={listaRef}>
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
          {onCriarNovo && (!pesquisavel || semCaixaBusca) ? (
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
