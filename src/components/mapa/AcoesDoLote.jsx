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
 * v13: cada quadro leva uma frase simples (para quem lê pouco) embaixo do nome;
 * no celular os quadros ficam 2 por linha, com o ícone num quadrado claro à
 * esquerda. A frase é só visual: o nome acessível continua `rotulo || nome`.
 *
 * @param {{ grupos: Array<{ titulo: string, itens: Array<{ nome: string, rotulo?: string, Icone: React.ComponentType<any>, onClick: () => void, disabled?: boolean, motivoBloqueio?: string, frase?: string }> }> }} props
 */
/** Frase simples de cada manejo/histórico, pelo nome do quadro. */
export const FRASES_DOS_QUADROS = Object.freeze({
  "Editar Informação": "Corrigir dados do lote",
  "Juntar Lotes": "Unir dois lotes em um",
  Morte: "Animal que morreu",
  Mover: "Levar a outro pasto",
  "Mudar Categoria": "Ex.: bezerro virou garrote",
  Nascimento: "Bezerro que nasceu",
  Pesar: "Anotar o peso",
  Saída: "Venda ou saída",
  Movimentação: "O que já foi lançado",
  Suplementação: "Trato do cocho",
});

export default function AcoesDoLote({ grupos }) {
  const visiveis = grupos.filter((g) => g.itens.length > 0).map((g) => ({ ...g, itens: [...g.itens].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })) }));
  if (!visiveis.length) return null;

  return (
    <div className="mk-al mk-acoes-modulos">
      {visiveis.map((g) => (
        <section key={g.titulo} className="mk-al__grupo" aria-label={g.titulo}>
          <h3 className="mk-al__grupo-titulo">{g.titulo}</h3>
          <div className="mk-al__quadros">
            {g.itens.map(({ nome, rotulo, Icone, onClick, disabled = false, motivoBloqueio, frase }) => {
              const texto = frase ?? /** @type {Record<string, string>} */ (FRASES_DOS_QUADROS)[nome];
              return (
              <button key={nome} type="button" className="mk-al__quadro" disabled={disabled} onClick={() => { if (!disabled) onClick(); }} aria-label={rotulo || nome} title={disabled && motivoBloqueio ? motivoBloqueio : rotulo || nome}>
                <span className="mk-al__icone" aria-hidden="true"><Icone /></span>
                <span className="mk-al__texto">
                  <span className="mk-al__nome">{nome}</span>
                  {texto ? <span className="mk-al__frase">{texto}</span> : null}
                </span>
              </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
