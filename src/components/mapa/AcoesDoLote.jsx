import React from "react";
import "@/styles/acoes-lote-modulos.css";

/**
 * Faixa de ações independente das informações: o mesmo botão compacto abre
 * diretamente o manejo no celular, tablet e desktop. Ícone acima do nome.
 *
 * @param {{ grupos: Array<{ titulo: string, itens: Array<{ nome: string, rotulo?: string, Icone: React.ComponentType<any>, onClick: () => void, disabled?: boolean, motivoBloqueio?: string }> }> }} props
 */
export default function AcoesDoLote({ grupos }) {
  const visiveis = grupos.filter((g) => g.itens.length > 0).map((g) => ({ ...g, itens: [...g.itens].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })) }));
  if (!visiveis.length) return null;

  const conteudo = (
    <div className="mk-al__grupos mk-acoes-modulos">
      {visiveis.map((g) => (
        <section key={g.titulo} className="mk-al__grupo" aria-label={g.titulo}>
          <h3 className="mk-al__grupo-titulo">{g.titulo}</h3>
          <div className="mk-al__quadros">
            {g.itens.map(({ nome, rotulo, Icone, onClick, disabled = false, motivoBloqueio }) => (
              <button key={nome} type="button" className="mk-al__quadro" disabled={disabled} onClick={() => { if (!disabled) onClick(); }} aria-label={rotulo || nome} title={disabled && motivoBloqueio ? motivoBloqueio : rotulo || nome}>
                <span className="mk-al__icone" aria-hidden="true"><Icone /></span>
                <span>{nome}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  return <nav className="mk-al--embaixo mk-al-dock" aria-label="Ações do lote" tabIndex={0}>{conteudo}</nav>;
}
