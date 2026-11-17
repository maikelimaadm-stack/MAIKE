import React from "react";
import "@/styles/acoes-lote-modulos.css";

/**
 * Manejos e Históricos do Detalhes do Lote (D-PROD-119), em quadros (ícone em
 * cima, nome embaixo), em grupos separados; cada quadro abre a ação com um
 * clique. D-PROD-218: é só a grade — quem a mostra é a tela empilhada
 * "Manejos e históricos" da casca (aberta pelo "Manejos" do rodapé), com 3
 * colunas em todos os modos. Ordem alfabética; o desabilitado continua visível
 * com o motivo no `title`.
 *
 * @param {{ grupos: Array<{ titulo: string, itens: Array<{ nome: string, rotulo?: string, Icone: React.ComponentType<any>, onClick: () => void, disabled?: boolean, motivoBloqueio?: string }> }> }} props
 */
export default function AcoesDoLote({ grupos }) {
  const visiveis = grupos.filter((g) => g.itens.length > 0).map((g) => ({ ...g, itens: [...g.itens].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })) }));
  if (!visiveis.length) return null;

  return (
    <div className="mk-al mk-acoes-modulos">
      {visiveis.map((g) => (
        <section key={g.titulo} className="mk-al__grupo" aria-label={g.titulo}>
          <h3 className="mk-al__grupo-titulo">{g.titulo}</h3>
          <div className="mk-al__quadros">
            {g.itens.map(({ nome, rotulo, Icone, onClick, disabled = false, motivoBloqueio }) => (
              <button key={nome} type="button" className="mk-al__quadro" disabled={disabled} onClick={() => { if (!disabled) onClick(); }} aria-label={rotulo || nome} title={disabled && motivoBloqueio ? motivoBloqueio : rotulo || nome}>
                <span className="mk-al__icone" aria-hidden="true"><Icone /></span>
                <span className="mk-al__nome">{nome}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
