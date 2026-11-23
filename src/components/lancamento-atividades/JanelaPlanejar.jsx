import React from "react";
import { CalendarPlus, Sprout } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";

/**
 * MAIKE-ENTREGA3 (D-PROD-276) — o "Planejar" da lista: escolhe O QUE planejar, em dois cartões (o mesmo desenho dos tipos da
 * Nova realização). "Reforma de pastagem" abre o formulário da reforma (o agrupador); "Um serviço" abre o planejar de
 * sempre (a atividade antes de lançar os dias). Quem não pode criar não vê o "Planejar" (a página decide).
 *
 * @param {{ onReforma: () => void, onServico: () => void, onFechar: () => void }} props
 */
export default function JanelaPlanejar({ onReforma, onServico, onFechar }) {
  const opcoes = [
    {
      chave: "reforma",
      Icone: Sprout,
      nome: "Reforma de pastagem",
      ajuda: "Junta os serviços de uma reforma (calcário, preparo, plantio…) e mostra o custo por hectare.",
      onClick: onReforma,
    },
    { chave: "servico", Icone: CalendarPlus, nome: "Um serviço", ajuda: "Planeja um serviço antes de lançar os dias.", onClick: onServico },
  ];
  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      titulo={<span data-testid="janela-planejar-titulo">Planejar</span>}
      testId="janela-planejar"
      className="b1-realizacao b1-planejar"
      contentProps={{ "data-permissao-explicita": "" }}
      rodape={
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} data-testid="janela-planejar-cancelar">
          Cancelar
        </button>
      }
    >
      <div className="b1-realizacao__passo">
        <p className="b1-realizacao__ajuda">O que você quer planejar?</p>
        <ul className="b1-realizacao__cartoes b1-planejar__cartoes" aria-label="O que planejar">
          {opcoes.map(({ chave, Icone, nome, ajuda, onClick }) => (
            <li key={chave} className="min-w-0">
              <button type="button" className="b1-realizacao__cartao b1-planejar__cartao" onClick={onClick} data-testid={`janela-planejar-${chave}`}>
                <span className="b1-realizacao__cartao-icone" aria-hidden>
                  <Icone size={22} strokeWidth={1.75} />
                </span>
                <span className="b1-realizacao__cartao-nome">{nome}</span>
                <span className="b1-planejar__ajuda">{ajuda}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </B1Janela>
  );
}
