import React from "react";
import { Check, ChevronLeft, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import MobileSheet, { useCelular, useMediaQuery, MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";

/*
 * Peças comuns dos lançamentos de lote do Mapa Geral (Morte, Abate,
 * Nascimento, Pesagem, Mudança de Categoria, Mover, Juntar, Renomear —
 * D-PROD-115). Um só desenho para todos:
 *
 *   diálogo (título + lotes) › corpo › [campos do topo] › itens › + Adicionar › Observações › rodapé
 *
 * Sem caixa dentro de caixa, mesmos espaços (8 px), mesmos botões.
 * Os campos continuam sendo `LancField` (rótulo dentro, padrão Base1).
 */

/**
 * Cabeçalho que o conteúdo publica no diálogo (Detalhes do Lote v12, D-PROD-218):
 * título e sub no lugar dos props; com `voltar`, o botão ‹ "Voltar" (no popup
 * antes do título, o ✕ continua à direita; na tela cheia no lugar do ✕) e o Esc
 * volta um nível em vez de fechar.
 *
 * `escVolta: false` (formulário empilhado na própria tela do detalhe,
 * D-PROD-220): o ‹ Voltar continua, mas o Esc é ignorado em qualquer modo — um
 * Esc sem querer não apaga o que foi digitado (como o popup, D-PROD-125). Os
 * lançamentos dos detalhes do mapa não empilham mais: abrem num
 * `LancLoteDialogo` por cima (D-PROD-222).
 * @typedef {{ titulo: string, sub?: string, voltar?: () => void, escVolta?: boolean }} CabecalhoLancLote
 */

/**
 * Contexto do diálogo: o rodapé do formulário (`LancLoteRodape`) entrega a
 * ação aqui e ela vira o ✓ do cabeçalho; o `<form>` ganha o id do ✓.
 * @type {React.Context<null | { formId: string, setAcao: (a: any) => void, setTitulo: (t: string | null) => void, slotDireito: HTMLElement | null, setCabecalho: (cab: CabecalhoLancLote | null) => void }>}
 */
const LancLoteCtx = React.createContext(null);

/** Dentro de um `LancLoteDialogo`? Devolve o contexto (ou `null`). */
export const useLancLoteDialogo = () => React.useContext(LancLoteCtx);

/**
 * Abertura do lançamento — igual ao cadastro rápido (ex.: "Novo setor" no
 * Cadastro de Lotes, D-PROD-106):
 * - desktop (≥1024 px): diálogo, título à esquerda, ✕ e ✓ no topo à direita;
 * - celular/tablet: tela inteira, ✕ redondo à esquerda, título no meio, ✓ à direita.
 * É um diálogo do Radix nos dois casos, para abrir por cima do "Detalhes do
 * Lote" (que já é um diálogo) sem perder foco nem toque.
 *
 * `somenteLeitura` (históricos, D-PROD-117): só o ✕. `folhaMobile` é opt-in
 * para listas de ações e escolhas; detalhes mantêm sua abertura em tela. Um conteúdo pode trocar o título do diálogo pelo contexto
 * (`useLancLoteDialogo().setTitulo`), para não repetir o título dentro.
 *
 * `popupDesde` (D-PROD-218): a partir de que largura o diálogo abre como popup
 * (título à esquerda, ✕ à direita, fecha só pelo ✕). "desktop" (padrão) = 1024 px,
 * como sempre; "tablet" = 768 px (Detalhes do Lote v12). Abaixo, tela cheia.
 * O conteúdo pode publicar um cabeçalho próprio (`setCabecalho`, ver
 * `CabecalhoLancLote`); sem ele e sem `popupDesde`, nada muda.
 *
 * Foco (D-PROD-222): ao abrir, o lançamento foca o primeiro controle (o ✕, como
 * sempre); o só leitura foca o próprio diálogo — o ✕ não acende (D-PROD-117) e o
 * foco não fica para trás, no que abriu, escondido sob o diálogo; `focoInicial`
 * "corpo" foca o primeiro controle do conteúdo (ex.: a primeira escolha da sobra
 * do cocho). Ao fechar, o foco volta a quem estava focado quando ele abriu (a
 * pílula que o abriu), se ainda estiver na tela — o Radix, sem gatilho, o deixava
 * no <body>.
 *
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, titulo: string, lotes?: Array<{ nome?: string }>, largo?: boolean, amplo?: boolean, somenteLeitura?: boolean, folhaMobile?: boolean, popupDesde?: "desktop" | "tablet", focoInicial?: "corpo", children: React.ReactNode }} props
 */
export function LancLoteDialogo({ open, onOpenChange, titulo, lotes, largo = false, amplo = false, somenteLeitura = false, folhaMobile = false, popupDesde = "desktop", focoInicial = undefined, children }) {
  const nomes = (lotes || []).map((l) => l?.nome).filter(Boolean).join(" · ");
  const conteudoRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  // Quem tinha o foco quando o diálogo abriu (a pílula, o botão): recebe o foco de volta ao fechar.
  const focoAnterior = React.useRef(/** @type {HTMLElement | null} */ (null));
  React.useLayoutEffect(() => {
    if (!open) return;
    const ativo = document.activeElement;
    focoAnterior.current = ativo instanceof HTMLElement && ativo !== document.body ? ativo : null;
  }, [open]);
  const popup = useMediaQuery(popupDesde === "tablet" ? "(min-width: 768px)" : "(min-width: 1024px)");
  const folhaConsulta = useCelular() && folhaMobile;
  const formId = `mk-ll-${React.useId().replace(/:/g, "")}`;
  const [acao, setAcao] = React.useState(/** @type {any} */ (null));
  // As listas do celular (folha) abrem dentro do diálogo (D-PROD-116).
  const [alvoFolha, setAlvoFolha] = React.useState(/** @type {HTMLElement | null} */ (null));
  const [tituloDoConteudo, setTitulo] = React.useState(/** @type {string | null} */ (null));
  // Cabeçalho publicado pelo conteúdo (tela empilhada do Detalhes do Lote v12).
  const [cabecalho, setCabecalho] = React.useState(/** @type {CabecalhoLancLote | null} */ (null));
  // Celular, só leitura: o lugar à direita do título (espelho do ✕) recebe um
  // botão do conteúdo, ex.: "Manejos e históricos" do Detalhes do Lote (D-PROD-120).
  const [slotDireito, setSlotDireito] = React.useState(/** @type {HTMLElement | null} */ (null));
  const ctx = React.useMemo(() => ({ formId, setAcao, setTitulo, slotDireito, setCabecalho }), [formId, slotDireito]);
  const tituloVisivel = cabecalho?.titulo || tituloDoConteudo || titulo;
  // Com cabeçalho publicado, a descrição é o `sub` dele (vazio: só para o leitor de tela).
  const descricao = cabecalho ? cabecalho.sub || "" : nomes;
  const voltar = cabecalho?.voltar || null;
  const fechar = () => (acao?.onCancelar ? acao.onCancelar() : onOpenChange(false));
  const ocupado = Boolean(acao?.enviando);
  const rotulo = ocupado && acao?.textoEnviando ? acao.textoEnviando : acao?.textoAcao || "Salvar";
  /** @type {{ type: "button" | "submit", form?: string, onClick?: (e: any) => void }} */
  const propsAcao = acao
    ? acao.tipoAcao === "button"
      ? { type: "button", onClick: acao.onAcao }
      : { type: "submit", form: formId }
    : { type: "button" };
  const Icone = ocupado ? Loader2 : Check;

  // Consultas no celular usam os mesmos gestos e detents dos cadastros.
  // O portal fica dentro do Radix para manter foco e toque nas folhas filhas.
  if (folhaConsulta) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <DialogPrimitive.Content className="mk-map-list-host" onOpenAutoFocus={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
            <DialogPrimitive.Title className="sr-only">{tituloVisivel}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{nomes || tituloVisivel}</DialogPrimitive.Description>
            <div ref={setAlvoFolha} />
            {alvoFolha ? (
              <MobileSheetPortalCtx.Provider value={alvoFolha}>
                <MobileSheet open={open} onClose={fechar} label={tituloVisivel} title={tituloVisivel}
                  className="mk-map-list-sheet"
                  headerAction={<span ref={setSlotDireito} className="mk-ll-dlg__slot" />}
                  aside={nomes ? <p className="mk-map-list-subtitle">{nomes}</p> : null}>
                  <LancLoteCtx.Provider value={ctx}><div className="mk-ll">{children}</div></LancLoteCtx.Provider>
                </MobileSheet>
              </MobileSheetPortalCtx.Provider>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => (v ? onOpenChange(true) : fechar())}>
      <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="mk-ll-scrim fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={conteudoRef}
        // Histórico: nada para preencher — não acende o ✕ ao abrir; o foco vai para o próprio diálogo.
        // "corpo": o primeiro controle do conteúdo. Sem nenhum dos dois, o primeiro controle (o ✕).
        onOpenAutoFocus={
          focoInicial === "corpo" || somenteLeitura
            ? (e) => {
                e.preventDefault();
                const dialogo = conteudoRef.current;
                if (!dialogo) return;
                const alvo =
                  focoInicial === "corpo"
                    ? /** @type {HTMLElement | null} */ (dialogo.querySelector(".mk-ll button:not(:disabled), .mk-ll input:not(:disabled), .mk-ll textarea:not(:disabled), .mk-ll [tabindex]:not([tabindex='-1'])"))
                    : null;
                (alvo ?? dialogo).focus();
              }
            : undefined
        }
        // Ao fechar, o foco volta a quem o tinha quando o diálogo abriu (se ainda estiver na tela).
        onCloseAutoFocus={(e) => {
          const alvo = focoAnterior.current;
          focoAnterior.current = null;
          if (alvo && alvo.isConnected) {
            e.preventDefault();
            alvo.focus();
          }
        }}
        // Popup: fecha só pelo ✕, como os cadastros — sem clique fora nem Esc (D-PROD-125).
        onInteractOutside={popup ? (e) => e.preventDefault() : undefined}
        // Com uma folha (lista do celular) aberta dentro do diálogo, o Esc é só dela: a folha fecha
        // sozinha (ela ouve o Esc) e o diálogo fica — em todos os lançamentos (D-PROD-161, D-PROD-222).
        // Tela empilhada (cabeçalho com voltar): Esc volta um nível, em qualquer modo (D-PROD-218);
        // formulário empilhado (`escVolta: false`): Esc ignorado, para não perder o que foi digitado.
        onEscapeKeyDown={(e) => {
          if (alvoFolha?.querySelector(".mk-sheet-root")) e.preventDefault();
          else if (cabecalho?.escVolta === false) e.preventDefault();
          else if (voltar) {
            e.preventDefault();
            voltar();
          } else if (popup) e.preventDefault();
        }}
        className={cn(
          "mk-ll-dlg fixed left-[50%] top-[50%] z-50 outline-none translate-x-[-50%] translate-y-[-50%] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          popup ? "is-desktop data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95" : "is-tela",
          largo && "mk-ll-dlg--largo",
          amplo && "mk-ll-dlg--amplo",
        )}
      >
        <div className="mk-ll-dlg__head">
          {voltar ? (
            // ‹ Voltar: no popup antes do título (o ✕ fica à direita); na tela cheia no lugar do ✕.
            <button type="button" className="mk-ll-dlg__redondo mk-ll-dlg__voltar" onClick={voltar} aria-label="Voltar" title="Voltar">
              <ChevronLeft aria-hidden />
            </button>
          ) : !popup ? (
            <button type="button" className="mk-ll-dlg__redondo" onClick={fechar} aria-label={somenteLeitura ? "Fechar" : "Cancelar"} title={somenteLeitura ? "Fechar" : "Cancelar"} disabled={acao?.cancelarDesabilitado}>
              <X aria-hidden />
            </button>
          ) : null}
          <div className="mk-ll-dlg__txt">
            <DialogPrimitive.Title className="mk-ll-dlg__titulo">{tituloVisivel}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={descricao ? "mk-ll-dlg__lotes" : "sr-only"}>{descricao || tituloVisivel}</DialogPrimitive.Description>
          </div>
          {somenteLeitura ? (
            popup ? (
              <div className="mk-ll-dlg__acoes cadastro-b1">
                <PillBtn tone="gray" className="mg-act-ic mg-act-cancelar" onClick={fechar} aria-label="Fechar" title="Fechar">
                  <X className="h-4 w-4" aria-hidden />
                </PillBtn>
              </div>
            ) : (
              <div ref={setSlotDireito} className="mk-ll-dlg__slot" />
            )
          ) : popup ? (
            <div className="mk-ll-dlg__acoes cadastro-b1">
              <PillBtn tone="gray" className="mg-act-ic mg-act-cancelar" onClick={fechar} disabled={acao?.cancelarDesabilitado} aria-label="Cancelar" title="Cancelar">
                <X className="h-4 w-4" aria-hidden />
              </PillBtn>
              <PillBtn
                {...propsAcao}
                tone="green"
                className="mg-act-ic mg-act-novo mg-act-salvar"
                disabled={!acao || acao.disabled || ocupado}
                aria-busy={ocupado || undefined}
                aria-label={rotulo}
                title={rotulo}
              >
                <Icone className={cn("h-4 w-4", ocupado && "animate-spin")} aria-hidden />
              </PillBtn>
            </div>
          ) : (
            <button
              {...propsAcao}
              className="mk-ll-dlg__redondo mk-ll-dlg__redondo--salvar"
              disabled={!acao || acao.disabled || ocupado}
              aria-busy={ocupado || undefined}
              aria-label={rotulo}
              title={rotulo}
            >
              <Icone className={cn(ocupado && "animate-spin")} aria-hidden />
            </button>
          )}
        </div>
        <MobileSheetPortalCtx.Provider value={alvoFolha}>
          <LancLoteCtx.Provider value={ctx}>{somenteLeitura ? <div className="mk-ll">{children}</div> : children}</LancLoteCtx.Provider>
        </MobileSheetPortalCtx.Provider>
        <div ref={setAlvoFolha} className="mk-ll-dlg__folhas" />
      </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Corpo do lançamento (o `<form>`): coluna com 8 px entre os blocos. */
export const LancLoteForm = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<'form'>} props
   * @param {React.Ref<HTMLFormElement>} ref
   */
  ({ className, children, ...props }, ref) => {
    const ctx = React.useContext(LancLoteCtx);
    return (
      <form ref={ref} id={ctx?.formId} className={cn("mk-ll", className)} {...props}>
        {children}
      </form>
    );
  },
);
LancLoteForm.displayName = "LancLoteForm";

/**
 * Campos lado a lado: 2 colunas a partir de 640 px, 1 no celular.
 * @param {{ className?: string, children?: React.ReactNode }} props
 */
export function LancLoteGrade({ className, children }) {
  return <div className={cn("mk-ll__grade", className)}>{children}</div>;
}

/**
 * Lista de itens (categorias/lotes).
 * @param {{ className?: string, children?: React.ReactNode }} props
 */
export function LancLoteItens({ className, children }) {
  return <div className={cn("mk-ll__itens", className)}>{children}</div>;
}

/**
 * Um item do lançamento: cabeçalho de uma linha (título à esquerda, ✕ à direita)
 * e os campos em grade.
 *
 * @param {{ titulo: React.ReactNode, sub?: React.ReactNode, icone?: string, onRemover?: () => void, rotuloRemover?: string, children: React.ReactNode, rodape?: React.ReactNode }} props
 */
export function LancLoteItem({ titulo, sub, icone, onRemover, rotuloRemover = "Remover", children, rodape }) {
  return (
    <section className="mk-ll__item">
      <header className="mk-ll__item-head">
        {icone ? <img src={icone} alt="" className="mk-ll__item-ic" /> : null}
        <div className="mk-ll__item-txt">
          <div className="mk-ll__item-titulo">{titulo}</div>
          {sub ? <div className="mk-ll__item-sub">{sub}</div> : null}
        </div>
        {onRemover ? (
          <button type="button" className="mk-ll__remover" onClick={onRemover} aria-label={rotuloRemover} title={rotuloRemover}>
            <X aria-hidden />
          </button>
        ) : null}
      </header>
      <div className="mk-ll__grade">{children}</div>
      {rodape ? <div className="mk-ll__item-rodape">{rodape}</div> : null}
    </section>
  );
}

/**
 * "+ Adicionar categoria": largura dos campos, tracejado, ícone verde.
 * @param {{ onClick: () => void, children?: React.ReactNode, disabled?: boolean }} props
 */
export function LancLoteAdicionar({ onClick, children = "Adicionar Categoria", disabled }) {
  return (
    <button type="button" className="mk-ll__add" onClick={onClick} disabled={disabled}>
      <Plus aria-hidden />
      <span>{children}</span>
    </button>
  );
}

/**
 * Escolha entre poucas opções (Sim/Não, modo da pesagem): botões do mesmo
 * tamanho; o escolhido em verde.
 *
 * @param {{ rotulo: React.ReactNode, required?: boolean, opcoes: Array<{ value: string, label: React.ReactNode }>, valor: string, onChange: (v: string) => void, name?: string }} props
 */
export function LancLoteSegmento({ rotulo, required = false, opcoes, valor, onChange, name }) {
  const id = React.useId();
  return (
    <div className="mk-ll__seg-wrap">
      <div className="mk-ll__seg-rotulo" id={id}>
        {rotulo}
        {required ? <span className="mk-ll__req"> *</span> : null}
      </div>
      <div className="mk-ll__seg" role="radiogroup" aria-labelledby={id} style={{ gridTemplateColumns: `repeat(${opcoes.length}, minmax(0, 1fr))` }}>
        {opcoes.map((o) => {
          const on = o.value === valor;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              name={name}
              className={cn("mk-ll__seg-op", on && "is-on")}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Aviso dentro do lançamento.
 * @param {React.ComponentPropsWithoutRef<'div'> & { tom?: 'neutro'|'ambar'|'vermelho'|'verde' }} props
 */
export function LancLoteAviso({ tom = "neutro", children, ...props }) {
  return (
    <div className={cn("mk-ll__aviso", `mk-ll__aviso--${tom}`)} {...props}>
      {children}
    </div>
  );
}

/**
 * Ação do lançamento. Dentro do `LancLoteDialogo` não desenha nada: vira o
 * ✕ / ✓ do cabeçalho (como no cadastro). Fora dele, rodapé Cancelar + ação.
 *
 * @param {{ onCancelar: () => void, textoAcao: React.ReactNode, enviando?: boolean, textoEnviando?: React.ReactNode, disabled?: boolean, tipoAcao?: 'submit'|'button', onAcao?: (e?: any) => void, tom?: 'verde'|'ambar', cancelarDesabilitado?: boolean }} props
 */
export function LancLoteRodape(props) {
  const { onCancelar, textoAcao, enviando = false, textoEnviando, disabled = false, tipoAcao = "submit", onAcao, tom = "verde", cancelarDesabilitado = false } = props;
  const ctx = React.useContext(LancLoteCtx);
  const rotuloAcao = enviando && textoEnviando ? textoEnviando : textoAcao;
  // Dentro do diálogo: a ação vai para o ✓ do cabeçalho (como no cadastro).
  const ultimo = React.useRef(props);
  ultimo.current = props;
  // Dono do registro: ao desmontar, só limpa se a ação ainda for a deste
  // rodapé (outro rodapé pode já ter se registrado — ex.: Mover → fechamento).
  const [dono] = React.useState(() => ({}));
  React.useLayoutEffect(() => {
    if (!ctx) return undefined;
    ctx.setAcao({
      dono,
      textoAcao, textoEnviando, enviando, disabled, tipoAcao, tom, cancelarDesabilitado,
      onAcao: (/** @type {any} */ e) => ultimo.current.onAcao?.(e),
      onCancelar: () => ultimo.current.onCancelar?.(),
    });
    return undefined;
  }, [ctx, dono, textoAcao, textoEnviando, enviando, disabled, tipoAcao, tom, cancelarDesabilitado]);
  React.useLayoutEffect(() => (ctx ? () => ctx.setAcao((/** @type {any} */ atual) => (atual?.dono === dono ? null : atual)) : undefined), [ctx, dono]);
  if (ctx) return null;
  return (
    <div className="mk-ll__rodape">
      <button type="button" className="mk-ll__btn mk-ll__btn--cinza mk-launch-action" onClick={onCancelar} disabled={cancelarDesabilitado} aria-label="Cancelar" title="Cancelar">
        <X aria-hidden /><span className="mk-launch-action-label">Cancelar</span>
      </button>
      <button
        type={tipoAcao}
        className={cn("mk-ll__btn mk-launch-action", tom === "ambar" ? "mk-ll__btn--ambar" : "mk-ll__btn--verde")}
        disabled={disabled || enviando}
        aria-busy={enviando || undefined}
        aria-label={typeof rotuloAcao === "string" ? rotuloAcao : "Confirmar"}
        title={typeof rotuloAcao === "string" ? rotuloAcao : undefined}
        onClick={onAcao}
      >
        {enviando ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
        <span className="mk-launch-action-label">{enviando && textoEnviando ? textoEnviando : textoAcao}</span>
      </button>
    </div>
  );
}

/** Classe dos controles dentro do `LancField` (Input/SelectTrigger/Textarea). */
export const LL_CTL = "h-7 text-xs border-0 shadow-none focus-visible:ring-0 focus:ring-0 bg-transparent";
