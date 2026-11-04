import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, LayoutGrid, X } from "lucide-react";
import { useMediaQuery } from "@/components/common/MobileSheet";

/**
 * Manejos e Históricos do Detalhes do Lote (D-PROD-119), em quadros (ícone em
 * cima, nome embaixo — como o "Adicionar contexto" do app do Claude), em
 * grupos separados; cada quadro abre a ação com um clique.
 * - celular: um botão só, "Manejos e históricos", abre a folha de baixo (✕ e título);
 * - tablet/desktop: os quadros ficam à vista, menores, embaixo do Detalhes do Lote.
 *
 * @param {{ grupos: Array<{ titulo: string, itens: Array<{ nome: string, rotulo?: string, Icone: React.ComponentType<any>, onClick: () => void }> }> }} props
 */
export default function AcoesDoLote({ grupos }) {
  const celular = useMediaQuery("(max-width: 639px)");
  const [aberto, setAberto] = React.useState(false);
  const visiveis = grupos.filter((g) => g.itens.length > 0);
  if (!visiveis.length) return null;

  const escolher = (onClick) => {
    setAberto(false);
    onClick();
  };

  const conteudo = (
    <div className="mk-al__grupos">
      {visiveis.map((g) => (
        <section key={g.titulo} className="mk-al__grupo" aria-label={g.titulo}>
          <h3 className="mk-al__grupo-titulo">{g.titulo}</h3>
          <div className="mk-al__quadros">
            {g.itens.map(({ nome, rotulo, Icone, onClick }) => (
              <button key={nome} type="button" className="mk-al__quadro" onClick={() => escolher(onClick)} aria-label={rotulo || nome} title={rotulo || nome}>
                <Icone aria-hidden />
                <span>{nome}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  const gatilho = (
    <button type="button" className="mk-al__botao" aria-haspopup="dialog" aria-expanded={aberto}>
      <LayoutGrid aria-hidden />
      <span>Manejos e históricos</span>
      <ChevronDown aria-hidden className="mk-al__chev" />
    </button>
  );

  if (celular) {
    return (
      <DialogPrimitive.Root open={aberto} onOpenChange={setAberto}>
        <DialogPrimitive.Trigger asChild>{gatilho}</DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="mk-al__scrim" />
          <DialogPrimitive.Content className="mk-al__folha" onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className="mk-al__alca" aria-hidden><span /></div>
            <div className="mk-al__cab">
              <DialogPrimitive.Close className="mk-al__fechar" aria-label="Fechar">
                <X aria-hidden />
              </DialogPrimitive.Close>
              <DialogPrimitive.Title className="mk-al__titulo">Manejos e históricos</DialogPrimitive.Title>
              <span className="mk-al__fechar mk-al__fechar--vazio" aria-hidden />
            </div>
            <DialogPrimitive.Description className="sr-only">Escolha um manejo ou um histórico do lote</DialogPrimitive.Description>
            {conteudo}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return <div className="mk-al--embaixo">{conteudo}</div>;
}
