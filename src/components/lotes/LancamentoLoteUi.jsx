import React from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMediaQuery, MobileSheetPortalCtx } from "@/components/common/MobileSheet";
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
 * Contexto do diálogo: o rodapé do formulário (`LancLoteRodape`) entrega a
 * ação aqui e ela vira o ✓ do cabeçalho; o `<form>` ganha o id do ✓.
 * @type {React.Context<null | { formId: string, setAcao: (a: any) => void, setTitulo: (t: string | null) => void }>}
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
 * `somenteLeitura` (históricos, D-PROD-117): só o ✕; o corpo rola como o dos
 * lançamentos. Um conteúdo pode trocar o título do diálogo pelo contexto
 * (`useLancLoteDialogo().setTitulo`), para não repetir o título dentro.
 *
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, titulo: string, lotes?: Array<{ nome?: string }>, largo?: boolean, somenteLeitura?: boolean, children: React.ReactNode }} props
 */
export function LancLoteDialogo({ open, onOpenChange, titulo, lotes, largo = false, somenteLeitura = false, children }) {
  const nomes = (lotes || []).map((l) => l?.nome).filter(Boolean).join(" · ");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const formId = `mk-ll-${React.useId().replace(/:/g, "")}`;
  const [acao, setAcao] = React.useState(/** @type {any} */ (null));
  // As listas do celular (folha) abrem dentro do diálogo (D-PROD-116).
  const [alvoFolha, setAlvoFolha] = React.useState(/** @type {HTMLElement | null} */ (null));
  const [tituloDoConteudo, setTitulo] = React.useState(/** @type {string | null} */ (null));
  const ctx = React.useMemo(() => ({ formId, setAcao, setTitulo }), [formId]);
  const tituloVisivel = tituloDoConteudo || titulo;
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

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => (v ? onOpenChange(true) : fechar())}>
      <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="mk-ll-scrim fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        // Histórico: nada para preencher — não acende o ✕ ao abrir.
        onOpenAutoFocus={somenteLeitura ? (e) => e.preventDefault() : undefined}
        className={cn(
          "mk-ll-dlg fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          desktop ? "is-desktop data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95" : "is-tela",
          largo && "mk-ll-dlg--largo",
        )}
      >
        <div className="mk-ll-dlg__head">
          {!desktop ? (
            <button type="button" className="mk-ll-dlg__redondo" onClick={fechar} aria-label={somenteLeitura ? "Fechar" : "Cancelar"} title={somenteLeitura ? "Fechar" : "Cancelar"} disabled={acao?.cancelarDesabilitado}>
              <X aria-hidden />
            </button>
          ) : null}
          <div className="mk-ll-dlg__txt">
            <DialogPrimitive.Title className="mk-ll-dlg__titulo">{tituloVisivel}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={nomes ? "mk-ll-dlg__lotes" : "sr-only"}>{nomes || tituloVisivel}</DialogPrimitive.Description>
          </div>
          {somenteLeitura ? (
            desktop ? (
              <div className="mk-ll-dlg__acoes cadastro-b1">
                <PillBtn tone="gray" className="mg-act-ic mg-act-cancelar" onClick={fechar} aria-label="Fechar" title="Fechar">
                  <X className="h-4 w-4" aria-hidden />
                </PillBtn>
              </div>
            ) : (
              <span className="mk-ll-dlg__redondo mk-ll-dlg__redondo--vazio" aria-hidden />
            )
          ) : desktop ? (
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
      <button type="button" className="mk-ll__btn mk-ll__btn--cinza" onClick={onCancelar} disabled={cancelarDesabilitado}>
        Cancelar
      </button>
      <button
        type={tipoAcao}
        className={cn("mk-ll__btn", tom === "ambar" ? "mk-ll__btn--ambar" : "mk-ll__btn--verde")}
        disabled={disabled || enviando}
        aria-busy={enviando || undefined}
        onClick={onAcao}
      >
        {enviando && textoEnviando ? textoEnviando : textoAcao}
      </button>
    </div>
  );
}

/** Classe dos controles dentro do `LancField` (Input/SelectTrigger/Textarea). */
export const LL_CTL = "h-7 text-xs border-0 shadow-none focus-visible:ring-0 focus:ring-0 bg-transparent";
