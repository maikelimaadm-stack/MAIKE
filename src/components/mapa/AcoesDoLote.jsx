import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { useMediaQuery } from "@/components/common/MobileSheet";
import { LancLoteDialogo, useLancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";

/**
 * Manejos e Históricos do Detalhes do Lote (D-PROD-119), em quadros (ícone em
 * cima, nome embaixo — como o "Adicionar contexto" do app do Claude), em
 * grupos separados; cada quadro abre a ação com um clique.
 * - celular: um botão só, "Manejos e históricos", abre a folha de baixo (✕ e título);
 *   dentro do diálogo ele fica no alto, à direita (espelho do ✕) (D-PROD-120);
 * - tablet/desktop: os quadros ficam à vista, menores, embaixo do Detalhes do Lote.
 * - `inline`: quando a seção é a própria aba aberta (Informações do Lote), os
 *   quadros ficam à vista também no celular — sem o botão no cabeçalho.
 *
 * @param {{ grupos: Array<{ titulo: string, itens: Array<{ nome: string, rotulo?: string, Icone: React.ComponentType<any>, onClick: () => void }> }>, inline?: boolean }} props
 */
export default function AcoesDoLote({ grupos, inline = false }) {
  const celular = useMediaQuery("(max-width: 639px)");
  const [aberto, setAberto] = React.useState(false);
  const slot = useLancLoteDialogo()?.slotDireito || null;
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

  const gatilho = slot ? (
    <button type="button" className="mk-ll-dlg__redondo mk-al__redondo" aria-haspopup="dialog" aria-expanded={aberto} aria-label="Manejos e históricos" title="Manejos e históricos">
      <LayoutGrid aria-hidden />
    </button>
  ) : (
    <button type="button" className="mk-al__botao" aria-haspopup="dialog" aria-expanded={aberto}>
      <LayoutGrid aria-hidden />
      <span>Manejos e históricos</span>
      <ChevronDown aria-hidden className="mk-al__chev" />
    </button>
  );

  if (celular && !inline) {
    const botao = React.cloneElement(gatilho, { onClick: () => setAberto(true) });
    return <>
      {slot ? createPortal(botao, slot) : botao}
      <LancLoteDialogo open={aberto} onOpenChange={setAberto} titulo="Manejos e históricos" somenteLeitura folhaMobile>
        <div className="mk-map-action-choices">{conteudo}</div>
      </LancLoteDialogo>
    </>;
  }

  return <div className="mk-al--embaixo">{conteudo}</div>;
}
