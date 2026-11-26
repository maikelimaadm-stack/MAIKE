import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Janela do motor Base1 sobre o Radix Dialog (D-PROD-169): o desenho de "Configurar colunas" (`b1ref .mdlc`) —
 * fundo quente, cartão branco de 16px, cabeçalho com o título e o ✕, corpo e, se houver, rodapé com os botões do
 * motor (`tb-btn`). Foco preso, Escape e leitores de tela ficam com o Radix.
 *
 * A camada ocupa a tela e centraliza sem `transform`: uma folha do celular (`position: fixed`) aberta dentro dela
 * ocupa a tela, e não o cartão. A janela leva `cadastro-b1`, porque o portal fica fora da tela e, sem isso, os
 * campos e botões do motor dentro dela perdiam o desenho.
 *
 * @param {{
 *   aberto: boolean,
 *   onFechar: () => void,
 *   titulo: React.ReactNode,
 *   children: React.ReactNode,
 *   descricao?: React.ReactNode,
 *   descricaoProps?: Record<string, any>,
 *   rodape?: React.ReactNode,
 *   podeFechar?: boolean,
 *   aoPedirFechar?: () => boolean,
 *   onEscapeKeyDown?: (e: KeyboardEvent) => void,
 *   className?: string,
 *   testId?: string,
 *   fora?: React.ReactNode,
 *   contentProps?: Record<string, any>,
 *   acoesDoTitulo?: React.ReactNode,
 *   antesDoTitulo?: React.ReactNode,
 * }} props `antesDoTitulo` (D-PROD-325): um botão antes do título (a seta "Voltar" do Diário das atividades). `podeFechar` falso trava o ✕ e ignora o pedido de fechar (ex.: enviando); `aoPedirFechar` devolve falso
 *   para ignorar um pedido (ex.: a folha do celular aberta dentro da janela fecha primeiro); `fora` fica dentro da
 *   camada, fora do cartão (alvo das folhas do celular); `acoesDoTitulo` fica logo depois do título, antes do ✕ (ex.: o
 *   "Trocar tipo" da Nova realização, D-PROD-265).
 */
export default function B1Janela({
  aberto,
  onFechar,
  titulo,
  children,
  descricao = null,
  descricaoProps = {},
  rodape = null,
  podeFechar = true,
  aoPedirFechar = undefined,
  onEscapeKeyDown = undefined,
  className = "",
  testId = undefined,
  fora = null,
  contentProps = {},
  acoesDoTitulo = null,
  antesDoTitulo = null,
}) {
  const fechar = () => {
    if (!podeFechar) return;
    if (aoPedirFechar && aoPedirFechar() === false) return;
    onFechar();
  };
  return (
    <DialogPrimitive.Root
      open={aberto}
      onOpenChange={(o) => {
        if (!o) fechar();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="b1-janela__fundo fixed inset-0 z-[70]" />
        <DialogPrimitive.Content
          onEscapeKeyDown={onEscapeKeyDown}
          // Clique no fundo: a camada é a tela inteira (sem `transform`), então o "fora" é ela mesma.
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) fechar();
          }}
          data-testid={testId}
          {...(descricao ? {} : { "aria-describedby": undefined })}
          {...contentProps}
          className={cn("b1ref cadastro-b1 b1-janela__camada fixed inset-0 z-[71] flex items-center justify-center p-3 outline-none", contentProps.className)}
        >
          <div className={cn("mdlc b1-janela", className)}>
            <div className="mdl-h">
              {antesDoTitulo}
              <DialogPrimitive.Title className="mdl-t">{titulo}</DialogPrimitive.Title>
              {acoesDoTitulo}
              <span style={{ flexGrow: 1 }} />
              <button type="button" className="tb-btn tb-btn-icon tb-btn-sm" aria-label="Fechar" title="Fechar" onClick={fechar} disabled={!podeFechar}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="mdl-b b1-janela__corpo">
              {descricao ? (
                <DialogPrimitive.Description {...descricaoProps} className={cn("b1-janela__nota", descricaoProps.className)}>
                  {descricao}
                </DialogPrimitive.Description>
              ) : null}
              {children}
            </div>
            {rodape ? <div className="mdl-f b1-janela__rodape">{rodape}</div> : null}
          </div>
          {fora}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
