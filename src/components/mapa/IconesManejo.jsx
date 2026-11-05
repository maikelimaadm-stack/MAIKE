import React from "react";

/**
 * Ícones em imagem dos manejos, enviados pelo proprietário (D-PROD-131).
 * Ficam no lugar de um ícone lucide nos quadros de AcoesDoLote
 * (mesma altura dos outros ícones — ver `.mk-al__img`).
 *
 * @param {string} src
 */
const iconeImagem = (src) => {
  /** @param {{ className?: string }} props */
  const Icone = ({ className = "" }) => (
    <img src={src} alt="" aria-hidden="true" draggable={false} className={`mk-al__img ${className}`.trim()} />
  );
  return Icone;
};

/** Mover: boi com as setas de ida e volta. */
export const IconeMoverAnimais = iconeImagem("/icons/mover-animais.png");

/** Pesar: balança digital com o visor 0.0. */
export const IconePesar = iconeImagem("/icons/pesar.png");

/** Nascimento: vaca com o bezerro e o calendário com +. */
export const IconeNascimento = iconeImagem("/icons/nascimento.png");

/** Saída (antigo "Abate"): boi com a porta de saída. */
export const IconeSaida = iconeImagem("/icons/saida.png");

/** Morte: animal deitado com o X. */
export const IconeMorte = iconeImagem("/icons/morte.png");

/** Juntar Lotes: boi com as camadas que se juntam numa só. */
export const IconeJuntarLotes = iconeImagem("/icons/juntar-lotes.png");

/** Mudar Categoria: bezerro → boi, cada um num quadro, com a seta entre eles. */
export const IconeMudarCategoria = iconeImagem("/icons/mudar-categoria.png");

/** Editar Informação (antigo "Renomear Lote"): boi com a pasta da ficha e o lápis. */
export const IconeEditarInformacao = iconeImagem("/icons/editar-informacao.png");

/** Histórico de Movimentação: ficha com as setas de ida e volta e o relógio. */
export const IconeHistoricoMovimentacao = iconeImagem("/icons/historico-movimentacao.png");

/** Histórico de Suplementação: ficha com o saco de ração e o relógio. */
export const IconeHistoricoSuplementacao = iconeImagem("/icons/historico-suplementacao.png");
