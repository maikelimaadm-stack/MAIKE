import React from "react";
import { Plus } from "lucide-react";
import {
  atividadesEmAndamento,
  barraDoAndamento,
  capimDoServico,
  faltaConcluir,
  textoDaAreaDoServico,
  textoDoCapim,
  textoDoCardEmAndamento,
} from "@/lib/servicoVariosDias";

/**
 * D-PROD-280 (MAIKE-ENTREGA-A) — o bloco "Atividades em andamento" no topo do Lançamento de Atividades (maquete
 * "final-lista"): um card por atividade aberta, com o nome (a operação), a área ou o local, o capim do plantio, a barra e
 * "10 de 40 ha · falta 30 · último dia ontem" (sem área, o local e a quantidade feita — D-PROD-274). Dois botões:
 * "+ Lançamento" (verde; o "continuar" de sempre) e "Finalizar" (o mesmo diálogo da linha). As permissões são as MESMAS
 * da linha (quem decide é a página: `podeLancar` / `podeFinalizar`). Um card por linha no celular, 2 no tablet (≥768px)
 * e 3 no computador (≥1200px). Só leitura dos dados da lista (`andamento` do servidor); nada novo é pedido.
 * @param {{ itens: any[], hoje: string|null, podeLancar: (item: any) => boolean, podeFinalizar: (item: any) => boolean,
 *   onLancar: (item: any) => void, onFinalizar: (item: any) => void }} props
 */
export default function AtividadesEmAndamento({ itens, hoje, podeLancar, podeFinalizar, onLancar, onFinalizar }) {
  const abertas = atividadesEmAndamento(itens);
  if (!abertas.length) return null;
  return (
    <section className="b1-em-andamento" aria-label="Atividades em andamento" data-testid="atividades-em-andamento">
      <h2 className="b1-em-andamento__titulo">Atividades em andamento ({abertas.length})</h2>
      <ul className="b1-em-andamento__grade">
        {abertas.map((item) => {
          const id = String(item?.id ?? "");
          const onde = [textoDaAreaDoServico(item), textoDoCapim(capimDoServico(item))].filter(Boolean).join(" · ");
          const barra = barraDoAndamento(item);
          const { forte, resto } = textoDoCardEmAndamento(item, hoje);
          const tudoFeito = faltaConcluir(item);
          const lancar = podeLancar(item) && !tudoFeito;
          const finalizar = podeFinalizar(item);
          return (
            <li key={id} className="b1-em-andamento__card" data-testid={`em-andamento-${id}`}>
              <span className="b1-em-andamento__nome">{String(item?.tipo_atividade_nome ?? item?.nome ?? "")}</span>
              {onde ? <span className="b1-em-andamento__onde">{onde}</span> : null}
              <span className="b1-servico-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={barra ?? 0} aria-label="Andamento da atividade">
                <span className="b1-servico-barra__feito" style={{ width: `${barra ?? 0}%` }} />
              </span>
              <span className="b1-em-andamento__texto" data-testid={`em-andamento-texto-${id}`}>
                {tudoFeito ? <strong>Tudo feito · falta finalizar</strong> : forte ? <strong>{forte}</strong> : null}
                {resto ? <>{tudoFeito || forte ? " · " : ""}{resto}</> : null}
              </span>
              {lancar || finalizar ? (
                <span className="b1-em-andamento__botoes">
                  {lancar ? (
                    <button type="button" className="b1-em-andamento__botao b1-em-andamento__botao--verde" onClick={() => onLancar(item)} data-testid={`em-andamento-lancar-${id}`}>
                      <Plus className="h-4 w-4" aria-hidden />
                      Lançamento
                    </button>
                  ) : null}
                  {finalizar ? (
                    <button type="button" className="b1-em-andamento__botao" onClick={() => onFinalizar(item)} data-testid={`em-andamento-finalizar-${id}`}>
                      Finalizar
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
